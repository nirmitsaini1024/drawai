"""Per-IP rate limiting for non-AI endpoints (share links). AI uses guardrails.rate_limiter."""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter

from identity import client_ip


def _key(request: Request) -> str:
    return client_ip(request)


limiter = Limiter(key_func=_key)
