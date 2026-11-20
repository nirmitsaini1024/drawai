from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

KINDS_PATH = Path(__file__).resolve().parent / "kinds.json"


def load_preset_kinds() -> list[str]:
    data = json.loads(KINDS_PATH.read_text(encoding="utf-8"))
    kinds = data.get("kinds") or []
    if not isinstance(kinds, list) or not kinds:
        raise RuntimeError(f"No kinds found in {KINDS_PATH}")
    return [str(k) for k in kinds]


PRESET_KINDS = load_preset_kinds()
PRESET_KIND_SET = set(PRESET_KINDS)
MAX_NODES = 40
MAX_GROUPS = 8
MAX_LABEL_CHARS = 60
MAX_DESCRIPTION_CHARS = 90

NODE_SHAPES = ["terminator", "process", "decision", "io", "data", "person", "service", "document"]
NODE_SHAPE_SET = set(NODE_SHAPES)
TONES = ["neutral", "primary", "success", "warning", "danger", "info"]
TONE_SET = set(TONES)
EDGE_KINDS = ["default", "yes", "no", "error", "async"]
EDGE_KIND_SET = set(EDGE_KINDS)
DIRECTIONS = ["auto", "LR", "TB"]


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(str(value).split())
    return cleaned[:limit] if cleaned else None


class GraphNode(BaseModel):
    id: str
    label: str
    kind: str = "process"
    shape: str | None = None
    tone: str | None = None
    group: str | None = None
    description: str | None = None

    @field_validator("kind")
    @classmethod
    def normalize_kind(cls, value: str) -> str:
        if value in PRESET_KIND_SET:
            return value
        return "rect"

    @field_validator("shape")
    @classmethod
    def normalize_shape(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        # Unknown shapes degrade to a plain process card.
        return value if value in NODE_SHAPE_SET else "process"

    @field_validator("tone")
    @classmethod
    def normalize_tone(cls, value: str | None) -> str | None:
        return value if value in TONE_SET else None

    @field_validator("label")
    @classmethod
    def cap_label(cls, value: str) -> str:
        return _clip(value, MAX_LABEL_CHARS) or "Step"

    @field_validator("description")
    @classmethod
    def cap_description(cls, value: str | None) -> str | None:
        return _clip(value, MAX_DESCRIPTION_CHARS)


class GraphGroup(BaseModel):
    id: str
    label: str
    tone: str | None = None

    @field_validator("tone")
    @classmethod
    def normalize_tone(cls, value: str | None) -> str | None:
        return value if value in TONE_SET else None

    @field_validator("label")
    @classmethod
    def cap_label(cls, value: str) -> str:
        return _clip(value, MAX_LABEL_CHARS) or "Group"


class GraphEdge(BaseModel):
    from_: str = Field(alias="from")
    to: str
    label: str | None = None
    kind: str | None = None

    model_config = {"populate_by_name": True}

    @field_validator("kind")
    @classmethod
    def normalize_kind(cls, value: str | None) -> str | None:
        return value if value in EDGE_KIND_SET else None

    @field_validator("label")
    @classmethod
    def cap_label(cls, value: str | None) -> str | None:
        return _clip(value, 40)


class Graph(BaseModel):
    direction: Literal["LR", "TB", "auto"] = "auto"
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    groups: list[GraphGroup] = Field(default_factory=list)


class DiagramRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    current: Graph | None = None


class ImageDiagramRequest(BaseModel):
    image_base64: str = Field(min_length=8, max_length=6_000_000)
    media_type: Literal["image/png", "image/jpeg", "image/webp", "image/gif"] = "image/png"
    prompt: str = Field(default="Convert this sketch into a clear diagram.", max_length=2000)


class MermaidRequest(BaseModel):
    source: str = Field(min_length=1, max_length=20_000)


class TextResponse(BaseModel):
    text: str


MAX_OPS = 50


class SelectionBounds(BaseModel):
    x: float
    y: float
    w: float
    h: float


class SelectionShape(BaseModel):
    id: str
    type: str
    bounds: SelectionBounds
    props: dict[str, Any] = Field(default_factory=dict)
    locked: bool = False


class SelectionBinding(BaseModel):
    arrowId: str
    fromId: str
    toId: str
    label: str | None = None


class ExplainRequest(BaseModel):
    mode: Literal["explain", "summarize"] = "explain"
    shapes: list[SelectionShape] = Field(min_length=1)
    bindings: list[SelectionBinding] = Field(default_factory=list)
    image_base64: str | None = Field(default=None, max_length=4_000_000)


class EditRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    shapes: list[SelectionShape] = Field(min_length=1)
    bindings: list[SelectionBinding] = Field(default_factory=list)
    # optional PNG of the selection as base64 (no data: prefix required)
    image_base64: str | None = Field(default=None, max_length=4_000_000)


class UpdateOp(BaseModel):
    op: Literal["update"]
    id: str
    x: float | None = None
    y: float | None = None
    props: dict[str, Any] | None = None


class CreateOp(BaseModel):
    op: Literal["create"]
    tempId: str
    kind: str
    label: str = ""
    shape: str | None = None
    tone: str | None = None
    description: str | None = None
    x: float
    y: float
    w: float | None = None
    h: float | None = None


class DeleteOp(BaseModel):
    op: Literal["delete"]
    id: str


class ConnectOp(BaseModel):
    op: Literal["connect"]
    fromId: str
    toId: str
    label: str | None = None
    kind: str | None = None


EditOp = UpdateOp | CreateOp | DeleteOp | ConnectOp


class EditResponse(BaseModel):
    ops: list[dict[str, Any]] = Field(default_factory=list)
    summary: str | None = None


def _parse_op(raw: dict[str, Any]) -> EditOp | None:
    kind = raw.get("op")
    try:
        if kind == "update":
            return UpdateOp.model_validate(raw)
        if kind == "create":
            return CreateOp.model_validate(raw)
        if kind == "delete":
            return DeleteOp.model_validate(raw)
        if kind == "connect":
            return ConnectOp.model_validate(raw)
    except Exception:  # noqa: BLE001
        return None
    return None


def sanitize_edit_ops(raw: dict[str, Any] | EditResponse, allowed_ids: set[str]) -> EditResponse:
    """Validate model output: only patch ops, capped, kinds from registry."""
    if isinstance(raw, EditResponse):
        payload = raw
    else:
        payload = EditResponse.model_validate(raw)

    ops_out: list[dict[str, Any]] = []
    created_temps: set[str] = set()

    for entry in payload.ops[:MAX_OPS]:
        if not isinstance(entry, dict):
            continue
        item = _parse_op(entry)
        if item is None:
            continue

        if isinstance(item, UpdateOp):
            if item.id not in allowed_ids:
                continue
            props = None
            if item.props:
                props = {}
                if "label" in item.props and isinstance(item.props["label"], str):
                    props["label"] = _clip(item.props["label"], MAX_LABEL_CHARS) or ""
                if "kind" in item.props and isinstance(item.props["kind"], str):
                    kind = item.props["kind"]
                    props["kind"] = kind if kind in PRESET_KIND_SET else "rect"
                if "shape" in item.props and isinstance(item.props["shape"], str):
                    shp = item.props["shape"]
                    props["shape"] = shp if shp in NODE_SHAPE_SET else "process"
                if "tone" in item.props and item.props["tone"] in TONE_SET:
                    props["tone"] = item.props["tone"]
                if "description" in item.props and isinstance(item.props["description"], str):
                    props["description"] = item.props["description"][:MAX_DESCRIPTION_CHARS]
                if "w" in item.props and isinstance(item.props["w"], (int, float)):
                    props["w"] = max(48.0, min(float(item.props["w"]), 400.0))
                if "h" in item.props and isinstance(item.props["h"], (int, float)):
                    props["h"] = max(32.0, min(float(item.props["h"]), 300.0))
                if "color" in item.props and isinstance(item.props["color"], str):
                    props["color"] = item.props["color"]
            ops_out.append(
                UpdateOp(op="update", id=item.id, x=item.x, y=item.y, props=props or None).model_dump(
                    exclude_none=True
                )
            )
        elif isinstance(item, CreateOp):
            kind = item.kind if item.kind in PRESET_KIND_SET else "rect"
            temp = item.tempId.strip() or f"new_{len(created_temps)}"
            if temp in created_temps or temp in allowed_ids:
                temp = f"{temp}_{len(created_temps)}"
            created_temps.add(temp)
            ops_out.append(
                CreateOp(
                    op="create",
                    tempId=temp,
                    kind=kind,
                    label=(_clip(item.label, MAX_LABEL_CHARS) or kind),
                    shape=(item.shape if item.shape in NODE_SHAPE_SET else ("process" if item.shape else None)),
                    tone=(item.tone if item.tone in TONE_SET else None),
                    description=_clip(item.description, MAX_DESCRIPTION_CHARS),
                    x=item.x,
                    y=item.y,
                    w=(max(48.0, min(item.w, 400.0)) if item.w is not None else None),
                    h=(max(32.0, min(item.h, 300.0)) if item.h is not None else None),
                ).model_dump(exclude_none=True)
            )
        elif isinstance(item, DeleteOp):
            if item.id in allowed_ids:
                ops_out.append(item.model_dump())
        elif isinstance(item, ConnectOp):
            known = allowed_ids | created_temps
            if item.fromId in known and item.toId in known:
                ops_out.append(
                    ConnectOp(
                        op="connect",
                        fromId=item.fromId,
                        toId=item.toId,
                        label=_clip(item.label, 40),
                        kind=(item.kind if item.kind in EDGE_KIND_SET else None),
                    ).model_dump(exclude_none=True)
                )

    return EditResponse(ops=ops_out, summary=payload.summary)


def apply_edits_tool_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "One-line description of the patch for the user",
            },
            "ops": {
                "type": "array",
                "maxItems": MAX_OPS,
                "description": "Patch operations only — never a full diagram rebuild",
                "items": {
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "const": "update"},
                                "id": {"type": "string"},
                                "x": {"type": "number"},
                                "y": {"type": "number"},
                                "props": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "kind": {"type": "string", "enum": PRESET_KINDS},
                                        "shape": {"type": "string", "enum": NODE_SHAPES},
                                        "tone": {"type": "string", "enum": TONES},
                                        "description": {"type": "string"},
                                        "w": {"type": "number"},
                                        "h": {"type": "number"},
                                        "color": {"type": "string"},
                                    },
                                    "additionalProperties": False,
                                },
                            },
                            "required": ["op", "id"],
                            "additionalProperties": False,
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "const": "create"},
                                "tempId": {"type": "string"},
                                "kind": {"type": "string", "enum": PRESET_KINDS},
                                "label": {"type": "string", "description": "At most 4 words"},
                                "shape": {"type": "string", "enum": NODE_SHAPES},
                                "tone": {"type": "string", "enum": TONES},
                                "description": {"type": "string"},
                                "x": {"type": "number"},
                                "y": {"type": "number"},
                                "w": {"type": "number"},
                                "h": {"type": "number"},
                            },
                            "required": ["op", "tempId", "kind", "x", "y"],
                            "additionalProperties": False,
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "const": "delete"},
                                "id": {"type": "string"},
                            },
                            "required": ["op", "id"],
                            "additionalProperties": False,
                        },
                        {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "const": "connect"},
                                "fromId": {"type": "string"},
                                "toId": {"type": "string"},
                                "label": {"type": "string"},
                                "kind": {"type": "string", "enum": EDGE_KINDS},
                            },
                            "required": ["op", "fromId", "toId"],
                            "additionalProperties": False,
                        },
                    ]
                },
            },
        },
        "required": ["ops"],
        "additionalProperties": False,
    }


def sanitize_graph(raw: dict[str, Any] | Graph) -> Graph:
    graph = raw if isinstance(raw, Graph) else Graph.model_validate(raw)

    seen: set[str] = set()
    nodes: list[GraphNode] = []
    for node in graph.nodes:
        if node.id in seen:
            continue
        seen.add(node.id)
        nodes.append(node)
        if len(nodes) >= MAX_NODES:
            break
    known = {n.id for n in nodes}

    # Drop unknown refs: edges to missing nodes, self loops, duplicates.
    edges: list[GraphEdge] = []
    seen_edges: set[tuple[str, str, str | None]] = set()
    for edge in graph.edges:
        if edge.from_ not in known or edge.to not in known or edge.from_ == edge.to:
            continue
        key = (edge.from_, edge.to, edge.label)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        edges.append(edge)

    group_ids: set[str] = set()
    groups_in: list[GraphGroup] = []
    for group in graph.groups:
        if group.id in group_ids or group.id in known:
            continue
        group_ids.add(group.id)
        groups_in.append(group)
        if len(groups_in) >= MAX_GROUPS:
            break
    for node in nodes:
        if node.group is not None and node.group not in group_ids:
            node.group = None
    used = {n.group for n in nodes if n.group}
    groups = [g for g in groups_in if g.id in used]

    return Graph(direction=graph.direction, nodes=nodes, edges=edges, groups=groups)


def tool_input_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "direction": {
                "type": "string",
                "enum": DIRECTIONS,
                "description": (
                    "Layout direction. Use 'auto' unless the user explicitly asked for "
                    "left-to-right (LR) or top-to-bottom (TB)."
                ),
            },
            "groups": {
                "type": "array",
                "maxItems": MAX_GROUPS,
                "description": "Optional containers for related nodes (VPC, service boundary, swimlane).",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string", "description": "Short title, max 4 words"},
                        "tone": {"type": "string", "enum": TONES},
                    },
                    "required": ["id", "label"],
                    "additionalProperties": False,
                },
            },
            "nodes": {
                "type": "array",
                "maxItems": MAX_NODES,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "label": {"type": "string", "description": "At most 4 words"},
                        "kind": {
                            "type": "string",
                            "enum": PRESET_KINDS,
                            "description": "Preset kind; icon kinds (database, server, aws...) draw an icon in the card",
                        },
                        "shape": {
                            "type": "string",
                            "enum": NODE_SHAPES,
                            "description": (
                                "terminator = start/end pill, process = step, decision = yes/no question, "
                                "io = input/output, data = data store, person = actor, "
                                "service = infrastructure component, document"
                            ),
                        },
                        "tone": {
                            "type": "string",
                            "enum": TONES,
                            "description": "Semantic color: danger for errors, success for success states, warning for decisions",
                        },
                        "group": {"type": "string", "description": "id of a group this node belongs to"},
                        "description": {
                            "type": "string",
                            "description": "Optional second line of smaller text (max ~8 words)",
                        },
                    },
                    "required": ["id", "label", "kind"],
                    "additionalProperties": False,
                },
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "from": {"type": "string"},
                        "to": {"type": "string"},
                        "label": {"type": "string"},
                        "kind": {"type": "string", "enum": EDGE_KINDS},
                    },
                    "required": ["from", "to"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["direction", "nodes", "edges"],
        "additionalProperties": False,
    }
