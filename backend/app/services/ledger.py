"""
The ledger engine.

Two invariants, enforced here and nowhere else:

  1. Every transaction balances. Debits equal credits, always.
  2. Every disbursement satisfies the rule of the fund it draws from.

Invariant 2 is the product. A spend that violates it is refused at post time
and never reaches the database, so the ledger cannot hold a state that a
treasurer would have to answer for.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.fiqh import FundCategory, PurposeCode, RuleVerdict, rule_for
from app.models import (
    AccountNature,
    Channel,
    CountSession,
    Device,
    Entry,
    EntrySide,
    Fund,
    Seal,
    Transaction,
    TxnStatus,
)
from app.services import sealing

TWOPLACES = Decimal("0.01")


class LedgerError(Exception):
    """Base for anything the ledger refuses to do."""


class UnbalancedTransaction(LedgerError):
    pass


class FundRuleViolation(LedgerError):
    """A spend the fiqh rules do not permit. Carries a usable explanation."""

    def __init__(self, verdict: RuleVerdict):
        self.verdict = verdict
        super().__init__(verdict.message_en)


def money(value) -> Decimal:
    return Decimal(str(value)).quantize(TWOPLACES, rounding=ROUND_HALF_UP)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- rule check


def check_spend(fund: Fund, purpose: PurposeCode) -> RuleVerdict:
    """Ask whether this fund may pay for this purpose.

    Pure function over the fund and the purpose, so it can be called from the
    API to preview a decision before anything is written.
    """

    rule = rule_for(fund.category)

    if not rule.spendable:
        return RuleVerdict(
            allowed=False,
            code="fund_not_spendable",
            message_en=(
                f"{rule.label_en} cannot be spent. {rule.notes.split('.')[0]}."
            ),
            message_ms=(
                f"{rule.label_ms} tidak boleh dibelanjakan. Hanya hasil "
                "wakaf boleh digunakan."
            ),
            suggested_funds=[FundCategory.WAQF_INCOME, FundCategory.SADAQAH],
        )

    if fund.bound_purpose is not None and fund.bound_purpose != purpose:
        return RuleVerdict(
            allowed=False,
            code="donor_purpose_mismatch",
            message_en=(
                f"This fund was given for {fund.bound_purpose.value.replace('_', ' ')} "
                f"and cannot pay for {purpose.value.replace('_', ' ')}."
            ),
            message_ms=(
                "Dana ini terikat kepada tujuan asal penderma dan tidak "
                "boleh digunakan untuk tujuan lain."
            ),
            suggested_funds=[FundCategory.SADAQAH],
        )

    if not rule.permits(purpose):
        return RuleVerdict(
            allowed=False,
            code="purpose_not_permitted",
            message_en=(
                f"{rule.label_en} cannot pay for "
                f"{purpose.value.replace('_', ' ')}. Permitted under "
                f"{rule.basis}."
            ),
            message_ms=(
                f"{rule.label_ms} tidak boleh digunakan untuk tujuan ini "
                f"mengikut {rule.basis}."
            ),
            suggested_funds=[FundCategory.SADAQAH, FundCategory.INFAQ],
        )

    return RuleVerdict(allowed=True)


# ------------------------------------------------------------------ posting


@dataclass
class Leg:
    fund_id: str
    side: EntrySide
    amount: Decimal


def _next_seq(db: Session, institution_id: str, model) -> int:
    current = db.scalar(
        select(func.max(model.seq)).where(model.institution_id == institution_id)
    )
    return (current or 0) + 1


def _head_hash(db: Session, institution_id: str) -> str:
    last = db.scalars(
        select(Seal)
        .where(Seal.institution_id == institution_id)
        .order_by(Seal.seq.desc())
        .limit(1)
    ).first()
    return last.chain_hash if last else sealing.GENESIS_HASH


def post(
    db: Session,
    *,
    institution_id: str,
    description: str,
    legs: list[Leg],
    channel: Channel,
    purpose: PurposeCode | None = None,
    status: TxnStatus = TxnStatus.CONFIRMED,
    occurred_at: datetime | None = None,
    device_id: str | None = None,
    recorded_by: str | None = None,
    confidence: Decimal | None = None,
) -> Transaction:
    """Write one balanced, rule-checked, sealed transaction."""

    if not legs:
        raise UnbalancedTransaction("A transaction needs at least two legs")

    debits = sum((l.amount for l in legs if l.side is EntrySide.DEBIT), Decimal("0"))
    credits = sum((l.amount for l in legs if l.side is EntrySide.CREDIT), Decimal("0"))

    if money(debits) != money(credits):
        raise UnbalancedTransaction(
            f"Debits {money(debits)} do not equal credits {money(credits)}"
        )

    if any(l.amount <= 0 for l in legs):
        raise LedgerError("Every leg must carry a positive amount")

    # A debit against a fund is money leaving it. That is the moment the
    # fiqh rules bite.
    if purpose is not None:
        for leg in legs:
            if leg.side is not EntrySide.DEBIT:
                continue
            fund = db.get(Fund, leg.fund_id)
            if fund is None:
                raise LedgerError(f"Unknown fund {leg.fund_id}")
            verdict = check_spend(fund, purpose)
            if not verdict:
                raise FundRuleViolation(verdict)

    seq = _next_seq(db, institution_id, Transaction)
    occurred = occurred_at or _now()

    txn = Transaction(
        institution_id=institution_id,
        seq=seq,
        reference=f"TX-{occurred.year}-{seq:05d}",
        description=description,
        occurred_at=occurred,
        channel=channel,
        status=status,
        purpose=purpose,
        device_id=device_id,
        recorded_by=recorded_by,
        confidence=confidence,
    )
    txn.entries = [
        Entry(fund_id=l.fund_id, side=l.side, amount=money(l.amount)) for l in legs
    ]

    db.add(txn)
    db.flush()

    _seal(db, txn)
    return txn


def _seal(db: Session, txn: Transaction) -> Seal:
    payload_hash = sealing.hash_payload(
        sealing.transaction_payload(txn, txn.entries)
    )
    prev = _head_hash(db, txn.institution_id)
    seq = _next_seq(db, txn.institution_id, Seal)
    seal = Seal(
        institution_id=txn.institution_id,
        seq=seq,
        transaction_id=txn.id,
        payload_hash=payload_hash,
        prev_hash=prev,
        chain_hash=sealing.chain(prev, payload_hash, seq),
    )
    db.add(seal)
    db.flush()
    return seal


# ----------------------------------------------------- convenience wrappers


def record_donation(
    db: Session,
    *,
    institution_id: str,
    fund_id: str,
    cash_fund_id: str,
    amount,
    description: str,
    channel: Channel,
    status: TxnStatus = TxnStatus.CONFIRMED,
    device_id: str | None = None,
    recorded_by: str | None = None,
    confidence: Decimal | None = None,
) -> Transaction:
    """Money coming in. Debit the cash pot, credit the restricted fund."""

    amt = money(amount)
    return post(
        db,
        institution_id=institution_id,
        description=description,
        legs=[
            Leg(fund_id=cash_fund_id, side=EntrySide.DEBIT, amount=amt),
            Leg(fund_id=fund_id, side=EntrySide.CREDIT, amount=amt),
        ],
        channel=channel,
        status=status,
        device_id=device_id,
        recorded_by=recorded_by,
        confidence=confidence,
    )


def record_disbursement(
    db: Session,
    *,
    institution_id: str,
    fund_id: str,
    cash_fund_id: str,
    amount,
    purpose: PurposeCode,
    description: str,
    channel: Channel = Channel.DASHBOARD,
    recorded_by: str | None = None,
) -> Transaction:
    """Money going out. This is the call that can be refused."""

    amt = money(amount)
    return post(
        db,
        institution_id=institution_id,
        description=description,
        legs=[
            Leg(fund_id=fund_id, side=EntrySide.DEBIT, amount=amt),
            Leg(fund_id=cash_fund_id, side=EntrySide.CREDIT, amount=amt),
        ],
        channel=channel,
        purpose=purpose,
        recorded_by=recorded_by,
    )


def reverse(
    db: Session, *, txn: Transaction, reason: str, recorded_by: str | None = None
) -> Transaction:
    """Correct a mistake by writing its mirror. Never by editing history."""

    if txn.status is TxnStatus.VOID:
        raise LedgerError("Transaction is already reversed")

    flipped = [
        Leg(
            fund_id=e.fund_id,
            side=EntrySide.CREDIT if e.side is EntrySide.DEBIT else EntrySide.DEBIT,
            amount=e.amount,
        )
        for e in txn.entries
    ]

    correction = post(
        db,
        institution_id=txn.institution_id,
        description=f"Reversal of {txn.reference}: {reason}",
        legs=flipped,
        channel=Channel.DASHBOARD,
        recorded_by=recorded_by,
    )
    correction.reverses_id = txn.id
    txn.status = TxnStatus.VOID
    db.flush()
    return correction


# ----------------------------------------------------------------- balances


def fund_balance(db: Session, fund_id: str, *, include_provisional=False) -> Decimal:
    """Credits minus debits for one fund.

    Voided transactions stay in the sum. In double entry a mistake is undone
    by posting its mirror, not by hiding the original, so the pair nets to
    zero on its own. Dropping the void while keeping its reversal would
    subtract the correction twice.

    Provisional entries are excluded by default: a sensor thinks money went
    in, but until somebody counts it, that is an estimate rather than a
    balance. Pass include_provisional to see the estimate.
    """

    statuses = [TxnStatus.CONFIRMED, TxnStatus.VOID]
    if include_provisional:
        statuses.append(TxnStatus.PROVISIONAL)

    rows = db.execute(
        select(Entry.side, func.sum(Entry.amount))
        .join(Transaction, Entry.transaction_id == Transaction.id)
        .where(Entry.fund_id == fund_id, Transaction.status.in_(statuses))
        .group_by(Entry.side)
    ).all()

    totals = {side: Decimal(str(total or 0)) for side, total in rows}
    credit = totals.get(EntrySide.CREDIT, Decimal("0"))
    debit = totals.get(EntrySide.DEBIT, Decimal("0"))

    fund = db.get(Fund, fund_id)
    if fund is not None and fund.nature is AccountNature.ASSET:
        return money(debit - credit)
    return money(credit - debit)


def balances(db: Session, institution_id: str, **kw) -> dict[str, Decimal]:
    funds = db.scalars(
        select(Fund).where(Fund.institution_id == institution_id, Fund.active.is_(True))
    ).all()
    return {f.code: fund_balance(db, f.id, **kw) for f in funds}


# ----------------------------------------------------------- reconciliation


def close_count(
    db: Session,
    *,
    institution_id: str,
    device_id: str | None,
    counted_total,
    cash_fund_id: str,
    witness_count: int = 1,
    note: str | None = None,
    closed_by: str | None = None,
) -> CountSession:
    """Reconcile provisional device entries against a physical count.

    The box says one number, the humans counting say another. The difference
    is written down permanently rather than quietly absorbed, which is the
    entire point. A clean variance is also evidence that the people who
    handled the money did so honestly, which matters as much as catching the
    cases where they did not.
    """

    counted = money(counted_total)

    pending = db.scalars(
        select(Transaction).where(
            Transaction.institution_id == institution_id,
            Transaction.status == TxnStatus.PROVISIONAL,
            Transaction.device_id == device_id,
        )
    ).all()

    estimated = Decimal("0")
    for txn in pending:
        for entry in txn.entries:
            if entry.side is EntrySide.CREDIT:
                estimated += entry.amount
    estimated = money(estimated)

    for txn in pending:
        txn.status = TxnStatus.CONFIRMED

    variance = money(counted - estimated)

    if variance != Decimal("0"):
        target_fund = None
        if pending:
            for entry in pending[-1].entries:
                if entry.side is EntrySide.CREDIT:
                    target_fund = entry.fund_id
                    break
        if target_fund is None:
            target_fund = cash_fund_id

        side_cash = EntrySide.DEBIT if variance > 0 else EntrySide.CREDIT
        side_fund = EntrySide.CREDIT if variance > 0 else EntrySide.DEBIT

        post(
            db,
            institution_id=institution_id,
            description=(
                f"Count adjustment: counted {counted} against estimate {estimated}"
            ),
            legs=[
                Leg(fund_id=cash_fund_id, side=side_cash, amount=abs(variance)),
                Leg(fund_id=target_fund, side=side_fund, amount=abs(variance)),
            ],
            channel=Channel.DASHBOARD,
            recorded_by=closed_by,
        )

    session_row = CountSession(
        institution_id=institution_id,
        device_id=device_id,
        counted_total=counted,
        estimated_total=estimated,
        variance=variance,
        witness_count=witness_count,
        note=note,
        closed_by=closed_by,
    )
    db.add(session_row)
    db.flush()
    return session_row


# ------------------------------------------------------------ verification


def verify(db: Session, institution_id: str) -> sealing.VerificationResult:
    seals = db.scalars(
        select(Seal)
        .where(Seal.institution_id == institution_id)
        .order_by(Seal.seq.asc())
    ).all()

    records = []
    for seal in seals:
        txn = db.get(Transaction, seal.transaction_id)
        records.append((seal, txn, txn.entries))

    return sealing.verify_chain(records)
