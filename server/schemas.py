"""Pydantic v2 request/response models for the persistence API."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

from orm import ShareRole
from repositories import to_utc


def _utc(value: Any) -> Any:
    return to_utc(value) if isinstance(value, datetime) else value


# Naive datetimes (SQLite) are treated as UTC so JSON always carries an offset.
UtcDatetime = Annotated[datetime, BeforeValidator(_utc)]


class BoardMeta(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


class BoardOut(BoardMeta):
    snapshot: dict[str, Any] | None = None


class BoardCreate(BaseModel):
    # Clients may supply the id (created offline) so retries are idempotent.
    id: uuid.UUID | None = None
    name: str = Field(default="Untitled", min_length=1, max_length=200)
    snapshot: dict[str, Any] | None = None


class BoardUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    snapshot: dict[str, Any] | None = None
    # The server `updated_at` the client last saw. Mismatch -> 409 + server copy.
    expected_updated_at: UtcDatetime | None = None


class LibraryShapeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    category: str
    content: dict[str, Any]
    thumbnail: str
    created_at: UtcDatetime
    updated_at: UtcDatetime


class LibraryShapeCreate(BaseModel):
    id: uuid.UUID | None = None
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(default="General", min_length=1, max_length=100)
    content: dict[str, Any]
    thumbnail: str = Field(default="", max_length=2_000_000)
    created_at: UtcDatetime | None = None


class LibraryShapeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    content: dict[str, Any] | None = None
    thumbnail: str | None = Field(default=None, max_length=2_000_000)


class ShareCreate(BaseModel):
    role: ShareRole = ShareRole.view


class ShareLinkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    board_id: uuid.UUID
    role: ShareRole
    created_at: UtcDatetime
    revoked_at: UtcDatetime | None = None


class ShareLinkCreated(ShareLinkOut):
    """Returned once on create/rotate; `token` is never retrievable again."""

    token: str
    room_id: str


class RoomResolveOut(BaseModel):
    room_id: str
    board_id: uuid.UUID
    role: ShareRole
    link_id: uuid.UUID
