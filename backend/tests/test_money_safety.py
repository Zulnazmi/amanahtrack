"""Money must never disappear, go nowhere, or be spent twice."""

from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core import auth
from app.core.fiqh import FundCategory, PurposeCode
from app.main import app, get_db
from app.models import (
    AccountNature,
    Base,
    Channel,
    Device,
    Entry,
    Fund,
    Institution,
    Role,
    Transaction,
    User,
)
from app.services import ledger


@pytest.fixture()
def env(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path}/money.db")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)

    def override():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override
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
                serial="BOX-M",
                label="Main box",
                default_fund_id=sadaqah.id,
                shared_secret="s" * 40,
            ),
            Device(
                institution_id=inst.id,
                serial="BOX-NOFUND",
                label="Unconfigured box",
                shared_secret="s" * 40,
            ),
            User(
                institution_id=inst.id,
                name="T",
                email="t@a.my",
                password_hash=auth.hash_password("pw"),
                role=Role.TREASURER,
            ),
        ]
    )
    db.commit()
    ids = {"inst": inst.id, "cash": cash.id, "sadaqah": sadaqah.id}
    db.close()
    c = TestClient(app)
    token = c.post("/auth/login", data={"username": "t@a.my", "password": "pw"}).json()
    c.headers["Authorization"] = f"Bearer {token['access_token']}"
    yield c, Session, ids
    app.dependency_overrides.clear()


def balances(Session, ids):
    with Session() as db:
        return (
            ledger.fund_balance(db, ids["cash"]),
            ledger.fund_balance(db, ids["sadaqah"]),
        )


def test_count_with_no_sensor_estimate_still_reaches_a_fund(env):
    """The box was offline, or held only notes. The cash is still real."""
    c, Session, ids = env
    r = c.post(
        "/i/masjid-a/counts",
        json={"device_serial": "BOX-M", "counted_total": "500.00", "witness_count": 2},
    )
    assert r.status_code == 201
    assert balances(Session, ids) == (Decimal("500.00"), Decimal("500.00"))


def test_count_is_refused_when_there_is_no_fund_to_credit(env):
    c, Session, ids = env
    for body in (
        {"device_serial": "BOX-NOFUND", "counted_total": "500.00"},
        {"counted_total": "500.00"},
    ):
        assert c.post("/i/masjid-a/counts", json=body).status_code == 409
    assert balances(Session, ids) == (Decimal("0.00"), Decimal("0.00"))


def test_count_can_name_its_fund(env):
    c, Session, ids = env
    r = c.post(
        "/i/masjid-a/counts", json={"counted_total": "75.00", "fund_code": "sadaqah"}
    )
    assert r.status_code == 201
    assert balances(Session, ids) == (Decimal("75.00"), Decimal("75.00"))


def test_cash_is_not_a_fund_you_can_give_to_or_spend_from(env):
    c, Session, ids = env
    c.post(
        "/i/masjid-a/donations",
        json={"fund_code": "sadaqah", "amount": "100", "description": "d"},
    )
    r = c.post(
        "/i/masjid-a/donations",
        json={"fund_code": "cash", "amount": "50", "description": "d"},
    )
    assert r.status_code == 400
    r = c.post(
        "/i/masjid-a/check-spend", json={"fund_code": "cash", "purpose": "utilities"}
    )
    assert r.json()["allowed"] is False
    r = c.post(
        "/i/masjid-a/disbursements",
        json={
            "fund_code": "cash",
            "amount": "50",
            "purpose": "utilities",
            "description": "TNB",
        },
    )
    assert r.status_code == 422
    assert balances(Session, ids) == (Decimal("100.00"), Decimal("100.00"))


def test_ledger_itself_refuses_to_overspend(env):
    """Enforced in the engine, not only in the route in front of it."""
    _, Session, ids = env
    with Session() as db:
        ledger.record_donation(
            db,
            institution_id=ids["inst"],
            fund_id=ids["sadaqah"],
            cash_fund_id=ids["cash"],
            amount="100",
            description="d",
            channel=Channel.DASHBOARD,
        )
        with pytest.raises(ledger.LedgerError):
            ledger.record_disbursement(
                db,
                institution_id=ids["inst"],
                fund_id=ids["sadaqah"],
                cash_fund_id=ids["cash"],
                amount="100.01",
                purpose=PurposeCode.UTILITIES,
                description="too much",
            )


def test_overspend_over_the_api_is_409(env):
    c, _, _ = env
    r = c.post(
        "/i/masjid-a/disbursements",
        json={
            "fund_code": "sadaqah",
            "amount": "1",
            "purpose": "utilities",
            "description": "TNB",
        },
    )
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "insufficient_fund_balance"


def _donate(Session, ids):
    with Session() as db:
        txn = ledger.record_donation(
            db,
            institution_id=ids["inst"],
            fund_id=ids["sadaqah"],
            cash_fund_id=ids["cash"],
            amount="100",
            description="d",
            channel=Channel.DASHBOARD,
        )
        db.commit()
        return txn.id


def test_a_deleted_transaction_is_reported_not_a_crash(env):
    c, Session, ids = env
    txn_id = _donate(Session, ids)
    with Session() as db:
        db.query(Entry).filter_by(transaction_id=txn_id).delete()
        db.query(Transaction).filter_by(id=txn_id).delete()
        db.commit()
    r = c.get("/i/masjid-a/verify")
    assert r.status_code == 200 and r.json()["intact"] is False


def test_a_transaction_slipped_in_without_a_seal_is_reported(env):
    c, Session, ids = env
    _donate(Session, ids)
    with Session() as db:
        db.add(
            Transaction(
                institution_id=ids["inst"],
                seq=99,
                reference="TX-FAKE",
                description="inserted by hand",
                channel=Channel.DASHBOARD,
            )
        )
        db.commit()
    assert c.get("/i/masjid-a/verify").json()["intact"] is False
