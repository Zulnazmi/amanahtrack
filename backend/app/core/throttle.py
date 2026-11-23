"""Slows down password guessing.

Counted per account, in memory, which matches the single server process this
project runs. Keyed on the email rather than the address because behind a host
such as Render every caller can look like the same address.
"""

from __future__ import annotations

import threading
import time

MAX_FAILURES = 10
WINDOW_S = 15 * 60
MAX_TRACKED = 10_000

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


def _recent(key: str, now: float) -> list[float]:
    return [t for t in _failures.get(key, ()) if now - t < WINDOW_S]


def blocked(email: str) -> bool:
    with _lock:
        return len(_recent(email.strip().lower(), time.monotonic())) >= MAX_FAILURES


def failed(email: str) -> None:
    key, now = email.strip().lower(), time.monotonic()
    with _lock:
        if len(_failures) >= MAX_TRACKED:
            for k in [k for k in _failures if not _recent(k, now)]:
                del _failures[k]
            while len(_failures) >= MAX_TRACKED:
                del _failures[next(iter(_failures))]
        _failures[key] = _recent(key, now) + [now]


def succeeded(email: str) -> None:
    with _lock:
        _failures.pop(email.strip().lower(), None)


def reset() -> None:
    with _lock:
        _failures.clear()
