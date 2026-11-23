"""Where evidence photos live.

A photo is first saved with its alert, in the same database transaction, so an
alert never waits for the cloud and is never saved without its photo. A
background task then moves it to private object storage (Cloudflare R2 or any
S3-compatible service), reads it back, checks the hash, and only then removes
the database copy. If the cloud is down the photo simply stays put until later.

The bucket is private and the app never talks to it. Photos are served through
the API, so the usual login and per-mosque checks always apply.
"""

from __future__ import annotations

import hashlib
import logging
import os

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import Alert

log = logging.getLogger("amanahtrack.storage")

SETTINGS = (
    "AMANAH_S3_ENDPOINT",
    "AMANAH_S3_BUCKET",
    "AMANAH_S3_ACCESS_KEY_ID",
    "AMANAH_S3_SECRET_ACCESS_KEY",
)


class StorageUnavailable(Exception):
    """Could not reach the photo store. Says nothing about the evidence."""


class S3Store:
    def __init__(self, endpoint: str, bucket: str, key_id: str, secret: str):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name=os.getenv("AMANAH_S3_REGION", "auto"),
            config=Config(
                connect_timeout=5,
                read_timeout=15,
                retries={"max_attempts": 2},
                # R2 and others do not all support the newer default checksums.
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def put(self, key: str, data: bytes, mime: str) -> None:
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.client.put_object(
                Bucket=self.bucket, Key=key, Body=data, ContentType=mime
            )
        except (BotoCoreError, ClientError) as exc:
            raise StorageUnavailable(str(exc)) from exc

    def get(self, key: str) -> bytes | None:
        """The bytes, or None when the store says there is no such photo."""
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            found = self.client.get_object(Bucket=self.bucket, Key=key)
            return found["Body"].read()
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                return None
            raise StorageUnavailable(str(exc)) from exc
        except BotoCoreError as exc:
            raise StorageUnavailable(str(exc)) from exc


def from_env() -> S3Store | None:
    """None means photos stay in the database. Half a setup is an error."""
    values = [os.getenv(name, "").strip() for name in SETTINGS]
    if not any(values):
        return None
    missing = [name for name, value in zip(SETTINGS, values) if not value]
    if missing:
        raise RuntimeError("Evidence storage is missing: " + ", ".join(missing))
    return S3Store(*values)


def photo_key(alert: Alert) -> str:
    """Kept apart per mosque, and named by content so a retry is harmless."""
    ext = "png" if alert.photo_mime == "image/png" else "jpg"
    return f"{alert.institution_id}/{alert.photo_sha256}.{ext}"


def load_photo(alert: Alert, store) -> bytes | None:
    """The stored photo, wherever it is. None means it is gone."""
    if alert.photo is not None:
        return alert.photo
    if alert.photo_key is None:
        return None
    if store is None:
        raise StorageUnavailable("Evidence storage is not configured")
    return store.get(alert.photo_key)


def archive_pending(session_factory, store, limit: int = 20) -> int:
    """Move photos to the cloud. Returns how many moved."""
    with session_factory() as db:
        ids = db.scalars(
            select(Alert.id)
            .where(Alert.photo.is_not(None), Alert.photo_key.is_(None))
            .order_by(Alert.created_at)
            .limit(500)
        ).all()
        moved = 0
        for alert_id in ids:
            if moved >= limit:
                break
            if _archive_one(db, store, alert_id):
                moved += 1
        return moved


def _archive_one(db: Session, store, alert_id: str) -> bool:
    alert = db.get(Alert, alert_id)
    data = alert.photo
    if data is None or hashlib.sha256(data).hexdigest() != alert.photo_sha256:
        # Already altered. Leave it exactly as found for verification to show.
        log.error("photo of alert %s does not match its hash, not moved", alert_id)
        db.rollback()
        return False
    key, sha, mime = photo_key(alert), alert.photo_sha256, alert.photo_mime
    db.rollback()  # do not hold a transaction open while the network is slow

    store.put(key, data, mime or "image/jpeg")
    back = store.get(key)
    if back is None or hashlib.sha256(back).hexdigest() != sha:
        raise StorageUnavailable("photo did not read back correctly")

    db.execute(
        update(Alert)
        .where(Alert.id == alert_id, Alert.photo_key.is_(None))
        .values(photo=None, photo_key=key)
    )
    db.commit()
    return True
