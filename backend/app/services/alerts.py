"""
Alerts with photo evidence.

An alert is raised by the box (unexplained weight, tray emptied) or by the
platform itself (a count variance over the threshold). The committee reads it
in the app, looks at the photo, and runs verification, which re-checks four
things on demand rather than asking anyone to trust a green tick:

  1. the stored photo still hashes to the SHA-256 recorded when it arrived
  2. the box's HMAC signature over that hash is valid
  3. the alert's own seal recomputes from its content
  4. the chain links forward and backward to its neighbours

Point 4 is what stops someone who edits an alert and recomputes its seal: the
next alert still points at the old seal.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    _now,
    Alert,
    AlertKind,
    AlertSeverity,
    AlertStatus,
    Device,
)
from app.services import sealing

MAX_PHOTO_BYTES = 3 * 1024 * 1024
VARIANCE_WARN = Decimal("20.00")
VARIANCE_CRITICAL = Decimal("100.00")


class AlertError(ValueError):
    pass


# ------------------------------------------------------------------ signing


def device_signature(serial: str, kind: str, photo_sha256: str | None, secret: str) -> str:
    """What the box signs. Covers the photo hash, so the picture is bound to
    the device that took it."""
    message = f"{serial}:alert:{kind}:{photo_sha256 or ''}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


# ------------------------------------------------------------------- photos


def sniff_mime(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    raise AlertError("Photo must be a PNG or JPEG image")


def decode_photo(photo_b64: str) -> bytes:
    try:
        data = base64.b64decode(photo_b64, validate=True)
    except (binascii.Error, ValueError):
        raise AlertError("Photo is not valid base64")
    if not data:
        raise AlertError("Photo is empty")
    if len(data) > MAX_PHOTO_BYTES:
        raise AlertError("Photo is larger than 3 MB")
    sniff_mime(data)
    return data


# ------------------------------------------------------------------ sealing


def alert_payload(alert: Alert, device_serial: str | None) -> dict:
    return {
        "seq": alert.seq,
        "kind": alert.kind,
        "severity": alert.severity,
        "title": alert.title,
        "detail": alert.detail,
        "device": device_serial,
        "related_reference": alert.related_reference,
        "occurred_at": alert.occurred_at,
        "photo_sha256": alert.photo_sha256,
    }


def _serial_of(db: Session, alert: Alert) -> str | None:
    if alert.device_id is None:
        return None
    device = db.get(Device, alert.device_id)
    return device.serial if device else None


def _head(db: Session, institution_id: str) -> tuple[int, str]:
    last = db.scalars(
        select(Alert)
        .where(Alert.institution_id == institution_id)
        .order_by(Alert.seq.desc())
        .limit(1)
    ).first()
    if last is None:
        return 0, sealing.GENESIS_HASH
    return last.seq, last.chain_hash


def create_alert(
    db: Session,
    *,
    institution_id: str,
    kind: AlertKind,
    severity: AlertSeverity,
    title: str,
    detail: str = "",
    device: Device | None = None,
    related_reference: str | None = None,
    photo: bytes | None = None,
    claimed_sha256: str | None = None,
    signature: str | None = None,
    occurred_at=None,
) -> Alert:
    photo_sha = None
    mime = None
    if photo is not None:
        mime = sniff_mime(photo)
        photo_sha = hashlib.sha256(photo).hexdigest()
        if claimed_sha256 is not None and claimed_sha256.lower() != photo_sha:
            raise AlertError("Photo hash does not match the bytes received")

    last_seq, prev = _head(db, institution_id)
    alert = Alert(
        institution_id=institution_id,
        seq=last_seq + 1,
        device_id=device.id if device else None,
        kind=kind,
        severity=severity,
        title=title,
        detail=detail,
        related_reference=related_reference,
        photo=photo,
        photo_mime=mime,
        photo_sha256=photo_sha,
        device_signature=signature,
        prev_hash="",
        payload_hash="",
        chain_hash="",
    )
    if occurred_at is not None:
        alert.occurred_at = occurred_at
    else:
        alert.occurred_at = _now()

    payload_hash = sealing.hash_payload(
        alert_payload(alert, device.serial if device else None)
    )
    alert.payload_hash = payload_hash
    alert.prev_hash = prev
    alert.chain_hash = sealing.chain(prev, payload_hash, alert.seq)
    db.add(alert)
    db.flush()
    return alert


def variance_alert(db: Session, *, institution_id, device, session_row, adjustment_ref):
    """Raise an alert when a witnessed count disagrees with the box."""
    variance = session_row.variance
    size = abs(variance)
    if size <= VARIANCE_WARN:
        return None
    direction = "short" if variance < 0 else "over"
    severity = AlertSeverity.CRITICAL if size >= VARIANCE_CRITICAL else AlertSeverity.WARNING
    return create_alert(
        db,
        institution_id=institution_id,
        kind=AlertKind.COUNT_VARIANCE,
        severity=severity,
        title=f"Count came in RM {size:.2f} {direction}",
        detail=(
            f"Witnessed count RM {session_row.counted_total:.2f} against box estimate "
            f"RM {session_row.estimated_total:.2f}. Counted by {session_row.witness_count} "
            f"witness(es)."
            + (f" Note: {session_row.note}" if session_row.note else "")
        ),
        device=device,
        related_reference=adjustment_ref,
    )


# ------------------------------------------------------------ verification


@dataclass
class Check:
    key: str
    label: str
    ok: bool | None  # None means not applicable
    detail: str

    def as_dict(self):
        return {"key": self.key, "label": self.label, "ok": self.ok, "detail": self.detail}


def verify_alert(db: Session, alert: Alert) -> dict:
    checks: list[Check] = []
    serial = _serial_of(db, alert)

    # 1. photo bytes against recorded hash
    if alert.photo is None:
        checks.append(Check("photo", "Photo matches its SHA-256", None, "No photo attached"))
        recomputed = None
    else:
        recomputed = hashlib.sha256(alert.photo).hexdigest()
        ok = recomputed == alert.photo_sha256
        checks.append(
            Check(
                "photo",
                "Photo matches its SHA-256",
                ok,
                "Stored photo hashes to the recorded value"
                if ok
                else "Stored photo no longer matches the hash recorded on arrival",
            )
        )

    # 2. device signature
    device = db.get(Device, alert.device_id) if alert.device_id else None
    if device is None or not alert.device_signature:
        checks.append(
            Check("signature", "Signed by the box", None, "Raised by the platform, not a box")
        )
    else:
        expected = device_signature(
            device.serial, alert.kind.value, alert.photo_sha256, device.shared_secret
        )
        ok = hmac.compare_digest(expected, alert.device_signature)
        checks.append(
            Check(
                "signature",
                "Signed by the box",
                ok,
                f"HMAC valid for {device.serial}" if ok else "Signature does not verify",
            )
        )

    # 3. own seal
    payload_hash = sealing.hash_payload(alert_payload(alert, serial))
    own_ok = payload_hash == alert.payload_hash and (
        sealing.chain(alert.prev_hash, alert.payload_hash, alert.seq) == alert.chain_hash
    )
    checks.append(
        Check(
            "seal",
            "Alert content matches its seal",
            own_ok,
            "Title, detail, device and photo hash all recompute to the seal"
            if own_ok
            else "Alert content was changed after it was sealed",
        )
    )

    # 4. neighbours
    prev_alert = db.scalars(
        select(Alert).where(
            Alert.institution_id == alert.institution_id, Alert.seq == alert.seq - 1
        )
    ).first()
    next_alert = db.scalars(
        select(Alert).where(
            Alert.institution_id == alert.institution_id, Alert.seq == alert.seq + 1
        )
    ).first()
    expected_prev = prev_alert.chain_hash if prev_alert else sealing.GENESIS_HASH
    back_ok = alert.prev_hash == expected_prev
    fwd_ok = next_alert is None or next_alert.prev_hash == alert.chain_hash
    chain_ok = back_ok and fwd_ok
    if chain_ok:
        detail = (
            "Linked to the previous alert"
            + (" and the next one" if next_alert else " (latest alert)")
        )
    elif not back_ok:
        detail = "Does not follow the previous alert in the chain"
    else:
        detail = "The next alert no longer points at this one"
    checks.append(Check("chain", "Chain links intact", chain_ok, detail))

    applicable = [c for c in checks if c.ok is not None]
    return {
        "intact": all(c.ok for c in applicable),
        "photo_sha256": alert.photo_sha256,
        "recomputed_sha256": recomputed,
        "payload_hash": alert.payload_hash,
        "prev_hash": alert.prev_hash,
        "chain_hash": alert.chain_hash,
        "seq": alert.seq,
        "checks": [c.as_dict() for c in checks],
    }


# --------------------------------------------------------------- review


def review(alert: Alert, *, action: str, note: str | None, user_id: str):
    if action == "acknowledge":
        alert.status = AlertStatus.ACKNOWLEDGED
    elif action == "escalate":
        alert.status = AlertStatus.ESCALATED
    else:
        raise AlertError("Action must be 'acknowledge' or 'escalate'")
    alert.reviewed_by = user_id
    alert.reviewed_at = _now()
    alert.review_note = note


def open_counts(db: Session, institution_id: str) -> dict:
    rows = db.execute(
        select(Alert.status, Alert.severity, func.count())
        .where(Alert.institution_id == institution_id)
        .group_by(Alert.status, Alert.severity)
    ).all()
    open_total = critical = 0
    for st, sev, n in rows:
        if st is AlertStatus.OPEN:
            open_total += n
            if sev is AlertSeverity.CRITICAL:
                critical += n
    return {"open": open_total, "critical_open": critical}
