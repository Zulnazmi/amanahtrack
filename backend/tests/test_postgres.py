"""Things only a real PostgreSQL can prove.

Skipped unless AMANAH_TEST_POSTGRES_URL points at an EMPTY, throwaway database.
"""

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from test_storage import schema_diff

from app.core import migrate
from app.core.fiqh import PurposeCode
from app.models import Approval, Channel, Fund, Institution, Role, Transaction, User
from app.services import approvals, ledger
from create_mosque import create

URL = os.getenv("AMANAH_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not URL, reason="no test PostgreSQL")


@pytest.fixture(scope="module")
def Session():
    engine = create_engine(URL, pool_size=12)
    migrate.upgrade(engine)
    migrate.upgrade(engine)
    assert schema_diff(engine) == []
    yield sessionmaker(bind=engine, autoflush=False)
    engine.dispose()


@pytest.fixture()
def ids(Session):
    tag = uuid.uuid4().hex[:8]
    with Session() as db:
        create(db, name=tag, slug=tag, state="x", admin_name="a", email=f"{tag}@a.my",
               password="a-long-password", serial=tag, box_label="b")
        inst = db.query(Institution).filter_by(slug=tag).one().id
        funds = {f.code: f.id for f in db.query(Fund).filter_by(institution_id=inst)}
    return {"institution_id": inst, "fund_id": funds["sadaqah"], "cash_fund_id": funds["cash"]}


def donate(Session, ids, amount):
    with Session() as db:
        ledger.record_donation(db, **ids, amount=amount, description="d",
                               channel=Channel.DASHBOARD)
        db.commit()


def test_simultaneous_donations_all_land_in_one_intact_chain(Session, ids):
    with ThreadPoolExecutor(10) as pool:
        list(pool.map(lambda _: donate(Session, ids, "1"), range(40)))
    with Session() as db:
        assert ledger.fund_balance(db, ids["fund_id"]) == Decimal("40.00")
        result = ledger.verify(db, ids["institution_id"])
        assert result.intact and result.checked == 40


def test_simultaneous_spending_never_overdraws(Session, ids):
    donate(Session, ids, "100")

    def spend(_):
        with Session() as db:
            try:
                ledger.record_disbursement(db, **ids, amount="30",
                                           purpose=PurposeCode.UTILITIES, description="s")
                db.commit()
                return True
            except ledger.InsufficientBalance:
                db.rollback()
                return False

    with ThreadPoolExecutor(10) as pool:
        assert sum(pool.map(spend, range(10))) == 3
    with Session() as db:
        assert ledger.fund_balance(db, ids["fund_id"]) == Decimal("10.00")
        assert ledger.verify(db, ids["institution_id"]).intact


def test_simultaneous_approvals_pay_once(Session, ids):
    donate(Session, ids, "100")
    with Session() as db:
        people = [
            User(institution_id=ids["institution_id"], name=f"p{i}", role=Role.COMMITTEE)
            for i in range(8)
        ]
        db.add_all(people)
        db.flush()
        row = approvals.request_spend(
            db, fund=db.get(Fund, ids["fund_id"]), amount="40",
            purpose=PurposeCode.UTILITIES, description="Electricity",
            user=people[0], request_id=None,
        )
        db.commit()
        approval_id, approvers = row.id, [p.id for p in people[1:]]

    def approve(user_id):
        with Session() as db:
            try:
                approvals.decide(
                    db, db.get(Approval, approval_id), user=db.get(User, user_id),
                    action="approve", note=None, cash_fund_id=ids["cash_fund_id"],
                )
                db.commit()
                return True
            except approvals.ApprovalError:
                db.rollback()
                return False

    with ThreadPoolExecutor(7) as pool:
        assert sum(pool.map(approve, approvers)) == 1
    with Session() as db:
        assert ledger.fund_balance(db, ids["fund_id"]) == Decimal("60.00")


def test_simultaneous_double_taps_record_one_donation(Session, ids):
    from fastapi.testclient import TestClient

    from app.core import auth
    from app.main import app, get_db

    with Session() as db:
        inst = db.get(Institution, ids["institution_id"])
        user = db.query(User).filter_by(institution_id=inst.id).one()
        slug, token = inst.slug, auth.create_token(user)

    def override():
        with Session() as db:
            yield db

    app.dependency_overrides[get_db] = override
    try:
        c = TestClient(app)

        def tap(_):
            return c.post(
                f"/i/{slug}/donations", headers={"Authorization": f"Bearer {token}"},
                json={"fund_code": "sadaqah", "amount": "10", "description": "d",
                      "request_id": "same-tap-1"},
            ).status_code

        with ThreadPoolExecutor(8) as pool:
            assert set(pool.map(tap, range(8))) == {201}
    finally:
        app.dependency_overrides.clear()
    with Session() as db:
        assert db.query(Transaction).filter_by(institution_id=ids["institution_id"]).count() == 1
        assert ledger.fund_balance(db, ids["fund_id"]) == Decimal("10.00")
