"""Figures, forecasts and unusual activity, worked out from the ledger.

Plain arithmetic, no AI and no outside service. Everything here only reads.

Three rules keep the numbers honest:

  * Each movement is counted once, from the fund's side. Cash is where the
    money is, not whose it is.
  * A reversed entry and its reversal are both left out, and so is anything a
    person has not confirmed.
  * Days and weeks are Malaysian. A donation at 1 am on Friday is Friday's.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from statistics import median

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.fiqh import FundCategory
from app.models import (
    Approval,
    Entry,
    EntrySide,
    Fund,
    Institution,
    Transaction,
    TxnStatus,
)
from app.services import ledger
from app.services.telemetry import aware

# Malaysia has one zone and no daylight saving
MYT = timezone(timedelta(hours=8))

MIN_WEEKS = 4
INCOME_WEEKS = 8
SPEND_WEEKS = 12
ZERO = Decimal("0.00")
COUNT_PREFIX = "Witnessed count"


def today() -> date:
    return datetime.now(MYT).date()


def local_day(when: datetime) -> date:
    return aware(when).astimezone(MYT).date()


def _round(value) -> Decimal:
    return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class Move:
    day: date
    fund_id: str
    category: FundCategory
    # Money in, less corrections to it. Zero for spending.
    income: Decimal
    # Money out for a purpose. Zero for income.
    spend: Decimal
    purpose: str | None
    reference: str
    description: str

    @property
    def is_count(self) -> bool:
        return self.description.startswith(COUNT_PREFIX)


def moves(db: Session, inst: Institution) -> list[Move]:
    rows = db.execute(
        select(
            Transaction.occurred_at,
            Transaction.purpose,
            Transaction.reference,
            Transaction.description,
            Entry.side,
            Entry.amount,
            Fund,
        )
        .join(Entry, Entry.transaction_id == Transaction.id)
        .join(Fund, Entry.fund_id == Fund.id)
        .where(
            Transaction.institution_id == inst.id,
            Transaction.status == TxnStatus.CONFIRMED,
            Transaction.reverses_id.is_(None),
        )
        .order_by(Transaction.seq)
    ).all()
    out = []
    for when, purpose, reference, description, side, amount, fund in rows:
        if ledger.is_cash(fund):
            continue
        amount = ledger.money(amount)
        income = spend = ZERO
        if side is EntrySide.CREDIT:
            income = amount
        elif purpose is not None:
            spend = amount
        else:  # an old count that came in short
            income = -amount
        out.append(
            Move(
                day=local_day(when),
                fund_id=fund.id,
                category=fund.category,
                income=income,
                spend=spend,
                purpose=purpose.value if purpose else None,
                reference=reference,
                description=description,
            )
        )
    return out


def within(rows: list[Move], start: date, end: date, fund_id: str | None = None) -> list[Move]:
    """Both days included."""
    return [
        m for m in rows
        if start <= m.day <= end and (fund_id is None or m.fund_id == fund_id)
    ]


def income(rows: list[Move]) -> Decimal:
    return sum((m.income for m in rows), ZERO)


def spend(rows: list[Move]) -> Decimal:
    return sum((m.spend for m in rows), ZERO)


def _weeks(rows: list[Move], now: date, first: date, limit: int) -> list[list[Move]]:
    """Whole seven-day blocks ending yesterday, newest first."""
    out = []
    end = now - timedelta(days=1)
    while len(out) < limit and end - timedelta(days=6) >= first:
        out.append(within(rows, end - timedelta(days=6), end))
        end -= timedelta(days=7)
    return out


def _quartiles(values: list[Decimal]) -> tuple[Decimal, Decimal]:
    v = sorted(values)
    half = len(v) // 2
    return _round(median(v[:half])), _round(median(v[-half:]))


# ---------------------------------------------------------------- forecasts


@dataclass
class Forecast:
    weeks: int
    enough: bool
    expected: Decimal = ZERO
    low: Decimal = ZERO
    high: Decimal = ZERO
    friday: Decimal = ZERO
    # How far the same method missed on past weeks, in ringgit
    usual_miss: Decimal | None = None
    tested_weeks: int = 0


def forecast_income(rows: list[Move], now: date, fund_id: str | None = None) -> Forecast:
    """The next seven days, from recent weeks.

    The median is used because one large gift should not raise every later
    forecast. A permanent endowment is not regular income, so it is left out
    unless its own fund is asked about.
    """
    if not rows:
        return Forecast(weeks=0, enough=False)
    # History starts with the mosque's first entry, not the fund's, so quiet
    # weeks before a fund's first gift still count as quiet.
    first = min(m.day for m in rows)
    chosen = [
        m for m in rows
        if (m.fund_id == fund_id if fund_id else m.category is not FundCategory.WAQF_PRINCIPAL)
    ]
    every = _weeks(chosen, now, first, 52)
    totals = [income(w) for w in every]
    recent = totals[:INCOME_WEEKS]
    if len(recent) < MIN_WEEKS:
        return Forecast(weeks=len(recent), enough=False)
    low, high = _quartiles(recent)
    fridays = [
        income([m for m in w if m.day.weekday() == 4]) for w in every[:INCOME_WEEKS]
    ]
    misses = [
        abs(totals[i] - median(totals[i + 1 : i + 1 + INCOME_WEEKS]))
        for i in range(len(totals))
        if len(totals) - (i + 1) >= MIN_WEEKS
    ][:INCOME_WEEKS]
    return Forecast(
        weeks=len(recent),
        enough=True,
        expected=_round(median(recent)),
        low=low,
        high=high,
        friday=_round(median(fridays)),
        usual_miss=_round(sum(misses, ZERO) / len(misses)) if len(misses) >= MIN_WEEKS else None,
        tested_weeks=len(misses) if len(misses) >= MIN_WEEKS else 0,
    )


@dataclass
class Runway:
    weeks: int
    enough: bool
    weekly: Decimal = ZERO
    # How many weeks the balance lasts with no new money. None: not spending.
    lasts: int | None = None


def runway(rows: list[Move], now: date, fund_id: str, balance: Decimal) -> Runway:
    """One fund at a time: zakat cannot cover a shortage anywhere else."""
    if not rows:
        return Runway(weeks=0, enough=False)
    weeks = _weeks(
        [m for m in rows if m.fund_id == fund_id], now, min(m.day for m in rows), SPEND_WEEKS
    )
    if len(weeks) < MIN_WEEKS:
        return Runway(weeks=len(weeks), enough=False)
    weekly = _round(sum((spend(w) for w in weeks), ZERO) / len(weeks))
    return Runway(
        weeks=len(weeks),
        enough=True,
        weekly=weekly,
        lasts=int(max(balance, ZERO) / weekly) if weekly > 0 else None,
    )


# --------------------------------------------------------- unusual activity


@dataclass
class Warning:
    """Something worth a look. Never an accusation."""

    kind: str
    ms: str
    en: str
    href: str


def rm(value) -> str:
    return f"RM {value:,.2f}"


def _low_counts(rows, names, now):
    counts = [m for m in rows if m.is_count and m.income > 0]
    for m in counts:
        if (now - m.day).days > 14:
            continue
        before = [
            p.income for p in counts
            if p.fund_id == m.fund_id and p.day < m.day and p.day.weekday() == m.day.weekday()
        ][-INCOME_WEEKS:]
        if len(before) < MIN_WEEKS:
            continue
        usual = _round(median(before))
        if m.income * 2 < usual:
            ms, en = names[m.fund_id]
            yield Warning(
                "count_low",
                f"Kiraan {m.reference} ({ms}) ialah {rm(m.income)}. Kebiasaannya pada hari yang "
                f"sama sekitar {rm(usual)}. Mungkin ada sebab biasa; semak bersama saksi.",
                f"Count {m.reference} ({en}) was {rm(m.income)}. The usual for that weekday is "
                f"about {rm(usual)}. There may be an ordinary reason; check with the witnesses.",
                f"/proof/{m.reference}",
            )


def _high_spends(rows, now):
    spends = [m for m in rows if m.spend > 0]
    for m in spends:
        if (now - m.day).days > 14:
            continue
        before = [p.spend for p in spends if p.purpose == m.purpose and p.day < m.day][-12:]
        if len(before) < MIN_WEEKS:
            continue
        usual = _round(median(before))
        if m.spend > usual * 2 and m.spend - usual >= 50:
            yield Warning(
                "spend_high",
                f"Perbelanjaan {m.reference} ialah {rm(m.spend)}. Kebiasaannya untuk tujuan yang "
                f"sama sekitar {rm(usual)}. Semak resit jika perlu.",
                f"Spending {m.reference} was {rm(m.spend)}. The usual for that purpose is about "
                f"{rm(usual)}. Check the bill if needed.",
                f"/proof/{m.reference}",
            )


def _look_alikes(rows, now):
    groups: dict[tuple, list[Move]] = {}
    for m in rows:
        if (now - m.day).days <= 14:
            key = (m.day, m.fund_id, m.income, m.spend, m.purpose, m.description.strip().lower())
            groups.setdefault(key, []).append(m)
    for same in groups.values():
        if len(same) < 2:
            continue
        refs = ", ".join(m.reference for m in same[:4])
        amount = rm(same[0].income or same[0].spend)
        yield Warning(
            "look_alike",
            f"{len(same)} entri serupa pada hari yang sama ({amount}): {refs}. Pastikan bukan "
            "direkod dua kali.",
            f"{len(same)} matching entries on the same day ({amount}): {refs}. Make sure none "
            "was recorded twice.",
            f"/proof/{same[0].reference}",
        )


def warnings(db: Session, inst: Institution, rows: list[Move], now: date) -> list[Warning]:
    funds = [
        f for f in db.scalars(
            select(Fund).where(Fund.institution_id == inst.id, Fund.active.is_(True))
        )
        if not ledger.is_cash(f)
    ]
    names = {f.id: (f.label_ms, f.label_en) for f in db.scalars(
        select(Fund).where(Fund.institution_id == inst.id))}
    out: list[Warning] = []

    if not ledger.verify(db, inst.id).intact:
        out.append(Warning(
            "chain_broken",
            "Meterai lejar terputus. Jangan ubah apa-apa; maklumkan juruaudit.",
            "The ledger seal is broken. Change nothing and tell the auditor.",
            "/ledger",
        ))

    out += _low_counts(rows, names, now)
    out += _high_spends(rows, now)
    out += _look_alikes(rows, now)

    for a in db.scalars(
        select(Approval)
        .where(Approval.institution_id == inst.id, Approval.status == "pending")
        .order_by(Approval.requested_at)
    ):
        days = (now - local_day(a.requested_at)).days
        if days > 3:
            out.append(Warning(
                "approval_waiting",
                f"Permintaan {rm(a.amount)} sudah menunggu kelulusan {days} hari.",
                f"A request for {rm(a.amount)} has waited {days} days for approval.",
                "/approvals",
            ))

    since = datetime.combine(now - timedelta(days=30), datetime.min.time(), MYT)
    reversed_lately = db.scalar(
        select(func.count()).select_from(Transaction).where(
            Transaction.institution_id == inst.id,
            Transaction.reverses_id.is_not(None),
            Transaction.recorded_at >= since.astimezone(timezone.utc),
        )
    )
    if reversed_lately >= 3:
        out.append(Warning(
            "many_reversals",
            f"{reversed_lately} entri dibatalkan dalam 30 hari. Mungkin borang perlu diterangkan semula.",
            f"{reversed_lately} entries were reversed in 30 days. The forms may need explaining again.",
            "/ledger",
        ))

    for f in funds:
        r = runway(rows, now, f.id, ledger.fund_balance(db, f.id))
        if r.enough and r.lasts is not None and r.lasts < 4:
            out.append(Warning(
                "fund_low",
                f"{f.label_ms}: baki cukup kira-kira {r.lasts} minggu pada purata belanja "
                f"{rm(r.weekly)} seminggu, jika tiada wang baharu.",
                f"{f.label_en}: the balance lasts about {r.lasts} weeks at an average of "
                f"{rm(r.weekly)} a week, if no new money comes in.",
                f"/spend?fund={f.code}",
            ))

    counted = [m.day for m in rows if m.is_count]
    if counted and (now - max(counted)).days > 14:
        days = (now - max(counted)).days
        out.append(Warning(
            "count_overdue",
            f"Kiraan tabung terakhir {days} hari lalu.",
            f"The last box count was {days} days ago.",
            "/count",
        ))
    return out
