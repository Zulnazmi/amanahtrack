"""Send a request the way a real box does."""

import hashlib
import json
import time
import uuid

from app.services.device_auth import request_signature


def signed_post(
    c, path, body, secret, *, evidence="", event_id=None, timestamp=None, signature=None
):
    raw = json.dumps(body).encode()
    event_id = event_id or uuid.uuid4().hex
    ts = str(int(time.time()) if timestamp is None else timestamp)
    sig = signature or request_signature(
        secret, path, ts, event_id, hashlib.sha256(raw).hexdigest()
    )
    return c.post(
        path,
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-Device-Timestamp": ts,
            "X-Device-Event-Id": event_id,
            "X-Device-Request-Signature": sig,
            "X-Device-Signature": evidence,
        },
    )
