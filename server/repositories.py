"""Data-access layer. Routers go through these classes only (add owner scoping here later)."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orm import Board, LibraryShape, RoomLink, ShareRole, utcnow
from security import hash_token, new_token, tokens_match


def to_utc(value: datetime) -> datetime:
    """SQLite returns naive datetimes; Postgres returns aware ones. Normalize to aware UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class ConflictError(Exception):
    """Optimistic-concurrency failure. `current` is the server's copy."""

    def __init__(self, current: Board) -> None:
        super().__init__("conflict")
        self.current = current


class DuplicateError(Exception):
    pass


class BoardRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self) -> list[Board]:
        # Deliberately excludes the (large) snapshot column from the listing query.
        stmt = (
            select(Board)
            .where(Board.deleted_at.is_(None))
            .order_by(Board.updated_at.desc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get(self, board_id: uuid.UUID, *, for_update: bool = False) -> Board | None:
        stmt = select(Board).where(Board.id == board_id, Board.deleted_at.is_(None))
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def create(self, *, board_id: uuid.UUID | None, name: str, snapshot: dict[str, Any] | None) -> Board:
        now = utcnow()
        if board_id is not None:
            existing = (
                await self.session.execute(select(Board).where(Board.id == board_id).with_for_update())
            ).scalar_one_or_none()
            if existing is not None:
                if existing.deleted_at is None:
                    raise DuplicateError
                # Deleted on the server but re-created by a client that kept editing it
                # offline: last write wins, so revive the row.
                existing.name = name
                existing.snapshot = snapshot
                existing.deleted_at = None
                existing.updated_at = now
                await self.session.commit()
                return existing
        board = Board(
            id=board_id or uuid.uuid4(),
            name=name,
            snapshot=snapshot,
            created_at=now,
            updated_at=now,
        )
        self.session.add(board)
        await self.session.commit()
        return board

    async def update(
        self,
        board_id: uuid.UUID,
        *,
        name: str | None,
        snapshot: dict[str, Any] | None,
        snapshot_provided: bool,
        expected_updated_at: datetime | None,
    ) -> Board | None:
        board = await self.get(board_id, for_update=True)
        if board is None:
            return None
        if expected_updated_at is not None and to_utc(board.updated_at) != to_utc(expected_updated_at):
            raise ConflictError(board)
        if name is not None:
            board.name = name
        if snapshot_provided:
            board.snapshot = snapshot
        board.updated_at = utcnow()
        await self.session.commit()
        return board

    async def soft_delete(self, board_id: uuid.UUID) -> bool:
        board = await self.get(board_id, for_update=True)
        if board is None:
            return False
        board.deleted_at = utcnow()
        await self.session.commit()
        return True


class LibraryRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list(self) -> list[LibraryShape]:
        stmt = select(LibraryShape).order_by(LibraryShape.created_at.desc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def get(self, shape_id: uuid.UUID) -> LibraryShape | None:
        return (
            await self.session.execute(select(LibraryShape).where(LibraryShape.id == shape_id))
        ).scalar_one_or_none()

    async def create(
        self,
        *,
        shape_id: uuid.UUID | None,
        name: str,
        category: str,
        content: dict[str, Any],
        thumbnail: str,
        created_at: datetime | None,
    ) -> LibraryShape:
        if shape_id is not None and await self.get(shape_id) is not None:
            raise DuplicateError
        now = utcnow()
        shape = LibraryShape(
            id=shape_id or uuid.uuid4(),
            name=name,
            category=category,
            content=content,
            thumbnail=thumbnail,
            created_at=to_utc(created_at) if created_at else now,
            updated_at=now,
        )
        self.session.add(shape)
        await self.session.commit()
        return shape

    async def update(self, shape_id: uuid.UUID, fields: dict[str, Any]) -> LibraryShape | None:
        shape = await self.get(shape_id)
        if shape is None:
            return None
        for key, value in fields.items():
            setattr(shape, key, value)
        shape.updated_at = utcnow()
        await self.session.commit()
        return shape

    async def delete(self, shape_id: uuid.UUID) -> bool:
        shape = await self.get(shape_id)
        if shape is None:
            return False
        await self.session.delete(shape)
        await self.session.commit()
        return True


class ShareRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create_link(self, board_id: uuid.UUID, role: ShareRole) -> tuple[RoomLink, str]:
        token = new_token()
        link = RoomLink(board_id=board_id, token_hash=hash_token(token), role=role, created_at=utcnow())
        self.session.add(link)
        await self.session.commit()
        return link, token

    async def list_for_board(self, board_id: uuid.UUID) -> list[RoomLink]:
        stmt = select(RoomLink).where(RoomLink.board_id == board_id).order_by(RoomLink.created_at.desc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def get(self, link_id: uuid.UUID) -> RoomLink | None:
        return (
            await self.session.execute(select(RoomLink).where(RoomLink.id == link_id))
        ).scalar_one_or_none()

    async def revoke(self, link: RoomLink) -> None:
        if link.revoked_at is None:
            link.revoked_at = utcnow()
            await self.session.commit()

    async def find_active_by_token(self, token: str) -> RoomLink | None:
        """Look up by hash, then re-verify in constant time. Revoked links never match."""
        candidate = hash_token(token)
        link = (
            await self.session.execute(select(RoomLink).where(RoomLink.token_hash == candidate))
        ).scalar_one_or_none()
        if link is None or not tokens_match(candidate, link.token_hash):
            return None
        if link.revoked_at is not None:
            return None
        return link
