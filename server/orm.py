"""SQLAlchemy 2.0 ORM models.

Snapshots are opaque JSONB blobs; we never query inside them.
Ownership: this is a single-owner instance. To add accounts later, add an
`owner_id` column to boards / library_shapes with a migration and filter in
the repository layer (`repositories.py`) - routers never touch the ORM directly.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Index, String, Text, Uuid
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# JSONB on Postgres, plain JSON elsewhere (tests run on SQLite).
JsonB = JSONB().with_variant(JSON(), "sqlite")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class ShareRole(str, enum.Enum):
    edit = "edit"
    view = "view"


class Board(Base):
    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    snapshot: Mapped[dict[str, Any] | None] = mapped_column(JsonB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_boards_updated_at", "updated_at"),)


class LibraryShape(Base):
    __tablename__ = "library_shapes"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(100), nullable=False, default="General")
    content: Mapped[dict[str, Any]] = mapped_column(JsonB, nullable=False)
    thumbnail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("ix_library_shapes_updated_at", "updated_at"),)


class Room(Base):
    """Live collaboration room snapshot, owned/written by the Node sync server."""

    __tablename__ = "rooms"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    board_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), nullable=True
    )
    snapshot: Mapped[dict[str, Any]] = mapped_column(JsonB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    __table_args__ = (Index("ix_rooms_updated_at", "updated_at"),)


class RoomLink(Base):
    __tablename__ = "room_links"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False
    )
    # sha256 hex of the raw token. The raw token is shown once and never stored.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    role: Mapped[ShareRole] = mapped_column(
        Enum(ShareRole, name="share_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (Index("ix_room_links_board_id", "board_id"),)
