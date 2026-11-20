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

# Behind nginx every request comes from the proxy's IP. Only trust
# X-Forwarded-For when explicitly told we sit behind a trusted proxy.
TRUST_PROXY = os.getenv("TRUST_PROXY", "0") in ("1", "true", "True", "yes")

# ---- AI guardrails ------------------------------------------------------------
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "5"))
DAILY_LIMIT = int(os.getenv("DAILY_LIMIT", "100"))
MAX_CONCURRENT_PER_CLIENT = int(os.getenv("MAX_CONCURRENT_PER_CLIENT", "1"))
GLOBAL_RATE_LIMIT_PER_MINUTE = int(os.getenv("GLOBAL_RATE_LIMIT_PER_MINUTE", "60"))
REDIS_URL = os.getenv("REDIS_URL", "").strip()

MAX_PROMPT_CHARS = int(os.getenv("MAX_PROMPT_CHARS", "800"))
MAX_SELECTION_SHAPES = int(os.getenv("MAX_SELECTION_SHAPES", "150"))
MAX_SELECTION_JSON_BYTES = int(os.getenv("MAX_SELECTION_JSON_BYTES", str(200 * 1024)))
MAX_IMAGE_BYTES = int(os.getenv("MAX_IMAGE_BYTES", str(5 * 1024 * 1024)))

LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "2048"))
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "60"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))

# Salt for hashing client IPs in logs (not a secret for auth — just privacy).
CLIENT_HASH_SALT = os.getenv("CLIENT_HASH_SALT", "drawai-guardrails")

# Protects GET /api/stats/guardrails. Unset → endpoint returns 404.
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "").strip()


def allowed_origins() -> list[str]:
    return [o.strip() for o in WEB_ORIGIN.split(",") if o.strip()]
