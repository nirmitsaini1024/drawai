"""Per-IP rate limiting shared by the AI and share endpoints."""

from __future__ import annotations

import os

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

# Behind nginx every request comes from the proxy's IP. Only trust
# X-Forwarded-For when explicitly told we sit behind a trusted proxy.
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") == "1"


def client_ip(request: Request) -> str:
    if TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return get_remote_address(request)


limiter = Limiter(key_func=client_ip)
