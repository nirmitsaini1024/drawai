"""Metadata-only AI request logging and simple counters.

Writes to stderr (uvicorn) and a rotating file under server/logs/ so LLM failures
can be inspected later without exposing details in the API response.
"""

from __future__ import annotations

import logging
import threading
import time
import traceback
from collections import Counter
from enum import Enum
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

import config
from identity import client_hash

logger = logging.getLogger("drawai.guardrails")

_configured = False
_configure_lock = threading.Lock()


class GuardrailOutcome(str, Enum):
    ok = "ok"
    refused_scope = "refused_scope"
    refused_blocklist = "refused_blocklist"
    rate_limited = "rate_limited"
    invalid_input = "invalid_input"
    invalid_output = "invalid_output"
    error = "error"


_lock = threading.Lock()
_counters: Counter[str] = Counter()
_endpoint_counters: Counter[str] = Counter()


def reset_stats_for_tests() -> None:
    with _lock:
        _counters.clear()
        _endpoint_counters.clear()


def configure_logging() -> Path:
    """Attach a rotating file handler once. Safe to call repeatedly.

    Returns the log file path.
    """
    global _configured
    log_path = Path(config.LOG_DIR) / config.LOG_FILE
    with _configure_lock:
        if _configured:
            return log_path
        log_path.parent.mkdir(parents=True, exist_ok=True)

        root = logging.getLogger("drawai")
        root.setLevel(logging.INFO)
        # Avoid duplicate handlers if reload/re-import races.
        already = any(
            isinstance(h, RotatingFileHandler) and Path(getattr(h, "baseFilename", "")) == log_path.resolve()
            for h in root.handlers
        )
        if not already:
            handler = RotatingFileHandler(
                log_path,
                maxBytes=config.LOG_MAX_BYTES,
                backupCount=config.LOG_BACKUP_COUNT,
                encoding="utf-8",
            )
            handler.setLevel(logging.INFO)
            handler.setFormatter(
                logging.Formatter(
                    "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                    datefmt="%Y-%m-%dT%H:%M:%SZ",
                )
            )
            # Use UTC timestamps to match ai_request payload.
            handler.formatter.converter = time.gmtime  # type: ignore[attr-defined]
            root.addHandler(handler)
            # Also mirror to the process logger so uvicorn console still shows them.
            if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, RotatingFileHandler) for h in root.handlers):
                stream = logging.StreamHandler()
                stream.setLevel(logging.INFO)
                stream.setFormatter(
                    logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
                )
                root.addHandler(stream)
        # Ensure child logger propagates to drawai root.
        logger.setLevel(logging.INFO)
        logger.propagate = True
        _configured = True
        logger.info("ai_logging file=%s", str(log_path))
    return log_path


def _error_fields(error: BaseException | None, error_detail: str | None) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    if error is not None:
        # Truncate — never dump huge provider bodies or stack dumps into one line.
        msg = str(error).strip().replace("\n", " ")[:500]
        fields["error_type"] = type(error).__name__
        fields["error"] = msg or type(error).__name__
        # Full traceback only for unexpected failures (not schema/ValueError noise).
        if not isinstance(error, (ValueError, TypeError)):
            tb = "".join(traceback.format_exception(type(error), error, error.__traceback__))
            fields["traceback"] = tb[-4000:]
    if error_detail:
        fields["error_detail"] = error_detail[:500]
    return fields


def log_ai_request(
    *,
    endpoint: str,
    client_id: str,
    outcome: GuardrailOutcome | str,
    latency_ms: float | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    error: BaseException | None = None,
    error_detail: str | None = None,
) -> None:
    outcome_s = outcome.value if isinstance(outcome, GuardrailOutcome) else str(outcome)
    with _lock:
        _counters[outcome_s] += 1
        _endpoint_counters[f"{endpoint}:{outcome_s}"] += 1

    payload: dict[str, Any] = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "endpoint": endpoint,
        "client_hash": client_hash(client_id),
        "outcome": outcome_s,
    }
    if latency_ms is not None:
        payload["latency_ms"] = round(latency_ms, 1)
    if prompt_tokens is not None:
        payload["prompt_tokens"] = prompt_tokens
    if completion_tokens is not None:
        payload["completion_tokens"] = completion_tokens
    payload.update(_error_fields(error, error_detail))
    # Never log prompts, board content, images, or API keys.
    level = logging.ERROR if outcome_s in {"error", "invalid_output"} or error else logging.INFO
    logger.log(level, "ai_request %s", payload)


def get_stats() -> dict[str, Any]:
    with _lock:
        return {
            "outcomes": dict(_counters),
            "by_endpoint": dict(_endpoint_counters),
        }
