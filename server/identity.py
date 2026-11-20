"""Client identity for rate limiting and logging.

Swap `client_id_from_request` later to use a user ID once auth exists.
"""

from __future__ import annotations

import hashlib

from fastapi import Request
from slowapi.util import get_remote_address

import config


def client_ip(request: Request) -> str:
    """Return the client IP. Trust X-Forwarded-For only when TRUST_PROXY is set."""
    if config.TRUST_PROXY:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip() or "unknown"
    return get_remote_address(request) or "unknown"


def client_id_from_request(request: Request) -> str:
    """Stable client key for rate limiting. Today: IP. Later: authenticated user id."""
    return f"ip:{client_ip(request)}"


def client_hash(client_id: str) -> str:
    """One-way hash of the client id for logs (never log raw IPs)."""
    digest = hashlib.sha256(f"{config.CLIENT_HASH_SALT}:{client_id}".encode()).hexdigest()
    return digest[:16]
