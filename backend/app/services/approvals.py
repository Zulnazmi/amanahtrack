"""Two people for anything that takes money out or undoes a record.

One person asks, a different person decides. Every rule is checked again at
the moment of approval, because balances move while a request is waiting.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.fiqh import PurposeCode
from app.models import Approval, Channel, Fund, Transaction, TxnStatus, User
from app.services import ledger
from app.services.ledger import FundRuleViolation, InsufficientBalance, LedgerError


class ApprovalError(Exception):
    pass


class NotYours(ApprovalError):
    """The right person has to do this."""


def check_reversible(txn: Transaction) -> None:
    if txn.status is TxnStatus.VOID:
        raise ApprovalError("This entry is already reversed")
    if txn.reverses_id is not None:
        raise ApprovalError("A reversal cannot itself be reversed")
    if txn.status is TxnStatus.PROVISIONAL:
        raise ApprovalError("This box entry has not been counted. Count the box instead.")
    if txn.channel is Channel.DEVICE or txn.description.startswith("Count adjustment"):
        raise ApprovalError("Counted cash cannot be reversed. Record a new count instead.")


def can_reverse(txn: Transaction) -> bool:
    try:
        check_reversible(txn)
    except ApprovalError:
        return False
    return True


def _duplicate(db, institution_id, request_id, **expected) -> Approval | None:
    if not request_id:
        return None
    row = db.scalars(
        select(Approval).where(
            Approval.institution_id == institution_id, Approval.request_id == request_id
        )
    ).first()
    if row and any(getattr(row, k) != v for k, v in expected.items()):
        raise ApprovalError("This request id was already used for something else")
    return row


def request_spend(db: Session, *, fund: Fund, amount, purpose: PurposeCode,
                  description: str, user: User, request_id: str | None) -> Approval:
    amount = ledger.money(amount)
    if amount <= 0:
        raise ApprovalError("Amount is too small")
    ledger.lock_books(db, fund.institution_id)
    again = _duplicate(
        db, fund.institution_id, request_id, kind="spend", fund_id=fund.id, amount=amount,
        purpose=purpose.value, description=description, requested_by=user.id,
    )
    if again:
        return again
    verdict = ledger.check_spend(fund, purpose)
    if not verdict:
        raise FundRuleViolation(verdict)
    balance = ledger.fund_balance(db, fund.id)
    if balance < amount:
        raise InsufficientBalance(fund, balance)
    row = Approval(
        institution_id=fund.institution_id, kind="spend", fund_id=fund.id, amount=amount,
        purpose=purpose.value, description=description, requested_by=user.id,
        request_id=request_id,
    )
    db.add(row)
    db.flush()
    return row


def request_reversal(db: Session, *, txn: Transaction, reason: str, user: User) -> Approval:
    ledger.lock_books(db, txn.institution_id)
    db.refresh(txn)
    check_reversible(txn)
    if db.scalars(
        select(Approval).where(Approval.target_id == txn.id, Approval.status == "pending")
    ).first():
        raise ApprovalError("A reversal of this entry is already waiting")
    row = Approval(
        institution_id=txn.institution_id, kind="reversal", target_id=txn.id,
        amount=sum(e.amount for e in txn.entries if e.side.value == "credit"),
        description=reason, requested_by=user.id,
    )
    db.add(row)
    db.flush()
    return row


def decide(db: Session, row: Approval, *, user: User, action: str, note: str | None,
           cash_fund_id: str) -> Approval:
    """approve, reject or cancel. Raises and changes nothing if not permitted."""
    ledger.lock_books(db, row.institution_id)
    db.refresh(row)
    if row.status != "pending":
        raise ApprovalError(f"This request is already {row.status}")
    if action == "cancel":
        if row.requested_by != user.id:
            raise NotYours("Only the person who asked can cancel")
    elif row.requested_by == user.id:
        raise NotYours("A different person must decide this request")

    requester = db.get(User, row.requested_by)
    if action == "approve":
        if not requester.active:
            raise ApprovalError("The person who asked no longer has access. Reject this request.")
        # The names go into the sealed description, so they are tamper-evident.
        signed = f"{row.description} (requested by {requester.name}, approved by {user.name})"
        if row.kind == "spend":
            txn = ledger.record_disbursement(
                db, institution_id=row.institution_id, fund_id=row.fund_id,
                cash_fund_id=cash_fund_id, amount=row.amount,
                purpose=PurposeCode(row.purpose), description=signed,
                recorded_by=row.requested_by,
            )
        else:
            target = db.get(Transaction, row.target_id)
            db.refresh(target)
            check_reversible(target)
            txn = ledger.reverse(db, txn=target, reason=signed, recorded_by=row.requested_by)
        row.result_id = txn.id
    row.status = {"approve": "approved", "reject": "rejected", "cancel": "cancelled"}[action]
    row.decided_by, row.decision_note = user.id, note
    row.decided_at = datetime.now(timezone.utc)
    db.flush()
    return row


__all__ = ["ApprovalError", "NotYours", "LedgerError", "decide", "request_reversal", "request_spend"]
