"""Settings that must be right before real money is involved.

Development works with no setup. Production refuses to start when a setting is
missing, because a server that quietly falls back to a public key looks exactly
like a safe one.
"""

from __future__ import annotations

import os

DEV_SECRET_KEY = "dev-only-change-me-before-deploy"


def is_production() -> bool:
    """Explicit setting first. Otherwise a real database or host means yes."""
    explicit = os.getenv("AMANAH_ENV", "").strip().lower()
    if explicit:
        return explicit not in {"dev", "development", "test"}
    url = os.getenv("AMANAH_DATABASE_URL", "")
    return bool(os.getenv("RENDER")) or (bool(url) and not url.startswith("sqlite"))


def database_url() -> str:
    """Hosts such as Neon hand out plain links. Use the psycopg 3 driver."""
    url = os.getenv("AMANAH_DATABASE_URL", "sqlite:///./amanahtrack.db")
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def secret_key() -> str:
    key = os.getenv("AMANAH_SECRET_KEY", "")
    if is_production():
        if len(key) < 32 or key == DEV_SECRET_KEY:
            raise RuntimeError(
                "AMANAH_SECRET_KEY must be set to a random value of at least 32 "
                'characters. Make one with: python -c "import secrets; '
                'print(secrets.token_hex(32))"'
            )
        return key
    return key or DEV_SECRET_KEY


def cors_origins() -> list[str]:
    """Websites allowed to call the API. Phone apps do not need this."""
    raw = os.getenv("AMANAH_CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    if origins:
        return origins
    return [] if is_production() else ["*"]
