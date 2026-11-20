from __future__ import annotations

import json
from typing import Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

import config
from db import get_session
from errors import too_large
from repositories import BoardRepository, LibraryRepository, ShareRepository


def boards_repo(session: AsyncSession = Depends(get_session)) -> BoardRepository:
    return BoardRepository(session)


def library_repo(session: AsyncSession = Depends(get_session)) -> LibraryRepository:
    return LibraryRepository(session)


def share_repo(session: AsyncSession = Depends(get_session)) -> ShareRepository:
    return ShareRepository(session)


def ensure_size(value: Any) -> None:
    """Reject JSON payloads over MAX_SNAPSHOT_BYTES (default 20 MB)."""
    if value is None:
        return
    size = len(json.dumps(value, separators=(",", ":")).encode("utf-8"))
    if size > config.MAX_SNAPSHOT_BYTES:
        raise too_large(config.MAX_SNAPSHOT_BYTES)
