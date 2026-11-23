"""Proving a message is from the box, fresh, and not seen before.

Every request from a box carries:

  X-Device-Timestamp   unix seconds when it was sent
  X-Device-Event-Id    unique per event, kept the same when it is retried
  X-Device-Request-Signature
                       HMAC over the path, time, event id and the whole body

A captured message is useless: outside the time window it is stale, and inside
it the event id has already been used. The same id makes retries safe, so a
reply lost on a bad connection never records one donation twice.

This is separate from X-Device-Signature, which binds a photo to the box and is
stored as evidence. That one has to stay verifiable for years; this one only
has to be checked once.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Device, DeviceMessage

MAX_SKEW_S = 300
KEEP = timedelta(days=30)  # how long a queued retry is still recognised
KEEP_HEARTBEAT = timedelta(seconds=MAX_SKEW_S * 4)


@dataclass
class Envelope:
    path: str
    timestamp: str
    event_id: str
    signature: str
    body_sha256: str


async def envelope(request: Request) -> Envelope:
    return Envelope(
        path=request.url.path,
        timestamp=request.headers.get("x-device-timestamp", ""),
        event_id=request.headers.get("x-device-event-id", ""),
        signature=request.headers.get("x-device-request-signature", ""),
        body_sha256=hashlib.sha256(await request.body()).hexdigest(),
    )


def request_signature(
    secret: str, path: str, timestamp: str, event_id: str, body_sha256: str
) -> str:
    message = f"v2\n{path}\n{timestamp}\n{event_id}\n{body_sha256}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def authenticate(
    db: Session, env: Envelope, serial: str, *, heartbeat: bool = False
) -> Device | None:
    """The device, or None when this exact event was already handled.

    The event id is saved in the caller's transaction, so a request that fails
    later does not use it up.
    """
    found = db.scalars(select(Device).where(Device.serial == serial)).all()
    if len(found) != 1 or not found[0].active:
        raise HTTPException(404, "Unknown or inactive device")
    device = found[0]

    expected = request_signature(
        device.shared_secret, env.path, env.timestamp, env.event_id, env.body_sha256
    )
    # Bytes, because compare_digest refuses non-ASCII text from a hostile header.
    if not hmac.compare_digest(expected.encode(), env.signature.encode()):
        raise HTTPException(401, "Bad device signature")

    try:
        sent = int(env.timestamp)
    except ValueError:
        raise HTTPException(401, "Bad device timestamp")
    if abs(time.time() - sent) > MAX_SKEW_S:
        raise HTTPException(
            401,
            detail={
                "code": "clock_skew",
                "message_en": "Message is too old, or the box clock is wrong",
            },
        )
    if not 16 <= len(env.event_id) <= 64:
        raise HTTPException(401, "Bad device event id")

    device_id = device.id
    db.add(
        DeviceMessage(
            device_id=device_id,
            event_id=env.event_id,
            expires_at=datetime.now(timezone.utc)
            + (KEEP_HEARTBEAT if heartbeat else KEEP),
        )
    )
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return None
    return device


def purge(db: Session) -> None:
    db.execute(
        delete(DeviceMessage).where(
            DeviceMessage.expires_at < datetime.now(timezone.utc)
        )
    )
