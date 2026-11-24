"""
Push notifications through Expo's push service.

Two things reach a phone when the app is closed: alerts, which go to everyone
in the mosque, and approval requests, which go to the people who may decide
and then back to the person who asked.

A locked phone can be read by anyone, so a message never carries a person's
name, a description or a photo. Tapping it opens the app, which asks for the
rest with the normal signed-in request.

Repeats of the same kind of alert within a short window are skipped so a
shaken box does not buzz the phone every second.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time

import httpx
from sqlalchemy import delete, select

from app.models import PushToken, Role, User

log = logging.getLogger("amanahtrack.push")

EXPO_PUSH_URL = os.getenv("AMANAH_EXPO_PUSH_URL", "https://exp.host/--/api/v2/push/send")
EXPO_RECEIPTS_URL = os.getenv(
    "AMANAH_EXPO_RECEIPTS_URL", "https://exp.host/--/api/v2/push/getReceipts"
)
ENABLED = os.getenv("AMANAH_PUSH", "on").lower() != "off"
THROTTLE_S = float(os.getenv("AMANAH_PUSH_THROTTLE_S", "20"))
CLIENT = httpx.AsyncClient  # replaced in tests
RECEIPT_WAIT_S = 20.0

_last_sent: dict[tuple[str, str], float] = {}
_running: set[asyncio.Task] = set()

# (Malay, English)
_ALERTS = {
    "door_opened": ("Pintu tabung dibuka", "Box door opened"),
    "door_left_open": ("Pintu tabung dibiarkan terbuka", "Box door left open"),
    "vibration": ("Gegaran pada tabung", "Vibration at the box"),
    "tamper_suspected": ("Tabung mungkin diusik", "Possible tampering with the box"),
    "device_offline": ("Tabung terputus sambungan", "Box went offline"),
    "count_variance": ("Kiraan tidak sama dengan anggaran", "Count differs from the estimate"),
    "tray_emptied": ("Tabung dikosongkan", "Box was emptied"),
    "unexplained_weight": ("Berat luar biasa dalam tabung", "Unexplained weight in the box"),
}
_OTHER_ALERT = ("Amaran baharu", "New alert")
_OPEN_APP = ("Tekan untuk semak.", "Tap to review.")


def _pick(lang: str, pair: tuple[str, str]) -> str:
    return pair[1] if lang == "en" else pair[0]


def _should_send(institution_id: str, message: dict) -> bool:
    if message.get("type") != "event":
        return False
    event = message.get("event") or {}
    if not event.get("alert_id"):  # plain telemetry such as heartbeats
        return False
    key = (institution_id, str(event.get("kind")))
    now = time.monotonic()
    if now - _last_sent.get(key, float("-inf")) < THROTTLE_S:
        return False
    _last_sent[key] = now
    return True


def alert_message(lang: str, kind: str, alert_id: str, device: str | None = None) -> dict:
    tail = _pick(lang, _OPEN_APP)
    return {
        "title": _pick(lang, _ALERTS.get(kind, _OTHER_ALERT)),
        "body": f"{device}. {tail}" if device else tail,
        "channelId": "alerts",
        "data": {"alert_id": alert_id},
    }


def approval_message(lang: str, kind: str, status: str, amount) -> dict:
    spend = kind == "spend"
    what = ("Belanja", "Spending") if spend else ("Pembetulan", "Correction")
    title = {
        "pending": ("Perlu kelulusan anda", "Needs your approval"),
        "approved": ("Permintaan anda diluluskan", "Your request was approved"),
        "rejected": ("Permintaan anda ditolak", "Your request was rejected"),
    }[status]
    return {
        "title": _pick(lang, title),
        "body": f"{_pick(lang, what)} RM {amount:,.2f}. {_pick(lang, _OPEN_APP)}",
        "channelId": "approvals",
        "data": {"screen": "approvals"},
    }


def test_message(lang: str) -> dict:
    return {
        "title": _pick(lang, ("Ujian notifikasi", "Notification test")),
        "body": _pick(
            lang, ("Notifikasi berfungsi pada telefon ini.", "Notifications work on this phone.")
        ),
        "channelId": "alerts",
        "data": {},
    }


test_message.__test__ = False  # not a pytest test


def phones(db, institution_id: str, *conditions) -> list[tuple[str, str]]:
    """(token, language) of people who still have access."""
    return list(
        db.execute(
            select(PushToken.token, PushToken.lang)
            .join(User, User.id == PushToken.user_id)
            .where(
                PushToken.institution_id == institution_id,
                User.institution_id == institution_id,
                User.active.is_(True),
                *conditions,
            )
        ).tuples()
    )


async def deliver(
    session_factory, messages: list[dict], client_factory=None, wait: float | None = None
) -> list[str]:
    """Send, then read the receipts. Returns Expo's error codes, if any.

    A ticket only says Expo took the message. Whether Google accepted it is in
    the receipt a little later.
    """
    errors: list[str] = []
    dead: set[str] = set()
    tickets: dict[str, str] = {}

    def failed(token: str, answer: dict) -> None:
        code = (answer.get("details") or {}).get("error") or "Unknown"
        log.warning("push to a phone failed: %s", code)
        errors.append(code)
        if code == "DeviceNotRegistered":
            dead.add(token)

    async with (client_factory or CLIENT)(timeout=10) as client:
        async def post(url, body):
            resp = await client.post(url, json=body, headers={"Accept": "application/json"})
            if resp.status_code != 200:
                log.warning("expo push returned %s", resp.status_code)
                errors.append(f"HTTP{resp.status_code}")
                return None
            return resp.json().get("data")

        for i in range(0, len(messages), 100):  # Expo's limit
            batch = [{"sound": "default", "priority": "high", **m} for m in messages[i : i + 100]]
            for m, ticket in zip(batch, await post(EXPO_PUSH_URL, batch) or []):
                if ticket.get("status") == "error":
                    failed(m["to"], ticket)
                elif ticket.get("id"):
                    tickets[ticket["id"]] = m["to"]
        if tickets:
            await asyncio.sleep(RECEIPT_WAIT_S if wait is None else wait)
            receipts = await post(EXPO_RECEIPTS_URL, {"ids": list(tickets)}) or {}
            for ticket_id, receipt in receipts.items():
                if receipt.get("status") == "error" and ticket_id in tickets:
                    failed(tickets[ticket_id], receipt)

    if dead:
        def forget():
            with session_factory() as db:
                db.execute(delete(PushToken).where(PushToken.token.in_(dead)))
                db.commit()

        await asyncio.to_thread(forget)
    return errors


async def start(session_factory, messages: list[dict]) -> None:
    """Send without making anyone wait, and never fail the request."""
    if not ENABLED or not messages:
        return

    async def run():
        try:
            await deliver(session_factory, messages)
        except Exception:
            log.warning("push could not be sent", exc_info=True)

    task = asyncio.create_task(run())
    _running.add(task)  # a task nobody holds can disappear half way
    task.add_done_callback(_running.discard)


def make_listener(session_factory, client_factory=None):
    async def listener(institution_id: str, message: dict) -> None:
        if not ENABLED or not _should_send(institution_id, message):
            return
        event = message["event"]
        with session_factory() as db:
            to = phones(db, institution_id)
        messages = [
            {
                "to": token,
                **alert_message(
                    lang, str(event.get("kind")), event["alert_id"], event.get("device_label")
                ),
            }
            for token, lang in to
        ]
        if messages:
            await deliver(session_factory, messages, client_factory)

    return listener


def for_alert(db, alert) -> list[dict]:
    """Alerts raised outside the live feed, such as a count that does not match."""
    return [
        {"to": token, **alert_message(lang, alert.kind.value, alert.id)}
        for token, lang in phones(db, alert.institution_id)
    ]


def for_approval(db, row) -> list[dict]:
    if row.status == "pending":
        who = (User.id != row.requested_by, User.role.in_((Role.ADMIN, Role.COMMITTEE)))
    elif row.status in ("approved", "rejected"):
        who = (User.id == row.requested_by,)
    else:
        return []
    return [
        {"to": token, **approval_message(lang, row.kind, row.status, row.amount)}
        for token, lang in phones(db, row.institution_id, *who)
    ]
