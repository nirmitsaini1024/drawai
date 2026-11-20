"""Sanitize model-produced labels and free text for safe plain-text rendering."""

from __future__ import annotations

import re

_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_HTML = re.compile(r"<[^>]+>")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_FMT = re.compile(r"[*_`#~>]+")
_URL = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
_WHITESPACE = re.compile(r"\s+")

MAX_LABEL_CHARS = 60
MAX_LABEL_WORDS = 8
MAX_DESCRIPTION_CHARS = 120
MAX_EXPLANATION_CHARS = 600
MAX_EDGE_LABEL_CHARS = 40


def strip_markup(value: str) -> str:
    text = _CONTROL.sub("", value)
    text = _HTML.sub("", text)
    text = _MD_LINK.sub(r"\1", text)
    text = _MD_FMT.sub("", text)
    text = _URL.sub("", text)
    text = _WHITESPACE.sub(" ", text).strip()
    return text


def sanitize_label(value: str | None, *, max_chars: int = MAX_LABEL_CHARS) -> str | None:
    if value is None:
        return None
    cleaned = strip_markup(str(value))
    if not cleaned:
        return None
    words = cleaned.split()
    if len(words) > MAX_LABEL_WORDS:
        cleaned = " ".join(words[:MAX_LABEL_WORDS])
    if len(cleaned) > max_chars:
        cleaned = cleaned[:max_chars].rstrip()
    return cleaned or None


def sanitize_description(value: str | None) -> str | None:
    return sanitize_label(value, max_chars=MAX_DESCRIPTION_CHARS)


def sanitize_explanation(value: str | None) -> str:
    if not value:
        return ""
    cleaned = strip_markup(str(value))
    if len(cleaned) > MAX_EXPLANATION_CHARS:
        cleaned = cleaned[:MAX_EXPLANATION_CHARS].rstrip()
    return cleaned


def looks_like_paragraph(label: str) -> bool:
    """True when a 'label' is really a long paragraph (drop / truncate)."""
    if len(label) > MAX_LABEL_CHARS:
        return True
    if len(label.split()) > MAX_LABEL_WORDS:
        return True
    if label.count(".") >= 2 and len(label) > 40:
        return True
    return False
