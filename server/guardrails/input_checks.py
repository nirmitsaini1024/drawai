"""Cheap input normalization and validation before any LLM call."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass

import config
from guardrails.blocklist import REFUSAL_MESSAGE, matches_blocklist

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WHITESPACE = re.compile(r"\s+")

ALLOWED_IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})

# Magic-byte signatures (content sniffing; never trust the extension alone).
_IMAGE_SIGS: list[tuple[bytes, str]] = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),  # WebP is RIFF....WEBP — verified below
]


@dataclass
class InputError:
    code: str  # "empty" | "too_long" | "selection_too_large" | "bad_image" | "blocklist"
    message: str
    status: int = 400


def normalize_prompt(text: str | None) -> str:
    if text is None:
        return ""
    cleaned = _CONTROL_CHARS.sub("", str(text))
    cleaned = _WHITESPACE.sub(" ", cleaned).strip()
    return cleaned


def validate_prompt(text: str | None, *, max_chars: int | None = None) -> str | InputError:
    """Trim/normalize. Return cleaned prompt or InputError. Blocklist → standard refusal."""
    limit = max_chars if max_chars is not None else config.MAX_PROMPT_CHARS
    cleaned = normalize_prompt(text)
    if not cleaned:
        return InputError(code="empty", message="Prompt is empty")
    if len(cleaned) > limit:
        return InputError(
            code="too_long",
            message=f"Prompt exceeds {limit} characters",
        )
    if matches_blocklist(cleaned):
        return InputError(code="blocklist", message=REFUSAL_MESSAGE, status=200)
    return cleaned


def validate_selection_payload(
    shapes: list,
    bindings: list,
    *,
    max_shapes: int | None = None,
    max_bytes: int | None = None,
) -> InputError | None:
    shape_limit = max_shapes if max_shapes is not None else config.MAX_SELECTION_SHAPES
    byte_limit = max_bytes if max_bytes is not None else config.MAX_SELECTION_JSON_BYTES
    if len(shapes) > shape_limit:
        return InputError(
            code="selection_too_large",
            message=f"Selection exceeds {shape_limit} shapes",
        )
    try:
        raw = json.dumps(
            {
                "shapes": [s.model_dump() if hasattr(s, "model_dump") else s for s in shapes],
                "bindings": [b.model_dump() if hasattr(b, "model_dump") else b for b in bindings],
            }
        )
    except (TypeError, ValueError):
        return InputError(code="selection_too_large", message="Selection payload is invalid")
    if len(raw.encode("utf-8")) > byte_limit:
        return InputError(
            code="selection_too_large",
            message=f"Selection exceeds {byte_limit} bytes",
        )
    return None


def sniff_image_media_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_image_base64(
    image_base64: str,
    claimed_media_type: str | None = None,
    *,
    max_bytes: int | None = None,
) -> tuple[str, str] | InputError:
    """Decode and verify PNG/JPEG/WebP by content. Returns (base64, media_type) or error."""
    limit = max_bytes if max_bytes is not None else config.MAX_IMAGE_BYTES
    try:
        # Allow whitespace in base64 payloads from clients.
        raw = base64.b64decode(image_base64, validate=False)
    except Exception:  # noqa: BLE001
        return InputError(code="bad_image", message="Image data is not valid base64")
    if len(raw) > limit:
        return InputError(
            code="bad_image",
            message=f"Image exceeds {limit // (1024 * 1024)} MB",
        )
    if len(raw) < 8:
        return InputError(code="bad_image", message="Image data is too small")
    sniffed = sniff_image_media_type(raw)
    if sniffed is None or sniffed not in ALLOWED_IMAGE_TYPES:
        return InputError(
            code="bad_image",
            message="Only PNG, JPEG, and WebP images are allowed",
        )
    if claimed_media_type and claimed_media_type not in ALLOWED_IMAGE_TYPES:
        return InputError(
            code="bad_image",
            message="Only PNG, JPEG, and WebP images are allowed",
        )
    # Prefer sniffed type over client claim.
    return image_base64, sniffed
