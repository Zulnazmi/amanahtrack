"""Pembantu Amanah: answers questions from this mosque's own records.

Read only. It never posts, approves or changes anything; for that it opens the
normal form, where the person checks and confirms as usual. It never mentions
donors, and it gives no rulings beyond the fund rules already built in.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import main as core
from app.core.auth import assert_same_institution
from app.core.fiqh import ASNAF_PURPOSES, PurposeCode, rule_for
from app.models import Approval, Device, Fund, Institution, Role, User
from app.services import alerts as alert_service
from app.services import insights, language, ledger, telemetry
from app.services.insights import rm

router = APIRouter()

WRITERS = (Role.ADMIN, Role.TREASURER)

PURPOSE_NAMES: dict[PurposeCode, tuple[str, str]] = {
    PurposeCode.ASNAF_FAKIR: ("asnaf fakir", "the destitute (fakir)"),
    PurposeCode.ASNAF_MISKIN: ("asnaf miskin", "the poor (miskin)"),
    PurposeCode.ASNAF_AMIL: ("amil", "zakat administrators (amil)"),
    PurposeCode.ASNAF_MUALLAF: ("muallaf", "new Muslims (muallaf)"),
    PurposeCode.ASNAF_RIQAB: ("riqab", "freeing from bondage (riqab)"),
    PurposeCode.ASNAF_GHARIMIN: ("gharimin", "debtors (gharimin)"),
    PurposeCode.ASNAF_FISABILILLAH: ("fisabilillah", "the cause of Allah (fisabilillah)"),
    PurposeCode.ASNAF_IBNUSSABIL: ("ibnu sabil", "stranded travellers (ibnu sabil)"),
    PurposeCode.MOSQUE_MAINTENANCE: ("penyelenggaraan masjid", "mosque maintenance"),
    PurposeCode.UTILITIES: ("bil utiliti", "utility bills"),
    PurposeCode.STAFF_SALARY: ("gaji petugas", "staff salaries"),
    PurposeCode.EDUCATION: ("pendidikan", "education"),
    PurposeCode.ORPHAN_WELFARE: ("kebajikan anak yatim", "orphan welfare"),
    PurposeCode.FUNERAL_SUPPORT: ("urusan jenazah", "funeral support"),
    PurposeCode.RAMADAN_PROGRAMME: ("program Ramadan", "Ramadan programmes"),
    PurposeCode.CAPITAL_PROJECT: ("pembinaan", "building projects"),
    PurposeCode.ADMIN_COST: ("kos pentadbiran", "administration"),
}

HOWTO: dict[str, tuple[str, str, str]] = {
    "donate": (
        "Buka Rekod derma, pilih dana, masukkan jumlah dan simpan. Resit dibuat terus. "
        "Bendahari atau admin sahaja.",
        "Open Record donation, choose the fund, enter the amount and save. A receipt is made at "
        "once. Treasurer or admin only.", "/donate"),
    "spend": (
        "Buka Belanja, pilih dana dan tujuan, kemudian jumlah. Jika peraturan dana tidak "
        "membenarkan, aplikasi akan beritahu. Perbelanjaan mungkin perlu kelulusan orang kedua.",
        "Open Spend, choose the fund and purpose, then the amount. The app says so if the fund's "
        "rules do not allow it. A second person may need to approve.", "/spend"),
    "count": (
        "Kira wang bersama sekurang-kurangnya dua saksi, kemudian buka Kira tabung dan masukkan "
        "jumlah serta nama saksi.",
        "Count the cash with at least two witnesses, then open Box count and enter the total and "
        "their names.", "/count"),
    "reverse": (
        "Entri tidak boleh dipadam. Buka lejar, pilih entri itu dan minta pembetulan; orang lain "
        "perlu meluluskannya.",
        "Entries are never deleted. Open the ledger, choose the entry and ask for a reversal; "
        "someone else must approve it.", "/ledger"),
    "approve": (
        "Buka Kelulusan. Admin atau AJK boleh meluluskan, tetapi bukan permintaan sendiri.",
        "Open Approvals. An admin or committee member can approve, but never their own request.",
        "/approvals"),
    "receipt": (
        "Buka lejar, pilih derma itu, kemudian buka resitnya untuk dikongsi.",
        "Open the ledger, choose the donation, then open its receipt to share it.", "/ledger"),
    "password": (
        "Buka Kata laluan untuk menukar kata laluan anda. Jika terlupa, minta admin menetapkan "
        "semula.",
        "Open Password to change yours. If you forgot it, ask an admin to reset it.", "/password"),
    "people": (
        "Admin boleh menambah atau menyekat pengguna di skrin Pengguna.",
        "An admin can add or block people on the People screen.", "/people"),
    "alert": (
        "Buka Alerts untuk melihat foto dan menyemaknya. Bendahari tidak boleh menutup amaran.",
        "Open Alerts to see the photos and review them. The treasurer cannot close alerts.",
        "/alerts"),
    "verify": (
        "Buka lejar dan pilih mana-mana entri untuk melihat bukti meterainya.",
        "Open the ledger and choose any entry to see its seal proof.", "/ledger"),
}

SUGGEST = {
    "ms": ["Ringkasan hari ini", "Baki setiap dana", "Derma minggu ini", "Ramalan minggu depan",
           "Ada apa-apa luar biasa?", "Boleh guna zakat untuk bumbung?"],
    "en": ["Today's summary", "Balance of each fund", "Donations this week",
           "Forecast for next week", "Anything unusual?", "Can we use zakat for the roof?"],
}


class Context(BaseModel):
    """What the last question was about, so "and last month?" works."""

    intent: Literal["income", "spend", "largest", "balance", "forecast", "runway"]
    funds: list[str] = Field(default_factory=list, max_length=20)
    period: str | None = Field(default=None, max_length=20)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=300)
    context: Context | None = None


class Reply:
    """Collects an answer in both languages."""

    def __init__(self):
        self.ms: list[str] = []
        self.en: list[str] = []
        self.rows: list[dict] = []
        self.basis: tuple[str, str] | None = None
        self.links: list[dict] = []

    def say(self, ms: str, en: str):
        self.ms.append(ms)
        self.en.append(en)

    def row(self, ms: str, en: str, value: str):
        self.rows.append({"label_ms": ms, "label_en": en, "value": value})

    def link(self, ms: str, en: str, href: str):
        if all(x["href"] != href for x in self.links):
            self.links.append({"label_ms": ms, "label_en": en, "href": href})


class Desk:
    """One mosque's records, loaded once per question."""

    def __init__(self, db: Session, inst: Institution, user: User):
        self.db, self.inst, self.user = db, inst, user
        self.now = insights.today()
        self.funds = [
            f for f in db.scalars(
                select(Fund)
                .where(Fund.institution_id == inst.id, Fund.active.is_(True))
                .order_by(Fund.created_at, Fund.code)
            )
            if not ledger.is_cash(f)
        ]
        self.by_code = {f.code: f for f in self.funds}
        self._moves = None

    @property
    def moves(self):
        if self._moves is None:
            self._moves = insights.moves(self.db, self.inst)
        return self._moves

    def chosen(self, codes: list[str]) -> list[Fund]:
        return [self.by_code[c] for c in codes if c in self.by_code]


# ------------------------------------------------------------------ answers


def _balance(d: Desk, q, r: Reply):
    chosen = d.chosen(q.funds) or d.funds
    for f in chosen:
        r.row(f.label_ms, f.label_en, rm(ledger.fund_balance(d.db, f.id)))
    if q.period and q.period.key != "today":
        r.say("Ini baki sekarang; saya belum boleh mengira baki pada tarikh lepas.",
              "These are the balances now; I cannot work out past balances yet.")
    elif len(chosen) == 1:
        f = chosen[0]
        r.say(f"Baki {f.label_ms} ialah {r.rows[0]['value']}.",
              f"{f.label_en} holds {r.rows[0]['value']}.")
    else:
        r.say("Baki setiap dana sekarang. Setiap dana ada peraturan sendiri.",
              "The balance of each fund now. Each fund has its own rules.")
    r.basis = ("Dikira terus daripada lejar.", "Worked out directly from the ledger.")


def _totals(d: Desk, q, r: Reply):
    p = q.period or language.named_period("this_month", d.now)
    kind = insights.spend if q.intent == "spend" else insights.income
    word = ("Perbelanjaan", "Spending") if q.intent == "spend" else ("Derma masuk", "Donations in")
    chosen = d.chosen(q.funds) or d.funds
    rows = insights.within(d.moves, p.start, p.end)
    if q.intent == "spend" and q.purpose:
        rows = [m for m in rows if m.purpose == q.purpose.value]
        ms, en = PURPOSE_NAMES[q.purpose]
        word = (f"Perbelanjaan untuk {ms}", f"Spending on {en}")
    for f in chosen:
        total = kind([m for m in rows if m.fund_id == f.id])
        if total or len(chosen) <= 2:
            r.row(f.label_ms, f.label_en, rm(total))
    ids = {f.id for f in chosen}
    total = kind([m for m in rows if m.fund_id in ids])
    count = len([m for m in rows if m.fund_id in ids and kind([m]) != 0])
    name = (f" ({chosen[0].label_ms})", f" ({chosen[0].label_en})") if len(chosen) == 1 else ("", "")
    r.say(f"{word[0]}{name[0]} {p.ms}: {rm(total)} daripada {count} entri.",
          f"{word[1]}{name[1]} {p.en}: {rm(total)} from {count} entries.")
    if len(chosen) == 1:
        r.rows = []
    before = None
    if p.key in ("this_week", "this_month"):
        days = p.end - p.start
        start = p.start - timedelta(days=7) if p.key == "this_week" else (
            p.start - timedelta(days=1)).replace(day=1)
        end = min(start + days, p.start - timedelta(days=1))
        before = kind([m for m in insights.within(d.moves, start, end) if m.fund_id in ids
                       and (not q.purpose or q.intent != "spend" or m.purpose == q.purpose.value)])
        same = ("tempoh sama minggu lepas", "the same days last week") if p.key == "this_week" else (
            "tempoh sama bulan lepas", "the same days last month")
        if before:
            r.say(f"Pada {same[0]}: {rm(before)}.", f"Over {same[1]}: {rm(before)}.")
    r.basis = (
        f"{p.start:%d/%m/%Y} hingga {p.end:%d/%m/%Y}, waktu Malaysia. Entri yang dibatalkan tidak dikira.",
        f"{p.start:%d/%m/%Y} to {p.end:%d/%m/%Y}, Malaysian time. Reversed entries are left out.",
    )
    r.link("Buka lejar", "Open ledger", "/ledger")


def _largest(d: Desk, q, r: Reply):
    p = q.period or language.named_period("this_month", d.now)
    ids = {f.id for f in d.chosen(q.funds) or d.funds}
    names = {f.id: f for f in d.funds}
    out = any(language._has(q.text, w) for w in ("spend", "belanja", "perbelanjaan", "bayaran"))
    kind = (lambda m: m.spend) if out else (lambda m: m.income)
    word = ("perbelanjaan", "spending") if out else ("wang masuk", "money in")
    rows = [m for m in insights.within(d.moves, p.start, p.end) if m.fund_id in ids and kind(m) > 0]
    rows = sorted(rows, key=lambda m: -kind(m))[:5]
    if not rows:
        r.say(f"Tiada {word[0]} {p.ms}.", f"No {word[1]} {p.en}.")
    else:
        r.say(f"Entri {word[0]} terbesar {p.ms}.", f"Largest entries of {word[1]} {p.en}.")
        for m in rows:
            f = names[m.fund_id]
            r.row(f"{m.day:%d/%m} · {f.label_ms} · {m.reference}",
                  f"{m.day:%d/%m} · {f.label_en} · {m.reference}", rm(kind(m)))
    r.basis = ("Nama penderma tidak ditunjukkan.", "Donor names are not shown.")


def _forecast(d: Desk, q, r: Reply):
    if any(language._has(q.text, w) for w in ("bulan depan", "next month")):
        r.say("Saya hanya meramal 7 hari, bukan sebulan.", "I only forecast 7 days, not a month.")
    for f in d.chosen(q.funds) or [None]:
        x = insights.forecast_income(d.moves, d.now, f.id if f else None)
        ms, en = (f.label_ms, f.label_en) if f else ("semua dana", "all funds")
        if not x.enough:
            r.say(
                f"Belum cukup rekod untuk meramal ({x.weeks} minggu penuh; perlu "
                f"{insights.MIN_WEEKS}).",
                f"Not enough records to forecast yet ({x.weeks} full weeks; {insights.MIN_WEEKS} needed).",
            )
            continue
        r.say(
            f"Derma 7 hari akan datang ({ms}): sekitar {rm(x.expected)}, biasanya antara "
            f"{rm(x.low)} dan {rm(x.high)}.",
            f"Donations over the next 7 days ({en}): about {rm(x.expected)}, usually between "
            f"{rm(x.low)} and {rm(x.high)}.",
        )
        if f is None or len(q.funds) == 1:
            r.row("Jumaat biasa", "A usual Friday", rm(x.friday))
            if x.usual_miss is not None:
                r.row(f"Purata tersasar ({x.tested_weeks} minggu lepas)",
                      f"Average miss (past {x.tested_weeks} weeks)", rm(x.usual_miss))
        r.basis = (
            f"Median {x.weeks} minggu penuh terakhir. Modal wakaf tidak dikira melainkan ditanya. "
            "Ramadan dan hari raya tidak diambil kira. Ini anggaran, bukan janji.",
            f"Median of the last {x.weeks} full weeks. Waqf principal is left out unless asked for. "
            "Ramadan and festivals are not modelled. This is an estimate, not a promise.",
        )


def _runway(d: Desk, q, r: Reply):
    known = False
    for f in d.chosen(q.funds) or [f for f in d.funds if rule_for(f.category).spendable]:
        if not rule_for(f.category).spendable:
            r.say(f"{f.label_ms} tidak boleh dibelanjakan.", f"{f.label_en} cannot be spent.")
            continue
        x = insights.runway(d.moves, d.now, f.id, ledger.fund_balance(d.db, f.id))
        if not x.enough:
            continue
        known = True
        if x.lasts is None:
            r.row(f.label_ms, f.label_en, "—")
        else:
            r.row(f"{f.label_ms} (minggu)", f"{f.label_en} (weeks)",
                  "52+" if x.lasts > 52 else str(x.lasts))
    if known:
        r.say("Anggaran berapa minggu setiap dana bertahan jika tiada wang baharu. "
              "Tanda — bermaksud tiada perbelanjaan baru-baru ini.",
              "About how many weeks each fund lasts with no new money. "
              "A — means no recent spending.")
        r.basis = (
            "Baki dibahagi purata belanja mingguan sehingga 12 minggu. Dana tidak dicampur.",
            "Balance divided by average weekly spending over up to 12 weeks. Funds are never combined.")
    elif not r.ms:
        r.say(f"Belum cukup rekod; perlu {insights.MIN_WEEKS} minggu penuh.",
              f"Not enough records yet; {insights.MIN_WEEKS} full weeks are needed.")


def _warnings(d: Desk, q, r: Reply):
    found = insights.warnings(d.db, d.inst, d.moves, d.now)
    if not found:
        r.say("Tiada apa-apa luar biasa mengikut semakan saya.", "My checks found nothing unusual.")
    for w in found[:8]:
        r.say(w.ms, w.en)
        what = w.href.rsplit("/", 1)[-1] if w.href.startswith("/proof/") else None
        ms, en = (what, what) if what else {
            "/approvals": ("Kelulusan", "Approvals"), "/count": ("Kira tabung", "Box count"),
            "/ledger": ("Lejar", "Ledger"),
        }.get(w.href, ("Dana", "Fund"))
        if d.user.role in WRITERS or not w.href.startswith(("/count", "/spend")):
            r.link(f"Semak {ms}", f"Check {en}", w.href)
    if len(found) > 8:
        r.say(f"Dan {len(found) - 8} lagi.", f"And {len(found) - 8} more.")
    r.basis = (
        "Semakan: meterai, kiraan rendah, belanja tinggi, entri berulang, kelulusan lewat, "
        "pembatalan, dana rendah dan kiraan lewat. Sesetengahnya perlu beberapa minggu rekod.",
        "Checks: seal, low counts, high spending, repeated entries, late approvals, reversals, "
        "low funds and overdue counts. Some need several weeks of records.")


def _alerts(d: Desk, q, r: Reply):
    c = alert_service.open_counts(d.db, d.inst.id)
    r.say(f"{c['open']} amaran perlu disemak, {c['critical_open']} kritikal.",
          f"{c['open']} alerts need review, {c['critical_open']} critical.")
    r.link("Buka amaran", "Open alerts", "/alerts")


def _box(d: Desk, q, r: Reply):
    boxes = d.db.scalars(
        select(Device).where(Device.institution_id == d.inst.id, Device.active.is_(True))
    ).all()
    if not boxes:
        r.say("Tiada tabung pintar didaftarkan.", "No smart box is registered.")
    for b in boxes:
        on = telemetry.is_online(b)
        door = {"open": ("pintu terbuka", "door open"),
                "closed": ("pintu tertutup", "door closed")}.get(b.door_state)
        ms = ("dalam talian" if on else "tiada sambungan") + (f", {door[0]}" if door and on else "")
        en = ("online" if on else "not connected") + (f", {door[1]}" if door and on else "")
        r.say(f"{b.label}: {ms}.", f"{b.label}: {en}.")
    r.link("Buka Live", "Open Live", "/live")


def _approvals(d: Desk, q, r: Reply):
    rows = d.db.scalars(
        select(Approval).where(Approval.institution_id == d.inst.id, Approval.status == "pending")
    ).all()
    mine = [a for a in rows if a.requested_by != d.user.id] if d.user.role in (
        Role.ADMIN, Role.COMMITTEE) else []
    if not rows:
        r.say("Tiada permintaan menunggu kelulusan.", "Nothing is waiting for approval.")
    else:
        r.say(f"{len(rows)} permintaan menunggu kelulusan; anda boleh memutuskan {len(mine)}.",
              f"{len(rows)} requests are waiting; you can decide {len(mine)}.")
    r.link("Buka kelulusan", "Open approvals", "/approvals")


def _verify(d: Desk, q, r: Reply):
    v = ledger.verify(d.db, d.inst.id)
    if v.intact:
        r.say(f"Lejar utuh: {v.checked} entri disemak sekarang.",
              f"The ledger is intact: {v.checked} entries checked just now.")
    else:
        r.say("Meterai lejar terputus. Jangan ubah apa-apa; maklumkan juruaudit.",
              "The ledger seal is broken. Change nothing and tell the auditor.")
    r.link("Buka lejar", "Open ledger", "/ledger")


def _last_count(d: Desk, q, r: Reply):
    counts = [m for m in d.moves if m.is_count and m.income > 0]
    if not counts:
        r.say("Belum ada kiraan tabung direkod.", "No box count has been recorded yet.")
    else:
        day = max(m.day for m in counts)
        total = insights.income([m for m in counts if m.day == day])
        r.say(f"Kiraan terakhir pada {day:%d/%m/%Y}: {rm(total)}.",
              f"The last count was on {day:%d/%m/%Y}: {rm(total)}.")
    if d.user.role in WRITERS:
        r.link("Kira tabung", "Box count", "/count")


def _rule(d: Desk, q, r: Reply):
    chosen = d.chosen(q.funds)
    if not chosen:
        ms, en = PURPOSE_NAMES[q.purpose]
        ok = [f for f in d.funds if ledger.check_spend(f, q.purpose)]
        r.say(f"Dana yang dibenarkan untuk {ms}: {', '.join(f.label_ms for f in ok) or 'tiada'}.",
              f"Funds allowed for {en}: {', '.join(f.label_en for f in ok) or 'none'}.")
    for f in chosen:
        rule = rule_for(f.category)
        if q.purpose is None:
            ok = [p for p in PurposeCode if ledger.check_spend(f, p)]
            if not ok:
                r.say(f"{f.label_ms} tidak boleh dibelanjakan.", f"{f.label_en} cannot be spent.")
            elif set(ok) == set(ASNAF_PURPOSES):
                r.say(f"{f.label_ms}: lapan asnaf sahaja.", f"{f.label_en}: the eight asnaf only.")
            else:
                r.say(f"{f.label_ms} boleh untuk: {', '.join(PURPOSE_NAMES[p][0] for p in ok)}.",
                      f"{f.label_en} may pay for: {', '.join(PURPOSE_NAMES[p][1] for p in ok)}.")
            continue
        ms, en = PURPOSE_NAMES[q.purpose]
        verdict = ledger.check_spend(f, q.purpose)
        if verdict:
            r.say(f"Ya. Peraturan aplikasi membenarkan {f.label_ms} untuk {ms}.",
                  f"Yes. The app's rules allow {f.label_en} for {en}.")
        else:
            r.say(f"Tidak. {verdict.message_ms}", f"No. {verdict.message_en}")
            ok = [x for x in d.funds if ledger.check_spend(x, q.purpose)]
            if ok:
                r.say(f"Dana yang dibenarkan: {', '.join(x.label_ms for x in ok)}.",
                      f"Funds that are allowed: {', '.join(x.label_en for x in ok)}.")
        r.basis = (f"Asas peraturan: {rule.basis}.", f"Rule basis: {rule.basis}.")
    note = ("Ini peraturan dalam aplikasi, bukan fatwa. Rujuk pihak berkuasa agama negeri.",
            "This is the app's rule, not a religious ruling. Check with the state religious authority.")
    r.basis = tuple(f"{b} {n}" for b, n in zip(r.basis, note)) if r.basis else note


def _afford(d: Desk, q, r: Reply):
    if q.purpose is None:
        r.say("Cukup untuk apa? Contoh: Cukup tak wang untuk bil elektrik RM500?",
              "Enough for what? For example: Can we afford an electricity bill of RM500?")
        return
    ms, en = PURPOSE_NAMES[q.purpose]
    chosen = d.chosen(q.funds) or d.funds
    ok = [f for f in chosen if ledger.check_spend(f, q.purpose)]
    if not ok:
        r.say(f"Peraturan aplikasi tidak membenarkan dana itu untuk {ms}.",
              f"The app's rules do not allow that for {en}.")
        return
    enough = 0
    for f in ok:
        held = ledger.fund_balance(d.db, f.id)
        enough += q.amount is not None and held >= q.amount
        r.row(f.label_ms, f.label_en, rm(held))
    if q.amount is None:
        r.say(f"Baki dana yang dibenarkan untuk {ms}. Beritahu jumlahnya, contoh RM500.",
              f"Balances of the funds allowed for {en}. Tell me the amount, for example RM500.")
    else:
        r.say(f"{enough} daripada {len(ok)} dana yang dibenarkan untuk {ms} ada sekurang-kurangnya "
              f"{rm(q.amount)}.",
              f"{enough} of the {len(ok)} funds allowed for {en} hold at least {rm(q.amount)}.")
    r.basis = ("Setiap dana dikira berasingan. Permintaan yang menunggu kelulusan tidak ditolak.",
               "Each fund is counted separately. Requests waiting for approval are not taken off.")


def _refuse(d: Desk, q, r: Reply):
    r.say("Saya tidak boleh mengubah, memindah, memadam atau meluluskan apa-apa. Untuk kesilapan, "
          "minta pembetulan dari lejar; orang kedua meluluskannya.",
          "I cannot change, move, delete or approve anything. For a mistake, ask for a reversal "
          "from the ledger; a second person approves it.")
    r.link("Buka lejar", "Open ledger", "/ledger")


def _who(d: Desk, q, r: Reply):
    r.say("Saya tidak menjawab soalan tentang siapa. Buka entri dalam lejar untuk butirannya.",
          "I do not answer questions about who did something. Open the entry in the ledger.")
    r.link("Buka lejar", "Open ledger", "/ledger")


def _form(d: Desk, q, r: Reply):
    if d.user.role not in WRITERS:
        r.say("Hanya bendahari atau admin boleh merekod wang.",
              "Only the treasurer or an admin can record money.")
        return
    path = {"donate_form": "/donate", "spend_form": "/spend", "count_form": "/count"}[q.intent]
    extra = []
    if q.intent != "count_form":
        if len(q.funds) == 1:
            extra.append(f"fund={q.funds[0]}")
        if q.amount:
            extra.append(f"amount={q.amount}")
        if q.intent == "spend_form" and q.purpose:
            extra.append(f"purpose={q.purpose.value}")
    r.say("Saya boleh buka borangnya. Semak dan sahkan sendiri; saya tidak merekod apa-apa.",
          "I can open the form. Check and confirm it yourself; I record nothing.")
    r.link("Buka borang", "Open form", path + ("?" + "&".join(extra) if extra else ""))


def _howto(d: Desk, q, r: Reply):
    if q.howto is None:
        _unsure(d, q, r)
        return
    ms, en, href = HOWTO[q.howto]
    r.say(ms, en)
    allowed = {
        "donate": d.user.role in WRITERS, "spend": d.user.role in WRITERS,
        "count": d.user.role in WRITERS,
        "people": d.user.role in (Role.ADMIN, Role.AUDITOR),
    }
    if allowed.get(q.howto, True):
        r.link("Buka", "Open", href)


def _brief(d: Desk, q, r: Reply):
    day, week = (language.named_period(k, d.now) for k in ("today", "this_week"))
    for p in (day, week):
        rows = insights.within(d.moves, p.start, p.end)
        r.row(f"Masuk {p.ms}", f"In {p.en}", rm(insights.income(rows)))
        r.row(f"Keluar {p.ms}", f"Out {p.en}", rm(insights.spend(rows)))
    _approvals(d, q, r)
    _alerts(d, q, r)
    found = insights.warnings(d.db, d.inst, d.moves, d.now)
    if found:
        r.say(f"{len(found)} perkara elok disemak. Tanya \"Ada apa-apa luar biasa?\"",
              f"{len(found)} things are worth checking. Ask \"Anything unusual?\"")
    else:
        r.say("Tiada apa-apa luar biasa mengikut semakan saya.", "My checks found nothing unusual.")
    x = insights.forecast_income(d.moves, d.now)
    if x.enough:
        r.say(f"Jangkaan derma 7 hari akan datang: sekitar {rm(x.expected)}.",
              f"Expected donations over the next 7 days: about {rm(x.expected)}.")
    r.basis = ("Derma masuk dan keluar ikut hari Malaysia.", "Days are Malaysian.")


def _donors(d: Desk, q, r: Reply):
    r.say("Saya tidak menunjukkan maklumat penderma. Nama hanya ada pada resit, untuk orang "
          "yang dibenarkan.",
          "I do not show donor details. Names are only on receipts, for people allowed to see them.")


def _help(d: Desk, q, r: Reply):
    r.say("Saya Pembantu Amanah. Tanya tentang baki, derma, belanja, ramalan, amaran, kelulusan, "
          "peraturan dana atau cara guna aplikasi.",
          "I am Pembantu Amanah. Ask about balances, donations, spending, forecasts, alerts, "
          "approvals, fund rules or how to use the app.")


def _unsure(d: Desk, q, r: Reply):
    r.say("Maaf, saya tidak faham soalan itu. Cuba salah satu di bawah.",
          "Sorry, I did not understand that. Try one of these.")


def _bad_period(d: Desk, q, r: Reply):
    r.say("Saya tidak faham tarikh itu. Cuba: hari ini, minggu lepas, bulan ini, Mac 2026, atau "
          "tahun ini.",
          "I did not understand that date. Try: today, last week, this month, March 2026, or this year.")


ANSWERS = {
    "balance": _balance, "income": _totals, "spend": _totals, "largest": _largest,
    "forecast": _forecast, "runway": _runway, "warnings": _warnings, "alerts": _alerts,
    "box": _box, "approvals": _approvals, "verify": _verify, "last_count": _last_count,
    "rule": _rule, "donate_form": _form, "spend_form": _form, "count_form": _form,
    "afford": _afford, "refuse": _refuse, "who": _who,
    "howto": _howto, "brief": _brief, "donors": _donors, "help": _help,
}
MONEY = ("income", "spend", "largest", "balance", "forecast", "runway", "afford", "rule")
FOLLOW = ("income", "spend", "largest", "balance", "forecast", "runway")


@router.post("/i/{slug}/assistant")
def ask(
    slug: str,
    body: AskIn,
    db: Session = Depends(core.get_db),
    user: User = Depends(core.current_user),
):
    inst = core.get_institution(db, slug)
    assert_same_institution(user, inst)
    d = Desk(db, inst, user)
    q = language.understand(body.question, d.now, language.fund_names(d.funds))

    # "And last month?" carries on from the question before it
    ctx = body.context
    if q.intent is None and ctx and (q.period or q.funds) and not q.purpose and not q.unknown:
        q.intent = ctx.intent
        q.funds = q.funds or [c for c in ctx.funds if c in d.by_code]
        if q.period is None and ctx.period in (
            "today", "yesterday", "this_week", "last_week", "this_month", "last_month",
            "this_year", "last_year", "friday",
        ):
            q.period = language.named_period(ctx.period, d.now)

    r = Reply()
    if q.intent in MONEY and q.unknown:
        words = ", ".join(q.unknown[:5])
        r.say(f"Saya tidak faham: {words}. Saya tidak mahu meneka tentang wang, jadi cuba tanya "
              "dengan cara lain.",
              f"I did not understand: {words}. I will not guess about money, so please ask "
              "another way.")
        answered = False
    elif q.intent in MONEY and q.bad_period:
        _bad_period(d, q, r)
        answered = False
    else:
        ANSWERS.get(q.intent, _unsure)(d, q, r)
        answered = q.intent is not None and not (q.intent == "howto" and q.howto is None)
    return {
        "answered": answered,
        "intent": q.intent if answered else None,
        "lang": q.lang,
        "text_ms": "\n".join(r.ms),
        "text_en": "\n".join(r.en),
        "rows": r.rows,
        "basis_ms": r.basis[0] if r.basis else None,
        "basis_en": r.basis[1] if r.basis else None,
        "links": r.links[:4],
        "suggestions": SUGGEST[q.lang] if not answered or q.intent == "help" else [],
        "context": {
            "intent": q.intent,
            "funds": q.funds,
            "period": q.period.key if q.period else None,
        } if answered and q.intent in FOLLOW else None,
        "as_of": telemetry.iso(telemetry._now()),
    }
