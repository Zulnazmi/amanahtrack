"""Donations, two-person approval, reversals, receipts and people."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.core import throttle
from app.core.fiqh import PurposeCode
from app.main import app, get_db
from app.models import Base, CountSession, Institution, PushToken, Role, Transaction, User
from app.services import ledger
from create_mosque import create

PW = "a-long-password"


@pytest.fixture()
def env(tmp_path):
    throttle.reset()
    engine = create_engine(f"sqlite:///{tmp_path}/daily.db")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
    with Session() as db:
        for slug in ("m", "other"):
            create(db, name=slug, slug=slug, state="x", admin_name="Admin",
                   email=f"admin@{slug}.my", password=PW, serial=slug, box_label="b")
        inst = db.scalars(select(Institution).where(Institution.slug == "m")).one()
        h = db.scalars(select(User).where(User.email == "admin@m.my")).one().password_hash
        for role in ("treasurer", "committee", "auditor"):
            db.add(User(institution_id=inst.id, name=role.title(), email=f"{role}@m.my",
                        password_hash=h, role=Role(role)))
        db.commit()
    yield TestClient(app), Session
    app.dependency_overrides.clear()
    throttle.reset()


def login(c, who, pw=PW, mosque="m"):
    r = c.post("/auth/login", data={"username": f"{who}@{mosque}.my", "password": pw})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def give(c, h, amount="100", **kw):
    return c.post("/i/m/donations", headers=h, json={
        "fund_code": "sadaqah", "amount": amount, "description": "Friday", **kw})


SPEND = {"fund_code": "sadaqah", "amount": "40", "purpose": "utilities", "description": "Electricity"}


def balance(c, h, code="sadaqah"):
    return next(f["balance"] for f in c.get("/i/m/funds", headers=h).json() if f["code"] == code)


def decide(c, h, aid, action="approve"):
    return c.post(f"/i/m/approvals/{aid}/decision", headers=h, json={"action": action})


def test_double_tap_records_one_donation(env):
    c, _ = env
    t = login(c, "treasurer")
    a = give(c, t, request_id="tap-12345").json()
    b = give(c, t, request_id="tap-12345").json()
    assert a["reference"] == b["reference"] and a["receipt_number"] == "R-000001"
    assert balance(c, t) == "100.00"
    assert give(c, t, "999", request_id="tap-12345").status_code == 409
    assert give(c, t).json()["receipt_number"] == "R-000002"
    assert give(c, t, channel="device").status_code == 422
    assert give(c, t, "0.001").status_code == 400


def test_receipt_hides_donor_and_shows_when_cancelled(env):
    c, Session = env
    t, k = login(c, "treasurer"), login(c, "committee")
    ref = give(c, t, donor_name="Penderma A").json()["reference"]
    url = f"/i/m/transactions/{ref}/receipt"
    assert c.get(url, headers=t).json()["donor_name"] == "Penderma A"
    assert c.get(url, headers=t).json()["valid"] is True
    assert c.get(url, headers=k).status_code == 403
    with Session() as db:
        assert "Penderma" not in db.scalars(select(Transaction)).one().description
    aid = c.post(f"/i/m/transactions/{ref}/reversal", headers=t, json={"reason": "Wrong fund"}).json()["id"]
    assert decide(c, k, aid).status_code == 200
    assert c.get(url, headers=t).json()["valid"] is False


def test_spending_needs_a_second_person(env):
    c, _ = env
    t, k, a, aud = (login(c, w) for w in ("treasurer", "committee", "admin", "auditor"))
    give(c, t)
    r = c.post("/i/m/disbursements", headers=t, json=SPEND)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "approval_required"
    assert c.post("/i/m/approvals", headers=k, json=SPEND).status_code == 403
    aid = c.post("/i/m/approvals", headers=t, json=SPEND).json()["id"]
    assert balance(c, t) == "100.00"
    assert decide(c, t, aid).status_code == 403
    assert decide(c, aud, aid).status_code == 403
    ok = decide(c, k, aid).json()
    assert ok["status"] == "approved" and balance(c, t) == "60.00"
    assert decide(c, a, aid).status_code == 409 and balance(c, t) == "60.00"
    desc = c.get("/i/m/transactions", headers=t).json()[0]["description"]
    assert "requested by Treasurer, approved by Committee" in desc
    assert c.get("/i/m/verify", headers=t).json()["intact"]


def test_nobody_approves_their_own_request_even_an_admin(env):
    c, _ = env
    a = login(c, "admin")
    give(c, a)
    aid = c.post("/i/m/approvals", headers=a, json=SPEND).json()["id"]
    assert decide(c, a, aid).status_code == 403
    assert balance(c, a) == "100.00"


def test_rules_are_checked_again_at_approval(env):
    c, _ = env
    t, k = login(c, "treasurer"), login(c, "committee")
    give(c, t)
    ids = [c.post("/i/m/approvals", headers=t, json=SPEND | {"amount": "70"}).json()["id"] for _ in range(2)]
    assert decide(c, k, ids[0]).status_code == 200
    r = decide(c, k, ids[1])
    assert r.status_code == 409 and r.json()["detail"]["code"] == "insufficient_fund_balance"
    assert balance(c, t) == "30.00"
    assert [x["id"] for x in c.get("/i/m/approvals?status=pending", headers=t).json()] == [ids[1]]


def test_forbidden_spend_cannot_be_requested(env):
    c, _ = env
    t = login(c, "treasurer")
    c.post("/i/m/donations", headers=t, json={"fund_code": "zakat", "amount": "100", "description": "z"})
    for url in ("/i/m/approvals", "/i/m/disbursements"):
        assert c.post(url, headers=t, json=SPEND | {"fund_code": "zakat"}).status_code == 422


def test_reject_cancel_and_resubmit(env):
    c, _ = env
    t, k = login(c, "treasurer"), login(c, "committee")
    give(c, t)
    one = SPEND | {"request_id": "req-12345"}
    aid = c.post("/i/m/approvals", headers=t, json=one).json()["id"]
    assert c.post("/i/m/approvals", headers=t, json=one).json()["id"] == aid
    assert c.post("/i/m/approvals", headers=t, json=one | {"amount": "41"}).status_code == 409
    assert decide(c, k, aid, "reject").json()["status"] == "rejected"
    assert decide(c, k, aid).status_code == 409
    other = c.post("/i/m/approvals", headers=t, json=SPEND).json()["id"]
    assert c.post(f"/i/m/approvals/{other}/cancel", headers=k).status_code == 403
    assert c.post(f"/i/m/approvals/{other}/cancel", headers=t).json()["status"] == "cancelled"
    assert balance(c, t) == "100.00"


def test_reversal_limits(env):
    c, Session = env
    t, k = login(c, "treasurer"), login(c, "committee")
    ref = give(c, t).json()["reference"]

    def ask(r):
        return c.post(f"/i/m/transactions/{r}/reversal", headers=t, json={"reason": "Typed twice"})

    aid = ask(ref).json()["id"]
    assert ask(ref).status_code == 409  # already waiting
    spent = c.post("/i/m/approvals", headers=t, json=SPEND).json()["id"]
    decide(c, k, spent)
    r = decide(c, k, aid)  # the money has been spent
    assert r.status_code == 409 and balance(c, t) == "60.00"
    give(c, t, "40")
    done = decide(c, k, aid).json()
    assert done["status"] == "approved" and balance(c, t) == "0.00"
    assert ask(ref).status_code == 409 and ask(done["result_reference"]).status_code == 409
    assert c.get("/i/m/verify", headers=t).json()["intact"]
    with Session() as db:
        inst = db.scalars(select(Institution).where(Institution.slug == "m")).one()
        assert ledger.verify(db, inst.id).checked == 4


def test_other_mosque_sees_and_decides_nothing(env):
    c, _ = env
    t, x = login(c, "treasurer"), login(c, "admin", mosque="other")
    ref = give(c, t).json()["reference"]
    aid = c.post("/i/m/approvals", headers=t, json=SPEND).json()["id"]
    for path in ("/i/m/approvals", "/i/m/users", "/i/m/audit", f"/i/m/transactions/{ref}/receipt"):
        assert c.get(path, headers=x).status_code == 404
    assert decide(c, x, aid).status_code == 404
    r = c.post(f"/i/other/approvals/{aid}/decision", headers=x, json={"action": "approve"})
    assert r.status_code == 404


def test_new_person_must_choose_a_password(env):
    c, _ = env
    a = login(c, "admin")
    body = {"name": "Baru", "email": " New@M.my ", "role": "committee"}
    made = c.post("/i/m/users", headers=a, json=body).json()
    assert c.post("/i/m/users", headers=a, json=body).status_code == 409
    temp = made["temporary_password"]
    h = login(c, "NEW", temp)
    assert c.get("/auth/me", headers=h).json()["must_change_password"] is True
    assert c.get("/i/m/funds", headers=h).status_code == 403
    url = "/auth/change-password"
    assert c.post(url, headers=h, json={"current": temp, "new": temp}).status_code == 422
    assert c.post(url, headers=h, json={"current": temp, "new": "my-own-password"}).status_code == 204
    assert c.get("/i/m/funds", headers=h).status_code == 401  # old sign-in ended
    assert c.get("/i/m/funds", headers=login(c, "new", "my-own-password")).status_code == 200


def test_removing_access_works_immediately(env):
    c, Session = env
    a, t, k = (login(c, w) for w in ("admin", "treasurer", "committee"))
    give(c, t)
    aid = c.post("/i/m/approvals", headers=t, json=SPEND).json()["id"]
    c.post("/i/m/push-token", headers=t, json={"token": "ExponentPushToken[x]"})
    people = {u["name"]: u["id"] for u in c.get("/i/m/users", headers=a).json()}
    url = f"/i/m/users/{people['Treasurer']}"
    assert c.patch(url, headers=k, json={"active": False}).status_code == 403
    assert c.patch(url, headers=a, json={"active": False}).status_code == 200
    assert c.get("/i/m/funds", headers=t).status_code == 401
    with Session() as db:
        assert db.scalars(select(PushToken)).all() == []
    assert decide(c, k, aid).status_code == 409  # asked by someone removed
    c.patch(url, headers=a, json={"active": True})
    assert c.get("/i/m/funds", headers=t).status_code == 401  # must sign in again
    assert c.patch(f"/i/m/users/{people['Admin']}", headers=a, json={"role": "auditor"}).status_code == 409
    log = c.get("/i/m/audit", headers=login(c, "auditor")).json()
    assert len(log) == 2 and {e["actor"] for e in log} == {"Admin"}


def test_password_reset_ends_old_sign_ins(env):
    c, _ = env
    a, t = login(c, "admin"), login(c, "treasurer")
    uid = next(u["id"] for u in c.get("/i/m/users", headers=a).json() if u["name"] == "Treasurer")
    temp = c.post(f"/i/m/users/{uid}/reset-password", headers=a).json()["temporary_password"]
    assert c.get("/i/m/funds", headers=t).status_code == 401
    assert c.get("/i/m/funds", headers=login(c, "treasurer", temp)).status_code == 403


def test_count_records_witness_names(env):
    c, Session = env
    t = login(c, "treasurer")
    body = {"counted_total": "50", "fund_code": "sadaqah", "witnesses": ["Ali  Ahmad", "Siti"]}
    assert c.post("/i/m/counts", headers=t, json=body).status_code == 201
    assert c.post("/i/m/counts", headers=t, json=body | {"witnesses": ["Ali", "ali"]}).status_code == 422
    with Session() as db:
        row = db.scalars(select(CountSession)).one()
        assert row.witness_names == "Ali Ahmad\nSiti" and row.witness_count == 2
    ref = c.get("/i/m/transactions", headers=t).json()[0]["reference"]
    r = c.post(f"/i/m/transactions/{ref}/reversal", headers=t, json={"reason": "undo count"})
    assert r.status_code == 409


def test_purpose_codes_fit_the_column():
    assert max(len(p.value) for p in PurposeCode) <= 40
