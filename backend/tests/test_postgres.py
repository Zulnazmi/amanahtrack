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
from app.models import Channel, Fund, Institution
from app.services import ledger
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
