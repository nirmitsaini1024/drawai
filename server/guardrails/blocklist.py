"""Cheap pattern blocklist for blatant prompt abuse. Never rely on this alone."""

from __future__ import annotations

import re

# Extend this list as new abuse patterns appear. Matching is case-insensitive.
BLOCKLIST_PATTERNS: list[re.Pattern[str]] = [
    re.compile(p, re.IGNORECASE)
    for p in [
        r"\b(show|reveal|print|dump|display)\b.{0,40}\b(system\s*prompt|hidden\s*prompt|your\s*instructions)\b",
        r"\bignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)\b",
        r"\bdisregard\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)\b",
        r"\byou\s+are\s+now\b.{0,40}\b(unrestricted|jailbroken|DAN|general\s+assistant)\b",
        r"\bpretend\s+you\s+are\b.{0,40}\b(general|unrestricted|chatgpt|assistant)\b",
        r"\b(print|dump|show|reveal)\b.{0,30}\b(env|environment|api\s*keys?|OPENROUTER|secrets?)\b",
        r"\b(what|tell me)\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions|rules)\b",
        r"\boverride\s+(your|the)\s+(rules|instructions|guardrails)\b",
        # Blatant non-diagram chit-chat (still backed by model scope checks).
        r"^(tell me |say )?a joke\b",
        r"\btell me a joke\b",
        r"\bare you (chatgpt|claude|an?\s+ai|a language model)\b",
        r"\bshow me the api keys?\b",
        r"\bwrite (me )?(some )?(python|javascript|typescript|java|rust|go|c\+\+|code)\b",
        r"\b(sing|write) (me )?(a |an )?(song|poem|essay|email)\b",
        r"\bdraft (an? |the )?email\b",
        r"\brecommend (a |an )?(restaurant|movie|book|hotel)\b",
        r"\bhow do i invest\b",
        r"\b(summarize|summary of) (today'?s )?(news|headlines)\b",
    ]
]

REFUSAL_MESSAGE = (
    "I can only create and edit diagrams. Try: "
    '"flowchart for user signup", '
    '"3-tier web architecture", or '
    '"ER diagram for a blog".'
)


def matches_blocklist(text: str) -> bool:
    if not text:
        return False
    return any(p.search(text) for p in BLOCKLIST_PATTERNS)
