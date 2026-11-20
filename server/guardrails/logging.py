"""Metadata-only AI request logging and simple counters."""

from __future__ import annotations

import logging
import threading
import time
from collections import Counter
from enum import Enum
from typing import Any

from identity import client_hash

logger = logging.getLogger("drawai.guardrails")


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


def log_ai_request(
    *,
    endpoint: str,
    client_id: str,
    outcome: GuardrailOutcome | str,
    latency_ms: float | None = None,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
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
    # Never log prompts, board content, images, or API keys.
    logger.info("ai_request %s", payload)


def get_stats() -> dict[str, Any]:
    with _lock:
        return {
            "outcomes": dict(_counters),
            "by_endpoint": dict(_endpoint_counters),
        }
