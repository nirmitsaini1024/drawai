"""initial schema: boards, library_shapes, rooms, room_links

Revision ID: 0001
Revises:
Create Date: 2026-11-20
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TS = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "boards",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("deleted_at", TS, nullable=True),
    )
    op.create_index("ix_boards_updated_at", "boards", ["updated_at"])

    op.create_table(
        "library_shapes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("category", sa.String(100), nullable=False, server_default="General"),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("thumbnail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_library_shapes_updated_at", "library_shapes", ["updated_at"])

    op.create_table(
        "rooms",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("board_id", sa.Uuid(), sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=True),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("updated_at", TS, nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_rooms_updated_at", "rooms", ["updated_at"])

    op.create_table(
        "room_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("board_id", sa.Uuid(), sa.ForeignKey("boards.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("role", sa.Enum("edit", "view", name="share_role"), nullable=False),
        sa.Column("created_at", TS, nullable=False, server_default=sa.func.now()),
        sa.Column("revoked_at", TS, nullable=True),
    )
    op.create_index("ix_room_links_board_id", "room_links", ["board_id"])


def downgrade() -> None:
    op.drop_index("ix_room_links_board_id", table_name="room_links")
    op.drop_table("room_links")
    op.drop_index("ix_rooms_updated_at", table_name="rooms")
    op.drop_table("rooms")
    op.drop_index("ix_library_shapes_updated_at", table_name="library_shapes")
    op.drop_table("library_shapes")
    op.drop_index("ix_boards_updated_at", table_name="boards")
    op.drop_table("boards")
    sa.Enum(name="share_role").drop(op.get_bind(), checkfirst=True)
