from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("OPENROUTER_API_KEY", "test-key-not-real")

import db  # noqa: E402
from main import app  # noqa: E402
from orm import Base  # noqa: E402


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    # One shared in-memory SQLite connection per test; JSONB falls back to JSON.
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    db.configure_engine(engine)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    await engine.dispose()


@pytest.fixture
def snapshot() -> dict:
    return {"document": {"store": {"shape:a": {"id": "shape:a", "typeName": "shape"}}, "schema": {}}}
