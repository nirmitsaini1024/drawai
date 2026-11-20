"""Share-token helpers. Raw tokens are never stored or logged."""

from __future__ import annotations

import hashlib
import hmac
import secrets

TOKEN_BYTES = 32  # 256 bits of entropy (requirement: >= 128)


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_match(candidate_hash: str, stored_hash: str) -> bool:
    """Constant-time comparison of two token hashes."""
    return hmac.compare_digest(candidate_hash.encode("ascii"), stored_hash.encode("ascii"))
