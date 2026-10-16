"""Alerts, photo evidence and verification."""

import base64
import hashlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import auth
from app.core.fiqh import FundCategory
from app.main import app, get_db
from app.models import (
    AccountNature,
    Alert,
    Base,
    Device,
    Fund,
    Institution,
    Role,
    User,
)
from app.services import alerts as alert_service
from app.services import ledger

# 1x1 PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)
SECRET = "test-secret"


@pytest.fixture()
def env(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/alerts.db")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    db = Session()
    inst = Institution(name="A", slug="masjid-a")
    other = Institution(name="B", slug="masjid-b")
    db.add_all([inst, other])
    db.flush()
    for i in (inst, other):
        db.add(
            Fund(
                institution_id=i.id,
                code="cash",
                category=FundCategory.SADAQAH,
                label_ms="Tunai",
                label_en="Cash",
                nature=AccountNature.ASSET,
            )
        )
        db.add(
            Fund(
                institution_id=i.id,
                code="sadaqah",
                category=FundCategory.SADAQAH,
                label_ms="Sedekah",
                label_en="Sadaqah",
            )
        )
    db.flush()
    sad = db.query(Fund).filter_by(institution_id=inst.id, code="sadaqah").one()
    dev = Device(
        institution_id=inst.id,
        serial="BOX-T",
        label="Test box",
        default_fund_id=sad.id,
        shared_secret=SECRET,
    )
    db.add(dev)
    for slug_inst, name, email, role in (
        (inst, "Treasurer", "t@a.my", Role.TREASURER),
        (inst, "Committee", "c@a.my", Role.COMMITTEE),
        (inst, "Auditor", "au@a.my", Role.AUDITOR),
        (other, "Other", "o@b.my", Role.COMMITTEE),
    ):
        db.add(
            User(
                institution_id=slug_inst.id,
                name=name,
                email=email,
                password_hash=auth.hash_password("pw"),
                role=role,
            )
        )
    db.commit()
    ids = {"inst": inst.id}
    db.close()

    c = TestClient(app)
    yield c, Session, ids
    app.dependency_overrides.clear()


def login(c, email):
    r = c.post("/auth/login", data={"username": email, "password": "pw"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def post_alert(c, kind="unexplained_weight", photo=PNG, bad_sig=False, sha=None):
    sha = sha or (hashlib.sha256(photo).hexdigest() if photo else None)
    sig = alert_service.device_signature("BOX-T", kind, sha, SECRET)
    if bad_sig:
        sig = "0" * 64
    body = {"serial": "BOX-T", "kind": kind, "detail": "test"}
    if photo:
        body["photo_b64"] = base64.b64encode(photo).decode()
        body["photo_sha256"] = sha
    return c.post("/devices/alerts", json=body, headers={"X-Device-Signature": sig})


def test_device_alert_with_photo_is_stored_and_verifies(env):
    c, _, _ = env
    r = post_alert(c)
    assert r.status_code == 201
    h = login(c, "c@a.my")
    listing = c.get("/i/masjid-a/alerts", headers=h).json()
    assert len(listing) == 1 and listing[0]["has_photo"]
    aid = listing[0]["id"]

    photo = c.get(f"/i/masjid-a/alerts/{aid}/photo", headers=h)
    assert photo.status_code == 200
    assert photo.headers["content-type"] == "image/png"
    assert photo.content == PNG

    v = c.post(f"/i/masjid-a/alerts/{aid}/verify", headers=h).json()
    assert v["intact"] is True
    assert v["photo_sha256"] == v["recomputed_sha256"] == hashlib.sha256(PNG).hexdigest()
    assert all(ch["ok"] for ch in v["checks"])


def test_bad_signature_is_rejected(env):
    c, _, _ = env
    assert post_alert(c, bad_sig=True).status_code == 401


def test_photo_hash_mismatch_is_rejected(env):
    c, _, _ = env
    r = post_alert(c, sha="a" * 64)
    # signature was made over the wrong hash too, so it is rejected either way
    assert r.status_code in (401, 422)


def test_signed_but_wrong_hash_is_rejected(env):
    c, _, _ = env
    sha = "b" * 64
    sig = alert_service.device_signature("BOX-T", "unexplained_weight", sha, SECRET)
    r = c.post(
        "/devices/alerts",
        json={
            "serial": "BOX-T",
            "kind": "unexplained_weight",
            "photo_b64": base64.b64encode(PNG).decode(),
            "photo_sha256": sha,
        },
        headers={"X-Device-Signature": sig},
    )
    assert r.status_code == 422


def test_non_image_is_rejected(env):
    c, _, _ = env
    assert post_alert(c, photo=b"not an image at all").status_code == 422


def test_swapped_photo_is_caught(env):
    c, Session, _ = env
    post_alert(c)
    db = Session()
    alert = db.query(Alert).one()
    alert.photo = PNG + b"\x00tampered"
    db.commit()
    db.close()
    h = login(c, "c@a.my")
    aid = c.get("/i/masjid-a/alerts", headers=h).json()[0]["id"]
    v = c.post(f"/i/masjid-a/alerts/{aid}/verify", headers=h).json()
    assert v["intact"] is False
    photo_check = next(ch for ch in v["checks"] if ch["key"] == "photo")
    assert photo_check["ok"] is False


def test_edited_alert_text_is_caught(env):
    c, Session, _ = env
    post_alert(c)
    db = Session()
    alert = db.query(Alert).one()
    alert.detail = "Nothing to see here"
    db.commit()
    db.close()
    h = login(c, "c@a.my")
    aid = c.get("/i/masjid-a/alerts", headers=h).json()[0]["id"]
    v = c.post(f"/i/masjid-a/alerts/{aid}/verify", headers=h).json()
    assert v["intact"] is False
    assert next(ch for ch in v["checks"] if ch["key"] == "seal")["ok"] is False


def test_resealed_alert_is_caught_by_the_next_one(env):
    """Editing an alert and recomputing its own seal is not enough."""
    c, Session, _ = env
    post_alert(c)
    post_alert(c, kind="tray_emptied", photo=None)
    db = Session()
    first = db.query(Alert).filter_by(seq=1).one()
    first.title = "Nothing happened"
    from app.services import sealing

    first.payload_hash = sealing.hash_payload(alert_service.alert_payload(first, "BOX-T"))
    first.chain_hash = sealing.chain(first.prev_hash, first.payload_hash, first.seq)
    db.commit()
    first_id = first.id
    db.close()
    h = login(c, "c@a.my")
    v = c.post(f"/i/masjid-a/alerts/{first_id}/verify", headers=h).json()
    assert v["intact"] is False
    assert next(ch for ch in v["checks"] if ch["key"] == "chain")["ok"] is False


def test_committee_can_review_but_treasurer_cannot(env):
    c, _, _ = env
    post_alert(c)
    aid = c.get("/i/masjid-a/alerts", headers=login(c, "c@a.my")).json()[0]["id"]

    r = c.post(
        f"/i/masjid-a/alerts/{aid}/review",
        json={"action": "acknowledge"},
        headers=login(c, "t@a.my"),
    )
    assert r.status_code == 403

    r = c.post(
        f"/i/masjid-a/alerts/{aid}/review",
        json={"action": "acknowledge", "note": "Checked the photo, it is a key."},
        headers=login(c, "c@a.my"),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "acknowledged"
    assert body["reviewed_by"] == "Committee"
    assert body["review_note"].startswith("Checked")

    # review does not break the seal
    v = c.post(f"/i/masjid-a/alerts/{aid}/verify", headers=login(c, "au@a.my")).json()
    assert v["intact"] is True


def test_summary_counts_open_alerts(env):
    c, _, _ = env
    post_alert(c)
    post_alert(c, kind="tray_emptied", photo=None)
    h = login(c, "c@a.my")
    assert c.get("/i/masjid-a/alerts/summary", headers=h).json() == {
        "open": 2,
        "critical_open": 0,
    }
    aid = c.get("/i/masjid-a/alerts", headers=h).json()[0]["id"]
    c.post(f"/i/masjid-a/alerts/{aid}/review", json={"action": "escalate"}, headers=h)
    assert c.get("/i/masjid-a/alerts/summary", headers=h).json()["open"] == 1


def test_other_institution_cannot_see_alerts(env):
    c, _, _ = env
    post_alert(c)
    aid = c.get("/i/masjid-a/alerts", headers=login(c, "c@a.my")).json()[0]["id"]
    h = login(c, "o@b.my")
    assert c.get("/i/masjid-a/alerts", headers=h).status_code == 404
    assert c.get(f"/i/masjid-b/alerts/{aid}", headers=h).status_code == 404
    assert c.get(f"/i/masjid-b/alerts/{aid}/photo", headers=h).status_code == 404


def test_photo_requires_login(env):
    c, _, _ = env
    post_alert(c)
    aid = c.get("/i/masjid-a/alerts", headers=login(c, "c@a.my")).json()[0]["id"]
    assert c.get(f"/i/masjid-a/alerts/{aid}/photo").status_code == 401


def test_large_count_variance_raises_an_alert(env):
    c, Session, _ = env
    h = login(c, "t@a.my")
    r = c.post(
        "/i/masjid-a/counts",
        json={"device_serial": "BOX-T", "counted_total": "50.00", "witness_count": 2},
        headers=h,
    )
    assert r.status_code == 201 and r.json()["alert_raised"] is True
    alerts = c.get("/i/masjid-a/alerts", headers=login(c, "c@a.my")).json()
    assert alerts[0]["kind"] == "count_variance"
    assert alerts[0]["related_reference"]
    assert alerts[0]["has_photo"] is False


def test_small_variance_raises_no_alert(env):
    c, _, _ = env
    r = c.post(
        "/i/masjid-a/counts",
        json={"device_serial": "BOX-T", "counted_total": "5.00"},
        headers=login(c, "t@a.my"),
    )
    assert r.json()["alert_raised"] is False


def test_transaction_proof_and_tamper(env):
    c, Session, ids = env
    db = Session()
    cash = db.query(Fund).filter_by(institution_id=ids["inst"], code="cash").one()
    sad = db.query(Fund).filter_by(institution_id=ids["inst"], code="sadaqah").one()
    txn = ledger.record_donation(
        db,
        institution_id=ids["inst"],
        fund_id=sad.id,
        cash_fund_id=cash.id,
        amount="100.00",
        description="Friday collection",
        channel=ledger.Channel.DASHBOARD,
    )
    ref = txn.reference
    db.commit()
    db.close()

    h = login(c, "c@a.my")
    p = c.get(f"/i/masjid-a/transactions/{ref}/proof", headers=h).json()
    assert p["intact"] is True and len(p["chain_hash"]) == 64

    db = Session()
    from app.models import Entry

    for e in db.query(Entry).all():
        e.amount = 10
    db.commit()
    db.close()
    p = c.get(f"/i/masjid-a/transactions/{ref}/proof", headers=h).json()
    assert p["intact"] is False
    assert p["checks"][0]["ok"] is False
