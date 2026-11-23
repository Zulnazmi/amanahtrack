"""Replay, guessing, and unsafe defaults."""

import importlib.util
import json
import sys
import time
from pathlib import Path

import pytest
from device_helpers import signed_post
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import auth, config, throttle
from app.core.fiqh import FundCategory
from app.main import app, get_db
from app.models import (
    AccountNature,
    Base,
    Device,
    DeviceMessage,
    Fund,
    Institution,
    Role,
    Transaction,
    User,
)
from app.services import device_auth

SECRET = "k" * 40
DEVICE_DIR = Path(__file__).resolve().parents[2] / "device"


@pytest.fixture()
def env(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/sec.db")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    throttle.reset()
    db = Session()
    inst = Institution(name="A", slug="masjid-a")
    db.add(inst)
    db.flush()
    cash = Fund(
        institution_id=inst.id,
        code="cash",
        category=FundCategory.SADAQAH,
        label_ms="Tunai",
        label_en="Cash",
        nature=AccountNature.ASSET,
    )
    sadaqah = Fund(
        institution_id=inst.id,
        code="sadaqah",
        category=FundCategory.SADAQAH,
        label_ms="Sedekah",
        label_en="Sadaqah",
    )
    db.add_all([cash, sadaqah])
    db.flush()
    db.add_all(
        [
            Device(
                institution_id=inst.id,
                serial="BOX-S",
                label="Box",
                default_fund_id=sadaqah.id,
                shared_secret=SECRET,
            ),
            User(
                institution_id=inst.id,
                name="T",
                email="t@a.my",
                password_hash=auth.hash_password("old-password"),
                role=Role.TREASURER,
            ),
        ]
    )
    db.commit()
    db.close()
    yield TestClient(app), Session
    app.dependency_overrides.clear()
    throttle.reset()


COIN = {"serial": "BOX-S", "event_type": "insertion", "estimated_amount": "0.50"}


def coin(c, **kw):
    return signed_post(c, "/devices/events", COIN, SECRET, **kw)


def count(Session, model):
    with Session() as db:
        return db.query(model).count()


def test_a_repeated_event_is_recorded_once(env):
    c, Session = env
    assert coin(c, event_id="a" * 32).json()["recorded"] is True
    again = coin(c, event_id="a" * 32)
    assert again.status_code == 202 and again.json()["duplicate"] is True
    assert count(Session, Transaction) == 1


def test_two_real_coins_are_two_events(env):
    c, Session = env
    coin(c)
    coin(c)
    assert count(Session, Transaction) == 2


def test_an_old_capture_is_refused(env):
    c, Session = env
    r = coin(c, timestamp=int(time.time()) - 3600)
    assert r.status_code == 401 and r.json()["detail"]["code"] == "clock_skew"
    assert count(Session, Transaction) == 0


def test_changing_the_body_or_the_path_breaks_the_signature(env):
    c, _ = env
    ts, eid = str(int(time.time())), "b" * 32
    import hashlib

    good = device_auth.request_signature(
        SECRET, "/devices/events", ts, eid,
        hashlib.sha256(json.dumps(COIN).encode()).hexdigest(),
    )
    bigger = {**COIN, "estimated_amount": "500.00"}
    r = signed_post(c, "/devices/events", bigger, SECRET, event_id=eid, timestamp=ts, signature=good)
    assert r.status_code == 401
    r = signed_post(c, "/devices/telemetry", COIN | {"kind": "heartbeat"}, SECRET,
                    event_id=eid, timestamp=ts, signature=good)
    assert r.status_code == 401


def test_the_old_unprotected_format_is_refused(env):
    c, _ = env
    r = c.post("/devices/events", json=COIN, headers={"X-Device-Signature": "0" * 64})
    assert r.status_code == 401


def test_non_ascii_signature_is_a_401_not_a_crash(env):
    c, _ = env
    r = c.post("/devices/events", json=COIN,
               headers={b"X-Device-Request-Signature": "é".encode("latin-1")})
    assert r.status_code == 401


def test_a_failed_request_does_not_use_up_its_event_id(env):
    c, Session = env
    bad = {"serial": "BOX-S", "kind": "no_such_kind"}
    assert signed_post(c, "/devices/telemetry", bad, SECRET, event_id="c" * 32).status_code == 422
    assert count(Session, DeviceMessage) == 0


def test_expired_ids_are_cleaned_up(env):
    c, Session = env
    coin(c)
    with Session() as db:
        row = db.query(DeviceMessage).one()
        row.expires_at = row.expires_at.replace(year=2020)
        db.commit()
        device_auth.purge(db)
        db.commit()
    assert count(Session, DeviceMessage) == 0


def _login(c, pw):
    return c.post("/auth/login", data={"username": "t@a.my", "password": pw})


def test_password_guessing_is_slowed(env):
    c, _ = env
    for _ in range(throttle.MAX_FAILURES):
        assert _login(c, "wrong").status_code == 401
    assert _login(c, "old-password").status_code == 429


def test_a_good_login_clears_the_counter(env):
    c, _ = env
    for _ in range(throttle.MAX_FAILURES - 1):
        _login(c, "wrong")
    assert _login(c, "old-password").status_code == 200
    assert _login(c, "wrong").status_code == 401


def test_password_can_be_changed(env):
    c, _ = env
    h = {"Authorization": f"Bearer {_login(c, 'old-password').json()['access_token']}"}
    url = "/auth/change-password"
    assert c.post(url, json={"current": "nope", "new": "a-new-password"}, headers=h).status_code == 403
    assert c.post(url, json={"current": "old-password", "new": "short"}, headers=h).status_code == 422
    assert c.post(url, json={"current": "old-password", "new": "a-new-password"}, headers=h).status_code == 204
    assert _login(c, "old-password").status_code == 401
    assert _login(c, "a-new-password").status_code == 200


def test_production_refuses_a_missing_or_weak_key(monkeypatch):
    monkeypatch.setenv("AMANAH_ENV", "production")
    for bad in ("", "short", config.DEV_SECRET_KEY):
        monkeypatch.setenv("AMANAH_SECRET_KEY", bad)
        with pytest.raises(RuntimeError):
            config.secret_key()
    monkeypatch.setenv("AMANAH_SECRET_KEY", "x" * 64)
    assert config.secret_key() == "x" * 64
    assert config.cors_origins() == []


def test_a_real_database_counts_as_production(monkeypatch):
    monkeypatch.delenv("AMANAH_ENV", raising=False)
    monkeypatch.setenv("AMANAH_DATABASE_URL", "postgresql://u:p@host/db")
    assert config.is_production()


def test_seed_refuses_to_wipe_production(monkeypatch):
    import seed

    monkeypatch.setenv("AMANAH_ENV", "production")
    monkeypatch.setattr(seed.Base.metadata, "drop_all", lambda *_: pytest.fail("wiped"))
    with pytest.raises(SystemExit):
        seed.run()


def _box_client():
    spec = importlib.util.spec_from_file_location("box_client_t", DEVICE_DIR / "box_client.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_the_real_box_client_is_accepted_and_retries_safely(env, monkeypatch, tmp_path):
    """The Pi code and the server must agree byte for byte."""
    c, Session = env
    bc = _box_client()
    bc.SERIAL, bc.SECRET, bc.API_URL = "BOX-S", SECRET, "http://testserver"
    bc.QUEUE_FILE = tmp_path / "q.jsonl"
    lose_reply = [True]

    class Reply:
        def __init__(self, r):
            self.status = r.status_code

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def urlopen(req, timeout):
        r = c.post(req.full_url, content=req.data, headers=dict(req.header_items()))
        assert r.status_code < 300, r.text
        if lose_reply.pop() if lose_reply else False:
            raise TimeoutError("reply lost")
        return Reply(r)

    monkeypatch.setattr(bc.urllib.request, "urlopen", urlopen)
    event = {"event_type": "insertion", "estimated_amount": "1.00", "confidence": "0.900"}
    assert bc.deliver(event) is False  # recorded, but the box never heard back
    assert bc.flush_queue() == 0  # sent again
    assert count(Session, Transaction) == 1


def test_the_box_keeps_events_when_its_clock_or_key_is_wrong(monkeypatch, tmp_path):
    import io
    import urllib.error

    bc = _box_client()
    bc.QUEUE_FILE = tmp_path / "q.jsonl"

    def refuse(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 401, "no", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(bc.urllib.request, "urlopen", refuse)
    assert bc.deliver({"event_type": "telemetry", "kind": "door_opened"}) is False
    assert len(bc.QUEUE_FILE.read_text().splitlines()) == 1
    # a late heartbeat would be a lie, so those are never saved
    bc.deliver({"event_type": "telemetry", "kind": "heartbeat"})
    assert len(bc.QUEUE_FILE.read_text().splitlines()) == 1
