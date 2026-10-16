"""Tests for the ledger core. These are the guarantees we sell."""

from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.fiqh import FundCategory, PurposeCode
from app.models import Base, Channel, Device, EntrySide, Fund, Institution, TxnStatus
from app.services import ledger
from app.services.ledger import FundRuleViolation, Leg, UnbalancedTransaction


@pytest.fixture()
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture()
def masjid(db):
    inst = Institution(name="Masjid Al-Hidayah", slug="al-hidayah", state="Perak")
    db.add(inst)
    db.flush()

    funds = {
        "cash": Fund(
            institution_id=inst.id,
            code="cash",
            category=FundCategory.SADAQAH,
            label_ms="Tunai",
            label_en="Cash on hand",
        ),
        "zakat": Fund(
            institution_id=inst.id,
            code="zakat",
            category=FundCategory.ZAKAT,
            label_ms="Zakat",
            label_en="Zakat",
        ),
        "sadaqah": Fund(
            institution_id=inst.id,
            code="sadaqah",
            category=FundCategory.SADAQAH,
            label_ms="Sedekah am",
            label_en="General sadaqah",
        ),
        "waqf": Fund(
            institution_id=inst.id,
            code="waqf",
            category=FundCategory.WAQF_PRINCIPAL,
            label_ms="Wakaf modal",
            label_en="Waqf principal",
        ),
        "yatim": Fund(
            institution_id=inst.id,
            code="yatim",
            category=FundCategory.INFAQ,
            label_ms="Infaq anak yatim",
            label_en="Orphan infaq",
            bound_purpose=PurposeCode.ORPHAN_WELFARE,
        ),
    }
    for f in funds.values():
        db.add(f)
    db.flush()
    return inst, funds


# ------------------------------------------------------------ double entry


def test_balanced_transaction_posts(db, masjid):
    inst, funds = masjid
    txn = ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["sadaqah"].id,
        cash_fund_id=funds["cash"].id,
        amount="1250.00",
        description="Tabung Jumaat",
        channel=Channel.TELEGRAM,
    )
    assert txn.reference.startswith("TX-")
    assert len(txn.entries) == 2
    assert ledger.fund_balance(db, funds["sadaqah"].id) == Decimal("1250.00")


def test_unbalanced_transaction_is_refused(db, masjid):
    inst, funds = masjid
    with pytest.raises(UnbalancedTransaction):
        ledger.post(
            db,
            institution_id=inst.id,
            description="Broken",
            legs=[
                Leg(funds["cash"].id, EntrySide.DEBIT, Decimal("100")),
                Leg(funds["sadaqah"].id, EntrySide.CREDIT, Decimal("90")),
            ],
            channel=Channel.DASHBOARD,
        )


# --------------------------------------------------------- the fiqh rules


def test_zakat_cannot_pay_the_electricity_bill(db, masjid):
    """The screen we said we would demo to a judge."""
    inst, funds = masjid
    ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["zakat"].id,
        cash_fund_id=funds["cash"].id,
        amount="5000",
        description="Kutipan zakat",
        channel=Channel.DASHBOARD,
    )

    with pytest.raises(FundRuleViolation) as exc:
        ledger.record_disbursement(
            db,
            institution_id=inst.id,
            fund_id=funds["zakat"].id,
            cash_fund_id=funds["cash"].id,
            amount="890",
            purpose=PurposeCode.UTILITIES,
            description="Bil elektrik TNB",
        )

    assert exc.value.verdict.code == "purpose_not_permitted"
    assert "At-Tawbah" in exc.value.verdict.message_en
    assert ledger.fund_balance(db, funds["zakat"].id) == Decimal("5000.00")


def test_zakat_can_pay_an_asnaf(db, masjid):
    inst, funds = masjid
    ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["zakat"].id,
        cash_fund_id=funds["cash"].id,
        amount="5000",
        description="Kutipan zakat",
        channel=Channel.DASHBOARD,
    )
    ledger.record_disbursement(
        db,
        institution_id=inst.id,
        fund_id=funds["zakat"].id,
        cash_fund_id=funds["cash"].id,
        amount="3000",
        purpose=PurposeCode.ASNAF_FAKIR,
        description="Bantuan 6 keluarga asnaf",
    )
    assert ledger.fund_balance(db, funds["zakat"].id) == Decimal("2000.00")


def test_waqf_principal_can_never_be_spent(db, masjid):
    inst, funds = masjid
    ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["waqf"].id,
        cash_fund_id=funds["cash"].id,
        amount="96000",
        description="Wakaf tanah tunai",
        channel=Channel.DASHBOARD,
    )
    for purpose in (
        PurposeCode.ASNAF_FAKIR,
        PurposeCode.MOSQUE_MAINTENANCE,
        PurposeCode.EDUCATION,
    ):
        with pytest.raises(FundRuleViolation) as exc:
            ledger.record_disbursement(
                db,
                institution_id=inst.id,
                fund_id=funds["waqf"].id,
                cash_fund_id=funds["cash"].id,
                amount="100",
                purpose=purpose,
                description="Attempt to consume principal",
            )
        assert exc.value.verdict.code == "fund_not_spendable"


def test_donor_bound_infaq_rejects_other_purposes(db, masjid):
    inst, funds = masjid
    ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["yatim"].id,
        cash_fund_id=funds["cash"].id,
        amount="7180",
        description="Infaq anak yatim",
        channel=Channel.QR_PAYMENT,
    )
    with pytest.raises(FundRuleViolation) as exc:
        ledger.record_disbursement(
            db,
            institution_id=inst.id,
            fund_id=funds["yatim"].id,
            cash_fund_id=funds["cash"].id,
            amount="500",
            purpose=PurposeCode.MOSQUE_MAINTENANCE,
            description="Cat semula dewan",
        )
    assert exc.value.verdict.code == "donor_purpose_mismatch"

    ledger.record_disbursement(
        db,
        institution_id=inst.id,
        fund_id=funds["yatim"].id,
        cash_fund_id=funds["cash"].id,
        amount="500",
        purpose=PurposeCode.ORPHAN_WELFARE,
        description="Keperluan sekolah",
    )
    assert ledger.fund_balance(db, funds["yatim"].id) == Decimal("6680.00")


# ------------------------------------------------------------- the sealing


def test_chain_verifies_after_many_transactions(db, masjid):
    inst, funds = masjid
    for i in range(20):
        ledger.record_donation(
            db,
            institution_id=inst.id,
            fund_id=funds["sadaqah"].id,
            cash_fund_id=funds["cash"].id,
            amount=Decimal("10") * (i + 1),
            description=f"Derma {i}",
            channel=Channel.TELEGRAM,
        )
    result = ledger.verify(db, inst.id)
    assert result.intact
    assert result.checked == 20


def test_chain_survives_reload_from_a_real_sqlite_file(tmp_path, masjid):
    """Regression test.

    The in-memory fixture above never round-trips through a real file, which
    let a real bug through: SQLite silently drops timezone info, so a
    transaction hashed once as tz-aware and reloaded later as naive produced
    two different hashes for the same data, reading as tampering that never
    happened. Anything written and then reloaded in a separate session, which
    is exactly what happens between `seed.py` and `uvicorn --reload`, must
    still verify as intact.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    db_path = tmp_path / "regression.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)

    write_session = Session()
    inst = Institution(name="Regression", slug="regression")
    write_session.add(inst)
    write_session.flush()
    cash = Fund(
        institution_id=inst.id,
        code="cash",
        category=FundCategory.SADAQAH,
        label_ms="x",
        label_en="x",
    )
    sadaqah = Fund(
        institution_id=inst.id,
        code="sadaqah",
        category=FundCategory.SADAQAH,
        label_ms="x",
        label_en="x",
    )
    write_session.add_all([cash, sadaqah])
    write_session.flush()
    ledger.record_donation(
        write_session,
        institution_id=inst.id,
        fund_id=sadaqah.id,
        cash_fund_id=cash.id,
        amount="100",
        description="test",
        channel=Channel.DASHBOARD,
    )
    write_session.commit()
    inst_id = inst.id
    write_session.close()

    fresh_session = Session()
    result = ledger.verify(fresh_session, inst_id)
    assert result.intact, result.summary
    fresh_session.close()


def test_tampering_with_history_is_detected(db, masjid):
    """Someone edits an old amount directly in the database."""
    inst, funds = masjid
    for i in range(5):
        ledger.record_donation(
            db,
            institution_id=inst.id,
            fund_id=funds["sadaqah"].id,
            cash_fund_id=funds["cash"].id,
            amount="100",
            description=f"Derma {i}",
            channel=Channel.TELEGRAM,
        )
    assert ledger.verify(db, inst.id).intact

    victim = db.query(ledger.Transaction).filter_by(seq=2).one()
    victim.entries[0].amount = Decimal("10.00")
    db.flush()

    result = ledger.verify(db, inst.id)
    assert not result.intact
    assert result.broken_at_seq == 2
    assert "does not match its seal" in result.reason


def test_corrections_are_reversals_not_edits(db, masjid):
    inst, funds = masjid
    txn = ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["sadaqah"].id,
        cash_fund_id=funds["cash"].id,
        amount="500",
        description="Typo, meant 50",
        channel=Channel.TELEGRAM,
    )
    ledger.reverse(db, txn=txn, reason="amount keyed wrong")

    assert txn.status is TxnStatus.VOID
    assert ledger.fund_balance(db, funds["sadaqah"].id) == Decimal("0.00")
    assert ledger.verify(db, inst.id).intact


# --------------------------------------------------------- reconciliation


def test_count_session_records_variance(db, masjid):
    """The box estimated more than the humans counted. That gets logged."""
    inst, funds = masjid
    device = Device(
        institution_id=inst.id,
        serial="BOX-002",
        label="Tabung pintu utama",
        shared_secret="x" * 40,
    )
    db.add(device)
    db.flush()

    for amount in ("120.00", "85.50", "300.00"):
        ledger.record_donation(
            db,
            institution_id=inst.id,
            fund_id=funds["sadaqah"].id,
            cash_fund_id=funds["cash"].id,
            amount=amount,
            description="Sensor insertion estimate",
            channel=Channel.DEVICE,
            status=TxnStatus.PROVISIONAL,
            device_id=device.id,
            confidence=Decimal("0.85"),
        )

    assert ledger.fund_balance(db, funds["sadaqah"].id) == Decimal("0.00")
    assert ledger.fund_balance(
        db, funds["sadaqah"].id, include_provisional=True
    ) == Decimal("505.50")

    session = ledger.close_count(
        db,
        institution_id=inst.id,
        device_id=device.id,
        counted_total="480.00",
        cash_fund_id=funds["cash"].id,
        witness_count=3,
        note="Dikira oleh 3 AJK",
    )

    assert session.estimated_total == Decimal("505.50")
    assert session.counted_total == Decimal("480.00")
    assert session.variance == Decimal("-25.50")
    assert ledger.fund_balance(db, funds["sadaqah"].id) == Decimal("480.00")
    assert ledger.verify(db, inst.id).intact


def test_clean_count_produces_no_adjustment(db, masjid):
    inst, funds = masjid
    device = Device(
        institution_id=inst.id, serial="BOX-001", label="Tabung", shared_secret="y" * 40
    )
    db.add(device)
    db.flush()

    ledger.record_donation(
        db,
        institution_id=inst.id,
        fund_id=funds["sadaqah"].id,
        cash_fund_id=funds["cash"].id,
        amount="200.00",
        description="Sensor estimate",
        channel=Channel.DEVICE,
        status=TxnStatus.PROVISIONAL,
        device_id=device.id,
    )
    session = ledger.close_count(
        db,
        institution_id=inst.id,
        device_id=device.id,
        counted_total="200.00",
        cash_fund_id=funds["cash"].id,
    )
    assert session.variance == Decimal("0.00")
    assert ledger.fund_balance(db, funds["sadaqah"].id) == Decimal("200.00")
