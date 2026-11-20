"""Sliding-window + concurrency + daily + global rate limits for AI endpoints."""

from __future__ import annotations

import threading
import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from dataclasses import dataclass
from collections.abc import Callable
from typing import Deque

import config


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_at: float  # unix timestamp when the per-minute window frees a slot
    retry_after_seconds: int = 0
    reason: str = ""  # "per_minute" | "daily" | "concurrent" | "global" | ""


class RateLimiter(ABC):
    @abstractmethod
    def check(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        """Peek whether a request would be allowed (does not consume a slot)."""

    @abstractmethod
    def acquire(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        """Reserve a slot + concurrency. Call release() when the LLM call finishes."""

    @abstractmethod
    def release(self, client_id: str) -> None:
        """Drop one in-flight concurrent reservation."""

    @abstractmethod
    def headers_for(self, client_id: str, *, now: float | None = None) -> dict[str, str]:
        """X-RateLimit-* headers reflecting current remaining quota."""


def _headers(result: RateLimitResult) -> dict[str, str]:
    return {
        "X-RateLimit-Limit": str(result.limit),
        "X-RateLimit-Remaining": str(max(0, result.remaining)),
        "X-RateLimit-Reset": str(int(result.reset_at)),
    }


class InMemoryRateLimiter(RateLimiter):
    """Thread-safe sliding window over the last 60s + daily counters + concurrency."""

    def __init__(
        self,
        *,
        per_minute: int | None = None,
        daily: int | None = None,
        max_concurrent: int | None = None,
        global_per_minute: int | None = None,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.per_minute = per_minute if per_minute is not None else config.RATE_LIMIT_PER_MINUTE
        self.daily = daily if daily is not None else config.DAILY_LIMIT
        self.max_concurrent = (
            max_concurrent if max_concurrent is not None else config.MAX_CONCURRENT_PER_CLIENT
        )
        self.global_per_minute = (
            global_per_minute
            if global_per_minute is not None
            else config.GLOBAL_RATE_LIMIT_PER_MINUTE
        )
        self._clock = clock or time.time
        self._lock = threading.RLock()
        self._minute: dict[str, Deque[float]] = defaultdict(deque)
        self._day: dict[str, tuple[str, int]] = {}  # client -> (YYYY-MM-DD, count)
        self._inflight: dict[str, int] = defaultdict(int)
        self._global: Deque[float] = deque()

    def _now(self, now: float | None) -> float:
        return self._clock() if now is None else now

    def _day_key(self, now: float) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(now))

    def _prune(self, dq: Deque[float], now: float, window: float) -> None:
        cutoff = now - window
        while dq and dq[0] <= cutoff:
            dq.popleft()

    def _cleanup_idle(self, now: float) -> None:
        """Drop clients with no recent activity to bound memory."""
        stale = []
        for cid, dq in self._minute.items():
            self._prune(dq, now, 60.0)
            if not dq and self._inflight.get(cid, 0) == 0:
                stale.append(cid)
        for cid in stale:
            self._minute.pop(cid, None)
            self._inflight.pop(cid, None)
            self._day.pop(cid, None)

    def _snapshot(self, client_id: str, now: float) -> RateLimitResult:
        dq = self._minute[client_id]
        self._prune(dq, now, 60.0)
        self._prune(self._global, now, 60.0)
        used = len(dq)
        remaining = max(0, self.per_minute - used)
        reset_at = (dq[0] + 60.0) if dq else now + 60.0
        return RateLimitResult(
            allowed=True,
            limit=self.per_minute,
            remaining=remaining,
            reset_at=reset_at,
        )

    def check(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        with self._lock:
            return self._evaluate(client_id, now=self._now(now), consume=False)

    def acquire(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        with self._lock:
            result = self._evaluate(client_id, now=self._now(now), consume=True)
            return result

    def _evaluate(self, client_id: str, *, now: float, consume: bool) -> RateLimitResult:
        self._cleanup_idle(now)
        snap = self._snapshot(client_id, now)

        if self._inflight[client_id] >= self.max_concurrent:
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=snap.remaining,
                reset_at=snap.reset_at,
                retry_after_seconds=1,
                reason="concurrent",
            )

        if len(self._global) >= self.global_per_minute:
            retry = max(1, int(self._global[0] + 60.0 - now)) if self._global else 1
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=snap.remaining,
                reset_at=snap.reset_at,
                retry_after_seconds=retry,
                reason="global",
            )

        if len(self._minute[client_id]) >= self.per_minute:
            retry = max(1, int(self._minute[client_id][0] + 60.0 - now))
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=0,
                reset_at=self._minute[client_id][0] + 60.0,
                retry_after_seconds=retry,
                reason="per_minute",
            )

        day = self._day_key(now)
        day_entry = self._day.get(client_id)
        day_count = day_entry[1] if day_entry and day_entry[0] == day else 0
        if day_count >= self.daily:
            # Reset at next UTC midnight
            tomorrow = time.mktime(time.strptime(day, "%Y-%m-%d")) + 86400
            retry = max(1, int(tomorrow - now))
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=0,
                reset_at=tomorrow,
                retry_after_seconds=retry,
                reason="daily",
            )

        if consume:
            self._minute[client_id].append(now)
            self._global.append(now)
            self._day[client_id] = (day, day_count + 1)
            self._inflight[client_id] += 1
            snap = self._snapshot(client_id, now)
            # remaining after consume; inflight already reserved
            return RateLimitResult(
                allowed=True,
                limit=self.per_minute,
                remaining=snap.remaining,
                reset_at=snap.reset_at,
            )

        return snap

    def release(self, client_id: str) -> None:
        with self._lock:
            if self._inflight[client_id] > 0:
                self._inflight[client_id] -= 1
            if self._inflight[client_id] == 0:
                self._inflight.pop(client_id, None)

    def headers_for(self, client_id: str, *, now: float | None = None) -> dict[str, str]:
        with self._lock:
            return _headers(self._snapshot(client_id, self._now(now)))


class RedisRateLimiter(RateLimiter):
    """Redis-backed limiter. Keys expire so idle clients are cleaned up automatically."""

    def __init__(
        self,
        redis_url: str,
        *,
        per_minute: int | None = None,
        daily: int | None = None,
        max_concurrent: int | None = None,
        global_per_minute: int | None = None,
    ) -> None:
        import redis  # optional dependency — only imported when REDIS_URL is set

        self._r = redis.Redis.from_url(redis_url, decode_responses=True)
        self.per_minute = per_minute if per_minute is not None else config.RATE_LIMIT_PER_MINUTE
        self.daily = daily if daily is not None else config.DAILY_LIMIT
        self.max_concurrent = (
            max_concurrent if max_concurrent is not None else config.MAX_CONCURRENT_PER_CLIENT
        )
        self.global_per_minute = (
            global_per_minute
            if global_per_minute is not None
            else config.GLOBAL_RATE_LIMIT_PER_MINUTE
        )
        self._prefix = "drawai:rl:"

    def _minute_key(self, client_id: str) -> str:
        return f"{self._prefix}m:{client_id}"

    def _day_key(self, client_id: str, day: str) -> str:
        return f"{self._prefix}d:{day}:{client_id}"

    def _inflight_key(self, client_id: str) -> str:
        return f"{self._prefix}c:{client_id}"

    def _global_key(self) -> str:
        return f"{self._prefix}global"

    def _day_str(self, now: float) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(now))

    def _prune_zset(self, key: str, now: float, window: float) -> None:
        self._r.zremrangebyscore(key, 0, now - window)

    def check(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        return self._evaluate(client_id, now=now if now is not None else time.time(), consume=False)

    def acquire(self, client_id: str, *, now: float | None = None) -> RateLimitResult:
        return self._evaluate(client_id, now=now if now is not None else time.time(), consume=True)

    def _evaluate(self, client_id: str, *, now: float, consume: bool) -> RateLimitResult:
        mk = self._minute_key(client_id)
        gk = self._global_key()
        self._prune_zset(mk, now, 60.0)
        self._prune_zset(gk, now, 60.0)

        used = int(self._r.zcard(mk))
        oldest = self._r.zrange(mk, 0, 0, withscores=True)
        reset_at = (oldest[0][1] + 60.0) if oldest else now + 60.0
        remaining = max(0, self.per_minute - used)

        inflight = int(self._r.get(self._inflight_key(client_id)) or 0)
        if inflight >= self.max_concurrent:
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=remaining,
                reset_at=reset_at,
                retry_after_seconds=1,
                reason="concurrent",
            )

        if int(self._r.zcard(gk)) >= self.global_per_minute:
            g_oldest = self._r.zrange(gk, 0, 0, withscores=True)
            retry = max(1, int(g_oldest[0][1] + 60.0 - now)) if g_oldest else 1
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=remaining,
                reset_at=reset_at,
                retry_after_seconds=retry,
                reason="global",
            )

        if used >= self.per_minute:
            retry = max(1, int(reset_at - now))
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=0,
                reset_at=reset_at,
                retry_after_seconds=retry,
                reason="per_minute",
            )

        day = self._day_str(now)
        dk = self._day_key(client_id, day)
        day_count = int(self._r.get(dk) or 0)
        if day_count >= self.daily:
            tomorrow = time.mktime(time.strptime(day, "%Y-%m-%d")) + 86400
            return RateLimitResult(
                allowed=False,
                limit=self.per_minute,
                remaining=0,
                reset_at=tomorrow,
                retry_after_seconds=max(1, int(tomorrow - now)),
                reason="daily",
            )

        if consume:
            member = f"{now}:{threading.get_ident()}:{time.time_ns()}"
            pipe = self._r.pipeline()
            pipe.zadd(mk, {member: now})
            pipe.expire(mk, 120)
            pipe.zadd(gk, {member: now})
            pipe.expire(gk, 120)
            pipe.incr(dk)
            pipe.expire(dk, 90000)
            pipe.incr(self._inflight_key(client_id))
            pipe.expire(self._inflight_key(client_id), 300)
            pipe.execute()
            used += 1
            remaining = max(0, self.per_minute - used)
            if not oldest:
                reset_at = now + 60.0

        return RateLimitResult(
            allowed=True,
            limit=self.per_minute,
            remaining=remaining,
            reset_at=reset_at,
        )

    def release(self, client_id: str) -> None:
        key = self._inflight_key(client_id)
        val = self._r.decr(key)
        if val <= 0:
            self._r.delete(key)

    def headers_for(self, client_id: str, *, now: float | None = None) -> dict[str, str]:
        t = now if now is not None else time.time()
        mk = self._minute_key(client_id)
        self._prune_zset(mk, t, 60.0)
        used = int(self._r.zcard(mk))
        oldest = self._r.zrange(mk, 0, 0, withscores=True)
        reset_at = (oldest[0][1] + 60.0) if oldest else t + 60.0
        return _headers(
            RateLimitResult(
                allowed=True,
                limit=self.per_minute,
                remaining=max(0, self.per_minute - used),
                reset_at=reset_at,
            )
        )


_limiter: RateLimiter | None = None
_limiter_lock = threading.Lock()


def get_rate_limiter() -> RateLimiter:
    global _limiter
    with _limiter_lock:
        if _limiter is None:
            if config.REDIS_URL:
                _limiter = RedisRateLimiter(config.REDIS_URL)
            else:
                _limiter = InMemoryRateLimiter()
        return _limiter


def reset_rate_limiter_for_tests(limiter: RateLimiter | None = None) -> RateLimiter:
    """Replace the singleton (tests). Pass None to create a fresh in-memory limiter."""
    global _limiter
    with _limiter_lock:
        _limiter = limiter if limiter is not None else InMemoryRateLimiter()
        return _limiter
