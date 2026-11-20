from __future__ import annotations

import json
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from openai import APIError, OpenAI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

import config
from config import API_KEY, APP_TITLE, APP_URL, MODEL, OPENROUTER_BASE_URL
from db import check_db
from errors import install_error_handlers
from ratelimit import limiter
from mermaid_parse import parse_mermaid_flowchart
from models import (
    DiagramRequest,
    EditRequest,
    EditResponse,
    ExplainRequest,
    Graph,
    ImageDiagramRequest,
    MermaidRequest,
    TextResponse,
    apply_edits_tool_schema,
    sanitize_edit_ops,
    sanitize_graph,
    tool_input_schema,
)
from routers import boards, library, share

# Hard cap on request bodies (snapshot limit + headroom for JSON overhead / images).
MAX_BODY_BYTES = config.MAX_SNAPSHOT_BYTES + 5 * 1024 * 1024

app = FastAPI(title="DrawAI API", version="0.2.0")
app.state.limiter = limiter
install_error_handlers(app)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.middleware("http")
async def limit_body_size(request: Request, call_next):  # type: ignore[no-untyped-def]
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            content={"detail": "Request body too large", "code": "payload_too_large"},
        )
    return await call_next(request)


app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.allowed_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(boards.router, prefix="/api")
app.include_router(library.router, prefix="/api")
app.include_router(share.router, prefix="/api")


def require_api_key() -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set in server/.env",
        )


def openrouter_client() -> OpenAI:
    require_api_key()
    return OpenAI(
        api_key=API_KEY,
        base_url=OPENROUTER_BASE_URL,
        default_headers={
            "HTTP-Referer": APP_URL,
            "X-Title": APP_TITLE,
        },
    )


def openai_tool(name: str, description: str, parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": parameters,
        },
    }


def to_openai_content(content: str | list[dict[str, Any]]) -> str | list[dict[str, Any]]:
    """Convert Anthropic-style multimodal blocks (if any) to OpenAI chat content."""
    if isinstance(content, str):
        return content
    out: list[dict[str, Any]] = []
    for block in content:
        btype = block.get("type")
        if btype == "text":
            out.append({"type": "text", "text": block.get("text", "")})
        elif btype == "image":
            source = block.get("source") or {}
            media = source.get("media_type", "image/png")
            data = source.get("data", "")
            out.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:{media};base64,{data}"},
                }
            )
        elif btype in {"image_url", "input_image"}:
            out.append(block)
        else:
            # already OpenAI-ish or unknown — pass text fallback
            if "text" in block:
                out.append({"type": "text", "text": str(block["text"])})
    return out


def normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for msg in messages:
        role = msg.get("role", "user")
        content = to_openai_content(msg.get("content", ""))
        normalized.append({"role": role, "content": content})
    return normalized


def extract_tool_arguments(message: Any, tool_name: str) -> dict[str, Any]:
    tool_calls = getattr(message, "tool_calls", None) or []
    for call in tool_calls:
        fn = getattr(call, "function", None)
        if not fn or getattr(fn, "name", None) != tool_name:
            continue
        raw = getattr(fn, "arguments", "") or "{}"
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Invalid JSON in {tool_name} arguments: {exc}",
            ) from exc
        if isinstance(parsed, dict):
            return parsed
        raise HTTPException(status_code=502, detail=f"{tool_name} arguments must be an object")
    raise HTTPException(status_code=502, detail=f"Model did not return a {tool_name} tool call")


def call_tool(
    *,
    system: str,
    messages: list[dict[str, Any]],
    tool_name: str,
    tool_description: str,
    parameters: dict[str, Any],
    max_tokens: int = 4096,
) -> dict[str, Any]:
    client = openrouter_client()
    try:
        completion = client.chat.completions.create(
            model=MODEL,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                *normalize_messages(messages),
            ],
            tools=[openai_tool(tool_name, tool_description, parameters)],
            tool_choice={"type": "function", "function": {"name": tool_name}},
        )
    except APIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    choice = completion.choices[0] if completion.choices else None
    if not choice or not choice.message:
        raise HTTPException(status_code=502, detail="Empty response from OpenRouter")
    return extract_tool_arguments(choice.message, tool_name)


def call_draw_diagram(
    messages: list[dict[str, Any]],
    *,
    system: str,
) -> Graph:
    tool_input = call_tool(
        system=system,
        messages=messages,
        tool_name="draw_diagram",
        tool_description="Emit a structured diagram graph for DrawAI.",
        parameters=tool_input_schema(),
    )
    try:
        graph = sanitize_graph(tool_input)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Invalid graph from model: {exc}") from exc

    if not graph.nodes:
        raise HTTPException(status_code=502, detail="Model returned an empty diagram")
    return graph


DIAGRAM_STYLE_GUIDE = (
    "Diagram quality rules:\n"
    "- Node labels are at most 4 words (Title Case or sentence case, no trailing punctuation). "
    "Put extra detail in the optional `description` (max ~8 words), sparingly.\n"
    "- Decisions use shape=decision, are phrased as questions ('Valid password?') and every outgoing "
    "edge is labelled exactly 'Yes' or 'No' (edge kind yes / no).\n"
    "- Keep the happy path linear: list the main flow first, in order, and branch failures sideways.\n"
    "- Group related nodes with `groups` (e.g. VPC, Auth Service, Data Layer) and set `group` on members; "
    "only when grouping adds meaning.\n"
    "- Use shapes: terminator for start/end, process for steps, decision for questions, io for "
    "input/output, data for databases / stores, person for actors, service for infrastructure "
    "components, document for documents.\n"
    "- Use tone meaningfully: danger for errors/failures, success for success/complete states, warning "
    "for decisions or risky steps, info for data / external systems, primary for normal steps, "
    "neutral otherwise. Edge kind error for failure paths, async for queues/events/background work.\n"
    "- Use an icon preset kind (database, server, cache, queue, load-balancer, person, browser, aws "
    "kinds...) for infrastructure nodes; use flowchart kinds (start-end, process, decision, "
    "input-output) for flowcharts.\n"
    "- Prefer 6-18 nodes and never more than about 25 unless the user asks for more (hard max 40).\n"
    "- Do not add decorative, legend or title nodes. Every node must be connected.\n"
    "- Set direction to 'auto' unless the user explicitly asks for left-to-right (LR) or "
    "top-to-bottom (TB)."
)


def build_messages(prompt: str, current: Graph | None) -> list[dict[str, Any]]:
    if current is None:
        user = (
            "Create a clear architecture/flowchart diagram for this request.\n"
            f"Request: {prompt}\n\n"
            f"{DIAGRAM_STYLE_GUIDE}"
        )
    else:
        user = (
            "Modify the existing diagram according to the user request. "
            "Keep node IDs stable whenever the same logical node remains. "
            "You may add/remove/rename nodes and edges as needed.\n"
            f"{DIAGRAM_STYLE_GUIDE}\n\n"
            f"Current diagram JSON:\n{current.model_dump_json(by_alias=True)}\n\n"
            f"Modification request: {prompt}"
        )
    return [{"role": "user", "content": user}]


@app.get("/api/health")
async def health() -> JSONResponse:
    db_ok = await check_db()
    return JSONResponse(
        status_code=200 if db_ok else 503,
        content={
            "status": "ok" if db_ok else "degraded",
            "db": "ok" if db_ok else "down",
            "provider": "openrouter",
            "model": MODEL,
            "has_key": "yes" if bool(API_KEY) else "no",
        },
    )


@app.post("/api/diagram", response_model=Graph, response_model_exclude_none=True)
@limiter.limit("20/minute")
async def create_diagram(request: Request, body: DiagramRequest) -> Graph:
    return call_draw_diagram(
        build_messages(body.prompt, body.current),
        system=(
            "You are DrawAI's diagram planner. Always call the draw_diagram tool. "
            "Only use kinds, shapes and tones from the tool enums. Prefer infrastructure/flowchart "
            "kinds that match the domain. Never invent values outside the enums. "
            "Your output is rendered as a polished Miro/FigJam-style diagram, so follow the "
            "quality rules strictly."
        ),
    )


def build_edit_messages(body: EditRequest) -> list[dict[str, Any]]:
    selection = {
        "shapes": [s.model_dump() for s in body.shapes],
        "bindings": [b.model_dump() for b in body.bindings],
    }
    text = (
        "Edit ONLY the selected shapes using patch ops (update / create / delete / connect). "
        "Never regenerate the whole diagram. Keep existing IDs for shapes that remain. "
        "create ops must use tempId strings; connect may reference tempIds or existing ids. "
        "Cards size themselves from their label, so never set w/h and do not worry about exact "
        "x/y for new shapes (place them next to related shapes; layout collisions are resolved "
        "for you). Labels are at most 4 words; decisions are questions with 'Yes'/'No' edge "
        "labels; use tone meaningfully (danger for errors, success for success states); do not "
        "add decorative nodes.\n\n"
        f"Selection JSON:\n{json.dumps(selection)}\n\n"
        f"User instruction: {body.prompt}"
    )

    content: list[dict[str, Any]] = [{"type": "text", "text": text}]
    if body.image_base64:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": body.image_base64,
                },
            }
        )
    return [{"role": "user", "content": content}]


@app.post("/api/edit", response_model=EditResponse)
@limiter.limit("20/minute")
async def edit_selection(request: Request, body: EditRequest) -> EditResponse:
    tool_input = call_tool(
        system=(
            "You are DrawAI's selection editor. Always call apply_edits with a short patch. "
            "Prefer update over delete+create. Use only preset kinds from the tool schema. "
            "Never invent shape IDs that are not in the selection (except create tempIds). "
            "Cap at 50 ops."
        ),
        messages=build_edit_messages(body),
        tool_name="apply_edits",
        tool_description=(
            "Apply a minimal patch to the user's selection. "
            "Return only ops — never a full regenerated diagram."
        ),
        parameters=apply_edits_tool_schema(),
    )
    allowed = {s.id for s in body.shapes}
    try:
        return sanitize_edit_ops(tool_input, allowed)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Invalid edit ops from model: {exc}") from exc


@app.post("/api/diagram/from-image", response_model=Graph, response_model_exclude_none=True)
@limiter.limit("10/minute")
async def diagram_from_image(request: Request, body: ImageDiagramRequest) -> Graph:
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Interpret this hand-drawn or photographed diagram sketch and convert it "
                "into a structured DrawAI graph. Infer nodes, edges, shapes, tones and sensible preset "
                f"kinds.\n\n{DIAGRAM_STYLE_GUIDE}\n\nExtra instructions: {body.prompt}"
            ),
        },
        {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": body.media_type,
                "data": body.image_base64,
            },
        },
    ]
    return call_draw_diagram(
        [{"role": "user", "content": content}],
        system=(
            "You are DrawAI's vision diagrammer. Always call draw_diagram. "
            "Recreate the sketch as a clean architecture/flowchart using only enum values. "
            "Keep the labels from the sketch but shorten them to at most 4 words."
        ),
    )


@app.post("/api/mermaid", response_model=Graph, response_model_exclude_none=True)
@limiter.limit("20/minute")
async def mermaid_to_diagram(request: Request, body: MermaidRequest) -> Graph:
    parsed = parse_mermaid_flowchart(body.source)
    if parsed is not None:
        try:
            graph = sanitize_graph(parsed)
            if graph.nodes:
                return graph
        except Exception:  # noqa: BLE001
            pass

    return call_draw_diagram(
        [
            {
                "role": "user",
                "content": (
                    "Convert this Mermaid diagram into a DrawAI graph. "
                    "Preserve structure and labels; map Mermaid shapes to the closest DrawAI shape and "
                    "kind, subgraphs to groups, dotted links to edge kind async.\n\n"
                    f"```mermaid\n{body.source}\n```"
                ),
            }
        ],
        system=(
            "You convert Mermaid to DrawAI graphs. Always call draw_diagram. "
            "Use flowchart kinds when appropriate. Never invent values outside the enums."
        ),
    )


@app.post("/api/explain", response_model=TextResponse)
@limiter.limit("20/minute")
async def explain_selection(request: Request, body: ExplainRequest) -> TextResponse:
    selection = {
        "shapes": [s.model_dump() for s in body.shapes],
        "bindings": [b.model_dump() for b in body.bindings],
    }
    if body.mode == "summarize":
        instruction = (
            "Summarize the selected diagram in 2–4 short sentences suitable for a sticky note. "
            "No markdown headings. Be concrete about components and flow."
        )
    else:
        instruction = (
            "Explain what this selected diagram shows. Cover the main components, "
            "how they connect, and the overall purpose. Use short paragraphs. No markdown tables."
        )

    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": f"{instruction}\n\nSelection JSON:\n{json.dumps(selection)}",
        }
    ]
    if body.image_base64:
        content.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": body.image_base64,
                },
            }
        )

    tool_input = call_tool(
        system="You are DrawAI's diagram explainer. Always call emit_text with clear prose.",
        messages=[{"role": "user", "content": content}],
        tool_name="emit_text",
        tool_description="Return the explanation or summary text.",
        parameters={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
        max_tokens=2048,
    )
    text = str(tool_input.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="Model returned empty explanation")
    return TextResponse(text=text)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
