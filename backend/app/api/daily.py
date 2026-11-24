"""Approvals, receipts and people. Included by app.main, which must load first."""

from __future__ import annotations

import secrets
from datetime import datetime
from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app import main as core
from app.core import auth, throttle
from app.core.auth import assert_same_institution, require_roles
from app.core.fiqh import PurposeCode
from app.models import (
    Approval,
    AuditLog,
    Fund,
    Institution,
    PushToken,
    Receipt,
    Role,
    Transaction,
    User,
)
from app.services import approvals, push

router = APIRouter()


def admin_only(user: User = Depends(core.current_user)) -> User:
    return require_roles(Role.ADMIN)(user)


def approver(user: User = Depends(core.current_user)) -> User:
    return require_roles(Role.ADMIN, Role.COMMITTEE)(user)


def may_see_donors(user: User = Depends(core.current_user)) -> User:
    return require_roles(Role.ADMIN, Role.TREASURER, Role.AUDITOR)(user)


def may_see_people(user: User = Depends(core.current_user)) -> User:
    return require_roles(Role.ADMIN, Role.AUDITOR)(user)


def _inst(db: Session, slug: str, user: User) -> Institution:
    inst = core.get_institution(db, slug)
    assert_same_institution(user, inst)
    return inst


def _txn(db: Session, inst: Institution, reference: str) -> Transaction:
    txn = db.scalars(
        select(Transaction).where(
            Transaction.institution_id == inst.id, Transaction.reference == reference
        )
    ).first()
    if txn is None:
        raise HTTPException(404, "No such transaction")
    return txn


def _name(db: Session, user_id: str | None) -> str | None:
    user = db.get(User, user_id) if user_id else None
    return user.name if user else None


def _guard(db: Session, action):
    """Run something that may be refused, and turn refusals into answers."""
    try:
        result = action()
    except approvals.NotYours as exc:
        db.rollback()
        raise HTTPException(403, str(exc))
    except (approvals.FundRuleViolation, approvals.InsufficientBalance) as exc:
        error = core.spend_refusal(exc)
        db.rollback()
        raise error
    except (approvals.ApprovalError, approvals.LedgerError) as exc:
        db.rollback()
        raise HTTPException(409, str(exc))
    db.commit()
    return result


# --------------------------------------------------------------- approvals


class SpendRequestIn(BaseModel):
    fund_code: str
    amount: Decimal = Field(gt=0, lt=Decimal("1e12"))
    purpose: PurposeCode
    description: str = Field(min_length=3, max_length=500)
    request_id: str | None = Field(default=None, min_length=8, max_length=64)


class ReversalIn(BaseModel):
    reason: str = Field(min_length=5, max_length=500)


class DecisionIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str | None = Field(default=None, max_length=500)


def _approval_out(db: Session, a: Approval, user: User) -> dict:
    fund = db.get(Fund, a.fund_id) if a.fund_id else None
    target = db.get(Transaction, a.target_id) if a.target_id else None
    result = db.get(Transaction, a.result_id) if a.result_id else None
    pending = a.status == "pending"
    mine = a.requested_by == user.id
    return {
        "id": a.id,
        "kind": a.kind,
        "status": a.status,
        "amount": str(a.amount),
        "fund_code": fund.code if fund else None,
        "purpose": a.purpose,
        "description": a.description,
        "target_reference": target.reference if target else None,
        "result_reference": result.reference if result else None,
        "requested_by": _name(db, a.requested_by),
        "requested_at": a.requested_at,
        "decided_by": _name(db, a.decided_by),
        "decided_at": a.decided_at,
        "decision_note": a.decision_note,
        "can_decide": pending and not mine and user.role in (Role.ADMIN, Role.COMMITTEE),
        "can_cancel": pending and mine,
    }


def _tell(background: BackgroundTasks, db: Session, row: Approval) -> None:
    background.add_task(push.start, core.SessionLocal, push.for_approval(db, row))


@router.get("/i/{slug}/approvals")
def list_approvals(
    slug: str,
    status: Literal["pending", "approved", "rejected", "cancelled"] | None = None,
    db: Session = Depends(core.get_db),
    user: User = Depends(core.current_user),
):
    inst = _inst(db, slug, user)
    q = select(Approval).where(Approval.institution_id == inst.id)
    if status:
        q = q.where(Approval.status == status)
    rows = db.scalars(q.order_by(Approval.requested_at.desc()).limit(100)).all()
    return [_approval_out(db, a, user) for a in rows]


@router.post("/i/{slug}/approvals", status_code=201)
def request_spend(
    slug: str,
    body: SpendRequestIn,
    background: BackgroundTasks,
    db: Session = Depends(core.get_db),
    user: User = Depends(core.treasurer_or_admin),
):
    inst = _inst(db, slug, user)
    fund = core.get_fund(db, inst, body.fund_code)
    # A phone that lost the answer asks again. Nobody should be told twice.
    sent_before = body.request_id and db.scalars(
        select(Approval.id).where(
            Approval.institution_id == inst.id, Approval.request_id == body.request_id
        )
    ).first()
    row = _guard(
        db,
        lambda: approvals.request_spend(
            db, fund=fund, amount=body.amount, purpose=body.purpose,
            description=body.description, user=user, request_id=body.request_id,
        ),
    )
    if not sent_before:
        _tell(background, db, row)
    return _approval_out(db, row, user)


@router.post("/i/{slug}/transactions/{reference}/reversal", status_code=201)
def request_reversal(
    slug: str,
    reference: str,
    body: ReversalIn,
    background: BackgroundTasks,
    db: Session = Depends(core.get_db),
    user: User = Depends(core.treasurer_or_admin),
):
    inst = _inst(db, slug, user)
    txn = _txn(db, inst, reference)
    row = _guard(
        db, lambda: approvals.request_reversal(db, txn=txn, reason=body.reason, user=user)
    )
    _tell(background, db, row)
    return _approval_out(db, row, user)


def _decide(db, background, slug, approval_id, user, action, note):
    inst = _inst(db, slug, user)
    row = db.get(Approval, approval_id)
    if row is None or row.institution_id != inst.id:
        raise HTTPException(404, "No such request")
    cash = core.cash_fund(db, inst)
    _guard(
        db,
        lambda: approvals.decide(
            db, row, user=user, action=action, note=note, cash_fund_id=cash.id
        ),
    )
    _tell(background, db, row)
    return _approval_out(db, row, user)


@router.post("/i/{slug}/approvals/{approval_id}/decision")
def decide(
    slug: str,
    approval_id: str,
    body: DecisionIn,
    background: BackgroundTasks,
    db: Session = Depends(core.get_db),
    user: User = Depends(approver),
):
    return _decide(db, background, slug, approval_id, user, body.action, body.note)


@router.post("/i/{slug}/approvals/{approval_id}/cancel")
def cancel(
    slug: str,
    approval_id: str,
    background: BackgroundTasks,
    db: Session = Depends(core.get_db),
    user: User = Depends(core.current_user),
):
    return _decide(db, background, slug, approval_id, user, "cancel", None)


# ---------------------------------------------------------------- receipts


@router.get("/i/{slug}/transactions/{reference}/receipt")
def receipt(
    slug: str,
    reference: str,
    db: Session = Depends(core.get_db),
    user: User = Depends(may_see_donors),
):
    inst = _inst(db, slug, user)
    txn = _txn(db, inst, reference)
    r = db.scalars(select(Receipt).where(Receipt.transaction_id == txn.id)).first()
    if r is None:
        raise HTTPException(404, "This entry has no receipt")
    fund = next(
        db.get(Fund, e.fund_id) for e in txn.entries if e.side.value == "credit"
    )
    return {
        "number": r.number,
        "institution": inst.name,
        "reference": txn.reference,
        "donor_name": r.donor_name,
        "amount": str(core._txn_amount(txn)),
        "fund_ms": fund.label_ms,
        "fund_en": fund.label_en,
        "description": txn.description,
        "issued_by": _name(db, r.issued_by),
        "issued_at": r.issued_at,
        # A cancelled receipt must never look like a good one.
        "valid": txn.status.value == "confirmed",
    }


# ------------------------------------------------------------------ people


class UserIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=200, pattern=r"^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$")
    role: Role

    @field_validator("email")
    @classmethod
    def lower(cls, v: str) -> str:
        return v.strip().lower()


class UserPatch(BaseModel):
    role: Role | None = None
    active: bool | None = None


def _user_out(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": u.role.value,
        "active": u.active,
        "must_change_password": u.must_change_password,
    }


def _log(db: Session, actor: User, action: str, detail: str) -> None:
    db.add(
        AuditLog(
            institution_id=actor.institution_id, actor_id=actor.id,
            action=action, detail=detail,
        )
    )


def _member(db: Session, inst: Institution, user_id: str, actor: User) -> User:
    # Same lock as money, so two admins cannot remove each other at once.
    core.ledger.lock_books(db, inst.id)
    db.refresh(actor)
    if not actor.active or actor.role is not Role.ADMIN:
        raise HTTPException(403, "You no longer have permission to do this")
    target = db.get(User, user_id)
    if target is None or target.institution_id != inst.id:
        raise HTTPException(404, "No such person")
    db.refresh(target)
    if target.id == actor.id:
        raise HTTPException(409, "Ask another admin to change your own account")
    return target


def _sign_out_everywhere(db: Session, target: User) -> None:
    target.token_version += 1
    db.execute(delete(PushToken).where(PushToken.user_id == target.id))


@router.get("/i/{slug}/users")
def list_users(
    slug: str, db: Session = Depends(core.get_db), user: User = Depends(may_see_people)
):
    inst = _inst(db, slug, user)
    rows = db.scalars(
        select(User).where(User.institution_id == inst.id).order_by(User.name)
    ).all()
    return [_user_out(u) for u in rows]


@router.post("/i/{slug}/users", status_code=201)
def add_user(
    slug: str,
    body: UserIn,
    db: Session = Depends(core.get_db),
    user: User = Depends(admin_only),
):
    """Returns a temporary password once. It must be changed at first sign in."""
    inst = _inst(db, slug, user)
    core.ledger.lock_books(db, inst.id)
    if db.scalars(select(User).where(func.lower(User.email) == body.email)).first():
        raise HTTPException(409, "That email is already used")
    password = secrets.token_urlsafe(12)
    row = User(
        institution_id=inst.id, name=body.name.strip(), email=body.email, role=body.role,
        password_hash=auth.hash_password(password), must_change_password=True,
    )
    db.add(row)
    _log(db, user, "user_added", f"{row.name} <{row.email}> as {row.role.value}")
    db.commit()
    return {**_user_out(row), "temporary_password": password}


@router.patch("/i/{slug}/users/{user_id}")
def change_user(
    slug: str,
    user_id: str,
    body: UserPatch,
    db: Session = Depends(core.get_db),
    user: User = Depends(admin_only),
):
    inst = _inst(db, slug, user)
    target = _member(db, inst, user_id, user)
    changes = []
    if body.role is not None and body.role is not target.role:
        changes.append(f"role {target.role.value} to {body.role.value}")
        target.role = body.role
    if body.active is not None and body.active != target.active:
        changes.append("access restored" if body.active else "access removed")
        target.active = body.active
        if not body.active:
            _sign_out_everywhere(db, target)
    if changes:
        _log(db, user, "user_changed", f"{target.name}: {', '.join(changes)}")
    db.commit()
    return _user_out(target)


@router.post("/i/{slug}/users/{user_id}/reset-password")
def reset_password(
    slug: str,
    user_id: str,
    db: Session = Depends(core.get_db),
    user: User = Depends(admin_only),
):
    inst = _inst(db, slug, user)
    target = _member(db, inst, user_id, user)
    password = secrets.token_urlsafe(12)
    target.password_hash = auth.hash_password(password)
    target.must_change_password = True
    _sign_out_everywhere(db, target)
    _log(db, user, "password_reset", target.name)
    db.commit()
    throttle.succeeded(target.email or target.id)
    return {"temporary_password": password}


class AuditOut(BaseModel):
    actor: str | None
    action: str
    detail: str
    created_at: datetime


@router.get("/i/{slug}/audit", response_model=list[AuditOut])
def audit(
    slug: str, db: Session = Depends(core.get_db), user: User = Depends(may_see_people)
):
    inst = _inst(db, slug, user)
    rows = db.scalars(
        select(AuditLog)
        .where(AuditLog.institution_id == inst.id)
        .order_by(AuditLog.created_at.desc())
        .limit(200)
    ).all()
    return [
        AuditOut(
            actor=_name(db, r.actor_id), action=r.action, detail=r.detail,
            created_at=r.created_at,
        )
        for r in rows
    ]
