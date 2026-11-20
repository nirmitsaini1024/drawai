"""Shared helpers for AI endpoints: rate limit acquire/release, JSON responses, LLM call+retry."""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from typing import Any, Iterator

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse
from openai import APIError, OpenAI

import config
from guardrails.blocklist import REFUSAL_MESSAGE
from guardrails.logging import GuardrailOutcome, log_ai_request
from guardrails.rate_limiter import RateLimitResult, get_rate_limiter
from identity import client_id_from_request


def require_api_key() -> None:
    if not config.API_KEY:
        raise HTTPException(
            status_code=500,
            detail="OPENROUTER_API_KEY is not set in server/.env",
        )


def openrouter_client() -> OpenAI:
    require_api_key()
    return OpenAI(
        api_key=config.API_KEY,
        base_url=config.OPENROUTER_BASE_URL,
        default_headers={
            "HTTP-Referer": config.APP_URL,
            "X-Title": config.APP_TITLE,
        },
        timeout=config.LLM_TIMEOUT_SECONDS,
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
            raise ValueError(f"Invalid JSON in {tool_name} arguments: {exc}") from exc
        if isinstance(parsed, dict):
            return parsed
        raise ValueError(f"{tool_name} arguments must be an object")
    raise ValueError(f"Model did not return a {tool_name} tool call")


def _usage_tokens(completion: Any) -> tuple[int | None, int | None]:
    usage = getattr(completion, "usage", None)
    if not usage:
        return None, None
    return getattr(usage, "prompt_tokens", None), getattr(usage, "completion_tokens", None)


def call_tool_once(
    *,
    system: str,
    messages: list[dict[str, Any]],
    tool_name: str,
    tool_description: str,
    parameters: dict[str, Any],
    max_tokens: int | None = None,
) -> tuple[dict[str, Any], int | None, int | None]:
    client = openrouter_client()
    completion = client.chat.completions.create(
        model=config.MODEL,
        max_tokens=max_tokens if max_tokens is not None else config.LLM_MAX_TOKENS,
        temperature=config.LLM_TEMPERATURE,
        messages=[
            {"role": "system", "content": system},
            *normalize_messages(messages),
        ],
        tools=[openai_tool(tool_name, tool_description, parameters)],
        tool_choice={"type": "function", "function": {"name": tool_name}},
    )
    choice = completion.choices[0] if completion.choices else None
    if not choice or not choice.message:
        raise ValueError("Empty response from model")
    args = extract_tool_arguments(choice.message, tool_name)
    pt, ct = _usage_tokens(completion)
    return args, pt, ct


def call_tool_with_retry(
    *,
    system: str,
    messages: list[dict[str, Any]],
    tool_name: str,
    tool_description: str,
    parameters: dict[str, Any],
    max_tokens: int | None = None,
    validate: Any | None = None,
) -> tuple[dict[str, Any], int | None, int | None]:
    """Call the model; on invalid JSON/schema retry once. Retries share the same rate-limit slot."""
    last_err: Exception | None = None
    prompt_tokens = 0
    completion_tokens = 0
    for attempt in range(2):
        try:
            args, pt, ct = call_tool_once(
                system=system,
                messages=messages,
                tool_name=tool_name,
                tool_description=tool_description,
                parameters=parameters,
                max_tokens=max_tokens,
            )
            if pt:
                prompt_tokens += pt
            if ct:
                completion_tokens += ct
            if validate is not None:
                validate(args)
            return args, prompt_tokens or None, completion_tokens or None
        except (ValueError, TypeError, APIError, HTTPException) as exc:
            last_err = exc
            if attempt == 0:
                # Nudge the model on retry.
                messages = [
                    *messages,
                    {
                        "role": "user",
                        "content": (
                            "Your previous response was invalid. Call the tool again with "
                            "valid JSON matching the schema exactly. Set in_scope correctly."
                        ),
                    },
                ]
                continue
            break
    raise last_err or ValueError("Model call failed")


def rate_limit_response(result: RateLimitResult) -> JSONResponse:
    msg = {
        "per_minute": "Too many AI requests. Please wait a moment.",
        "daily": "Daily AI request limit reached. Try again tomorrow.",
        "concurrent": "An AI request is already in progress. Wait for it to finish.",
        "global": "The service is busy. Please try again shortly.",
    }.get(result.reason, "Too many AI requests. Please wait a moment.")
    headers = {
        "Retry-After": str(result.retry_after_seconds),
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(max(0, result.remaining)),
        "X-RateLimit-Reset": str(int(result.reset_at)),
    }
    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limited",
            "message": msg,
            "retry_after_seconds": result.retry_after_seconds,
        },
        headers=headers,
    )


def json_with_limits(
    content: dict[str, Any],
    *,
    status: int = 200,
    limit_headers: dict[str, str],
) -> JSONResponse:
    return JSONResponse(status_code=status, content=content, headers=limit_headers)


def refused_payload(message: str | None = None) -> dict[str, Any]:
    return {
        "refused": True,
        "message": message or REFUSAL_MESSAGE,
    }


@contextmanager
def ai_request_slot(request: Request, endpoint: str) -> Iterator[tuple[str, dict[str, str]]]:
    """Acquire rate-limit slot; yield (client_id, rate_headers). Release on exit.

    Raises HTTPException-like via yielding a sentinel — callers should use try_acquire instead.
    """
    client_id = client_id_from_request(request)
    limiter = get_rate_limiter()
    result = limiter.acquire(client_id)
    headers = {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(max(0, result.remaining)),
        "X-RateLimit-Reset": str(int(result.reset_at)),
    }
    if not result.allowed:
        log_ai_request(
            endpoint=endpoint,
            client_id=client_id,
            outcome=GuardrailOutcome.rate_limited,
        )
        raise RateLimited(result)
    started = time.perf_counter()
    try:
        yield client_id, headers
    finally:
        limiter.release(client_id)
        # latency logged by caller


class RateLimited(Exception):
    def __init__(self, result: RateLimitResult) -> None:
        self.result = result
        super().__init__("rate_limited")


def friendly_llm_error() -> str:
    return "The diagram assistant could not complete that request. Please try again."
