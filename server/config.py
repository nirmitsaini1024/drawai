"""Runtime configuration, read once from the environment (and server/.env for local dev)."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent / ".env"
# override=True: server/.env wins over stale variables exported in the shell.
load_dotenv(ENV_PATH, override=True)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://drawai:drawai@localhost:5432/drawai",
)

# AI provider (OpenRouter). ANTHROPIC_API_KEY is accepted as a fallback name.
API_KEY = os.getenv("OPENROUTER_API_KEY", "") or os.getenv("ANTHROPIC_API_KEY", "")
MODEL = os.getenv("MODEL", "deepseek/deepseek-v4.1-flash-1017")
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# Comma-separated list of allowed browser origins.
WEB_ORIGIN = os.getenv("WEB_ORIGIN", "http://localhost:5173")
APP_URL = os.getenv("OPENROUTER_HTTP_REFERER", WEB_ORIGIN.split(",")[0].strip())
APP_TITLE = os.getenv("OPENROUTER_APP_TITLE", "DrawAI")

# Reject snapshots larger than this (bytes of serialized JSON).
MAX_SNAPSHOT_BYTES = int(os.getenv("MAX_SNAPSHOT_BYTES", str(20 * 1024 * 1024)))


def allowed_origins() -> list[str]:
    return [o.strip() for o in WEB_ORIGIN.split(",") if o.strip()]
