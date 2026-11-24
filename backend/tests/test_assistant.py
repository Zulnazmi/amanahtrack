"""The assistant: what it understands, its figures, and what it refuses."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.fiqh import PurposeCode
from app.models import Approval, Channel, EntrySide, Fund, Institution, Transaction
from app.services import insights, language, ledger
from app.services.ledger import Leg
from tests.test_daily import decide, env, give, login  # noqa: F401  (env is a fixture)

NOW = date(2026, 11, 24)  # a Tuesday
WORDS = {
    "sadaqah": ["sadaqah am", "sadaqah", "general sadaqah", "tabung am"],
    "zakat": ["zakat"],
    "yatim": ["infaq anak yatim", "infaq", "orphan infaq", "yatim"],
    "waqf": ["wakaf", "wakaf modal"],
    "khairat": ["khairat", "khairat kematian"],
}


@pytest.mark.parametrize(
    "text, intent, funds, period",
    [
        ("Baki zakat?", "balance", ["zakat"], None),
        ("zakat ada berapa", "balance", ["zakat"], None),
        ("berapa duit dalam tabung am", "balance", ["sadaqah"], None),
        ("How much is in the zakat fund?", "balance", ["zakat"], None),
        ("Balance of each fund", "balance", [], None),
        ("Baki setiap dana", "balance", [], None),
        ("zakat", "balance", ["zakat"], None),
        ("Derma minggu ni", "income", [], "this_week"),
        ("berapa derma zakat bulan lepas?", "income", ["zakat"], "last_month"),
        ("Donations this week", "income", [], "this_week"),
        ("how much did we collect yesterday", "income", [], "yesterday"),
        ("kutipan jumaat lepas", "income", [], "friday"),
        ("kutipan Mac 2026", "income", [], "month"),
        ("belanja bulan ini", "spend", [], "this_month"),
        ("How much did we spend last month?", "spend", [], "last_month"),
        ("Derma terbesar bulan ini", "largest", [], "this_month"),
        ("Ramalan minggu depan", "forecast", [], None),
        ("Forecast for next week", "forecast", [], None),
        ("jangkaan derma akan datang", "forecast", [], None),
        ("tabung am tahan berapa lama", "runway", ["sadaqah"], None),
        ("How long will sadaqah last?", "runway", ["sadaqah"], None),
        ("Ada apa-apa luar biasa?", "warnings", [], None),
        ("Anything unusual?", "warnings", [], None),
        ("Ringkasan hari ini", "brief", [], "today"),
        ("Today's summary", "brief", [], None),
        ("ada yang menunggu kelulusan?", "approvals", [], None),
        ("what is pending approval", "approvals", [], None),
        ("ada amaran kecurian?", "alerts", [], None),
        ("status tabung", "box", [], None),
        ("is the box online", "box", [], None),
        ("lejar ada diusik tak", "verify", [], None),
        ("bila kiraan terakhir", "last_count", [], None),
        ("Boleh guna zakat untuk bumbung?", "rule", ["zakat"], None),
        ("Can we use zakat for the roof?", "rule", ["zakat"], None),
        ("can zakat pay the electricity bill", "rule", ["zakat"], None),
        ("macam mana nak rekod derma", "howto", [], None),
        ("How do I change my password?", "howto", [], None),
        ("rekod derma RM50 untuk zakat", "donate_form", ["zakat"], None),
        ("nak bayar bil api RM1,250.50", "spend_form", [], None),
        ("siapa penderma terbesar", "donors", [], None),
        ("who gave the most", "donors", [], None),
        ("how much did we pay for electricity last month", "spend", [], "last_month"),
        ("bil api bulan ni dah bayar ke", "spend", [], "this_month"),
        ("zakat boleh bagi orang miskin tak", "rule", ["zakat"], None),
        ("which fund can pay salary", "rule", [], None),
        ("boleh guna zakat untuk anak yatim", "rule", ["zakat"], None),
        ("can we afford to repair the roof", "afford", [], None),
        ("dana mana paling banyak duit", "balance", [], None),
        ("siapa rekod derma semalam", "who", [], "yesterday"),
        ("padam derma semalam", "refuse", [], "yesterday"),
        ("transfer RM100 from zakat to sadaqah", "refuse", ["sadaqah", "zakat"], None),
        ("luluskan semua permintaan", "refuse", [], None),
        ("tukar kata laluan saya", "howto", [], None),
        ("terima kasih", "help", [], None),
        ("apa khabar cuaca", None, [], None),
        ("write me a poem", None, [], None),
        ("", None, [], None),
    ],
)
def test_questions_people_ask(text, intent, funds, period):
    q = language.understand(text, NOW, WORDS)
    assert (q.intent, q.funds, q.period.key if q.period else None) == (intent, funds, period)


def test_details_are_read_exactly():
    def u(t):
        return language.understand(t, NOW, WORDS)

    assert u("nak bayar bil api RM1,250.50").amount == Decimal("1250.50")
    assert u("rekod derma rm 50 zakat").amount == Decimal("50")
    assert u("boleh guna zakat untuk bumbung").purpose is PurposeCode.MOSQUE_MAINTENANCE
    assert u("infaq anak yatim baki").funds == ["yatim"] and u("infaq anak yatim baki").purpose is None
    assert u("kutipan Mac").period.start == date(2026, 3, 1)
    assert u("kutipan Disember").period.start == date(2025, 12, 1)
    assert u("derma 2025").period.end == date(2025, 12, 31)
    assert u("how much did we spend last month").lang == "en"
    assert u("berapa belanja bulan lepas").lang == "ms"
    for t in ("derma 12 hari bulan", "kutipan 2031", "derma hari raya", "derma isnin", "derma 3 minggu"):
        assert u(t).bad_period, t
    assert u("derma daripada ahmad minggu ini").unknown == ["ahmad"]


def test_periods_start_and_end_on_the_right_days():
    def p(k):
        x = language.named_period(k, NOW)
        return x.start, x.end

    assert p("this_week") == (date(2026, 11, 23), NOW)
    assert p("last_week") == (date(2026, 11, 16), date(2026, 11, 22))
    assert p("last_month") == (date(2026, 10, 1), date(2026, 10, 31))
    assert p("friday") == (date(2026, 11, 20), date(2026, 11, 20))
    jan = language.named_period("last_month", date(2027, 1, 5))
    assert (jan.start, jan.end) == (date(2026, 12, 1), date(2026, 12, 31))
    dec = language.understand("kutipan Disember 2025", NOW, WORDS).period
    assert dec.end == date(2025, 12, 31)


def test_a_shared_name_never_picks_a_fund(env):
    _, Session = env
    with Session() as db:
        inst = db.scalars(select(Institution).where(Institution.slug == "m")).one()
        funds = [f for f in db.scalars(select(Fund).where(Fund.institution_id == inst.id))
                 if f.code != "cash"]
        twin = Fund(institution_id=inst.id, code="yatim2", category=funds[0].category,
                    label_ms="Dana baharu", label_en="New fund")
        names = language.fund_names([*funds, twin])
        nick = set(language._FUNDS[funds[0].category])
        assert not nick & set(names["yatim2"])


# ------------------------------------------------------------------ figures


def at(day: date, hour=12):
    return datetime(day.year, day.month, day.day, hour, tzinfo=insights.MYT).astimezone(timezone.utc)


def put(db, inst, fund, amount, when, *, purpose=None, text="x"):
    f = {x.code: x.id for x in db.scalars(select(Fund).where(Fund.institution_id == inst.id))}
    side = (EntrySide.CREDIT, EntrySide.DEBIT) if purpose is None else (EntrySide.DEBIT, EntrySide.CREDIT)
    return ledger.post(
        db, institution_id=inst.id, description=text, channel=Channel.DASHBOARD, purpose=purpose,
        occurred_at=when,
        legs=[Leg(f[fund], side[0], Decimal(amount)), Leg(f["cash"], side[1], Decimal(amount))],
    )


@pytest.fixture()
def books(env):  # noqa: F811
    c, Session = env
    with Session() as db:
        inst = db.scalars(select(Institution).where(Institution.slug == "m")).one()
        yield c, db, inst


def question(c, who, text, context=None):
    r = c.post("/i/m/assistant", headers=login(c, who), json={"question": text, "context": context})
    assert r.status_code == 200, r.text
    return r.json()


def test_days_are_malaysian(books):
    _, db, inst = books
    # 23:30 on the 23rd and 00:30 on the 24th in Malaysia are one UTC day
    put(db, inst, "sadaqah", "10", datetime(2026, 11, 23, 15, 30, tzinfo=timezone.utc))
    put(db, inst, "sadaqah", "20", datetime(2026, 11, 23, 16, 30, tzinfo=timezone.utc))
    db.commit()
    rows = insights.moves(db, inst)
    assert [m.day for m in rows] == [date(2026, 11, 23), date(2026, 11, 24)]


def test_each_movement_is_counted_once_and_reversals_not_at_all(books):
    _, db, inst = books
    day = insights.today()
    put(db, inst, "sadaqah", "100", at(day))
    wrong = put(db, inst, "sadaqah", "900", at(day))
    put(db, inst, "sadaqah", "30", at(day), purpose=PurposeCode.UTILITIES)
    ledger.reverse(db, txn=wrong, reason="typed twice")
    db.commit()
    rows = insights.moves(db, inst)
    assert insights.income(rows) == Decimal("100.00") and insights.spend(rows) == Decimal("30.00")


def test_forecast_needs_history_and_ignores_one_big_gift(books):
    _, db, inst = books
    first = NOW - timedelta(days=7 * 10)
    for w in range(3):
        put(db, inst, "sadaqah", "100", at(NOW - timedelta(days=4 + 7 * w)))
    db.commit()
    x = insights.forecast_income(insights.moves(db, inst), NOW)
    assert not x.enough and x.expected == 0

    for w in range(3, 10):
        put(db, inst, "sadaqah", "100", at(NOW - timedelta(days=4 + 7 * w)))
    put(db, inst, "sadaqah", "50000", at(NOW - timedelta(days=2)))
    put(db, inst, "waqf", "96000", at(NOW - timedelta(days=9)))
    put(db, inst, "sadaqah", "100", at(first - timedelta(days=1)))
    put(db, inst, "sadaqah", "7", at(NOW))  # today is not finished
    db.commit()
    x = insights.forecast_income(insights.moves(db, inst), NOW)
    assert x.enough and x.weeks == 8 and x.expected == Decimal("100.00")
    assert x.friday == Decimal("100.00")
    assert x.low <= x.expected <= x.high and x.usual_miss is not None
    waqf = next(f.id for f in db.scalars(select(Fund).where(Fund.institution_id == inst.id))
                if f.code == "waqf")
    assert insights.forecast_income(insights.moves(db, inst), NOW, waqf).expected == 0


def test_runway_is_per_fund(books):
    _, db, inst = books
    put(db, inst, "sadaqah", "1000", at(NOW - timedelta(days=60)))
    put(db, inst, "zakat", "99999", at(NOW - timedelta(days=60)))
    for w in range(8):
        put(db, inst, "sadaqah", "100", at(NOW - timedelta(days=3 + 7 * w)), purpose=PurposeCode.UTILITIES)
    db.commit()
    f = {x.code: x for x in db.scalars(select(Fund).where(Fund.institution_id == inst.id))}
    rows = insights.moves(db, inst)
    r = insights.runway(rows, NOW, f["sadaqah"].id, ledger.fund_balance(db, f["sadaqah"].id))
    assert r.weekly == Decimal("100.00") and r.lasts == 2
    assert insights.runway(rows, NOW, f["zakat"].id, Decimal("99999")).lasts is None


def kinds(db, inst, now=NOW):
    return sorted(w.kind for w in insights.warnings(db, inst, insights.moves(db, inst), now))


def test_warnings_fire_only_with_reason(books):
    _, db, inst = books
    assert kinds(db, inst) == []
    friday = date(2026, 11, 20)
    for w in range(1, 6):
        put(db, inst, "sadaqah", "500", at(friday - timedelta(days=7 * w)), text="Witnessed count, 2 witness(es)")
        put(db, inst, "sadaqah", "50", at(friday - timedelta(days=7 * w)), purpose=PurposeCode.UTILITIES)
    put(db, inst, "sadaqah", "450", at(friday), text="Witnessed count, 2 witness(es)")
    db.commit()
    assert kinds(db, inst) == []
    put(db, inst, "sadaqah", "300", at(friday), purpose=PurposeCode.UTILITIES)
    put(db, inst, "zakat", "25", at(NOW), text="Same")
    put(db, inst, "zakat", "25", at(NOW), text="same ")
    db.commit()
    assert kinds(db, inst) == ["look_alike", "spend_high"]
    assert "count_overdue" in kinds(db, inst, NOW + timedelta(days=20))


def test_a_low_count_is_reported_kindly(books):
    _, db, inst = books
    friday = date(2026, 11, 20)
    for w in range(1, 6):
        put(db, inst, "sadaqah", "500", at(friday - timedelta(days=7 * w)), text="Witnessed count, 2 witness(es)")
    put(db, inst, "sadaqah", "200", at(friday), text="Witnessed count, 2 witness(es)")
    db.commit()
    [w] = insights.warnings(db, inst, insights.moves(db, inst), NOW)
    assert w.kind == "count_low" and "RM 500.00" in w.en and "ordinary reason" in w.en


def test_a_changed_ledger_is_the_first_warning(books):
    _, db, inst = books
    t = put(db, inst, "sadaqah", "10", at(NOW))
    db.commit()
    t.entries[0].amount = Decimal("11")
    t.entries[1].amount = Decimal("11")
    db.commit()
    assert insights.warnings(db, inst, insights.moves(db, inst), NOW)[0].kind == "chain_broken"


def test_a_request_left_waiting_is_noticed(books):
    c, db, inst = books
    t = login(c, "treasurer")
    give(c, t)
    c.post("/i/m/approvals", headers=t, json={
        "fund_code": "sadaqah", "amount": "40", "purpose": "utilities", "description": "Bill"})
    row = db.scalars(select(Approval)).one()
    row.requested_at = datetime.now(timezone.utc) - timedelta(days=6)
    db.commit()
    assert "approval_waiting" in kinds(db, inst, insights.today())


# ---------------------------------------------------------------- over HTTP


def test_answers_match_the_ledger(env):  # noqa: F811
    c, _ = env
    t = login(c, "treasurer")
    give(c, t, "150.50")
    a = question(c, "committee", "Berapa baki sedekah?")
    assert a["answered"] and "RM 150.50" in a["text_ms"] and a["lang"] == "ms"
    a = question(c, "committee", "Donations today")
    assert "RM 150.50 from 1 entries" in a["text_en"]
    assert question(c, "auditor", "lejar ada diusik?")["text_en"].startswith("The ledger is intact: 1")


def test_and_last_month_carries_on(env):  # noqa: F811
    c, _ = env
    give(c, login(c, "treasurer"), "80")
    first = question(c, "admin", "berapa derma zakat minggu ini")
    again = question(c, "admin", "bulan lepas pula?", first["context"])
    assert again["intent"] == "income" and again["context"]["funds"] == ["zakat"]
    assert again["context"]["period"] == "last_month"
    assert question(c, "admin", "bulan lepas pula?")["answered"] is False


def test_rules_come_from_the_rule_engine(env):  # noqa: F811
    c, _ = env
    a = question(c, "admin", "Boleh guna zakat untuk bumbung?")
    assert a["text_ms"].startswith("Tidak.") and "bukan fatwa" in a["basis_ms"]
    a = question(c, "admin", "Can we use sadaqah for the roof?")
    assert a["text_en"].startswith("Yes.") and "not a religious ruling" in a["basis_en"]


def test_donors_stay_private(env):  # noqa: F811
    c, _ = env
    give(c, login(c, "treasurer"), "500", donor_name="Penderma Rahsia")
    for who in ("committee", "admin"):
        for text in ("siapa penderma terbesar", "Derma terbesar bulan ini", "Ringkasan hari ini",
                     "derma daripada Rahsia hari ini"):
            assert "Penderma Rahsia" not in str(question(c, who, text))


def test_unknown_words_and_dates_are_admitted(env):  # noqa: F811
    c, _ = env
    assert "ahmad" in question(c, "admin", "derma daripada Ahmad minggu ini")["text_ms"]
    a = question(c, "admin", "derma 12 haribulan")
    assert a["answered"] is False and "RM" not in a["text_ms"]
    a = question(c, "admin", "write me a poem")
    assert a["answered"] is False and a["suggestions"]


@pytest.mark.parametrize("text", [
    "berapa hutang masjid", "baki bank", "berapa umur masjid", "derma tabung qurban",
    "derma untuk bumbung bulan ini", "derma dari januari hingga mac", "derma sejak januari",
    "derma minggu lepas berbanding minggu ini", "purata derma sebulan", "average friday collection",
    "berapa banyak orang bagi semalam", "how are donations compared to last month",
    "ramalan 3 bulan", "baki 5 haribulan", "derma ramadan", "berapa derma kecuali zakat",
    "derma bukan zakat", "donations not zakat",
])
def test_it_never_guesses_about_money(env, text):  # noqa: F811
    c, _ = env
    give(c, login(c, "treasurer"), "123.45")
    a = question(c, "admin", text)
    assert a["answered"] is False and "RM" not in a["text_ms"] and a["rows"] == [], a["text_ms"]


def test_afford_answers_per_fund(env):  # noqa: F811
    c, _ = env
    give(c, login(c, "treasurer"), "600")
    a = question(c, "admin", "Cukup tak wang untuk bil elektrik RM500?")
    labels = [x["label_en"] for x in a["rows"]]
    assert a["answered"] and "RM 500.00" in a["text_ms"] and not any("Zakat" in x for x in labels)
    assert a["text_en"].startswith("1 of")


def test_it_opens_forms_but_records_nothing(env):  # noqa: F811
    c, Session = env
    a = question(c, "treasurer", "rekod derma RM50 untuk zakat")
    assert a["links"][0]["href"] == "/donate?fund=zakat&amount=50"
    assert question(c, "committee", "rekod derma RM50 untuk zakat")["links"] == []
    with Session() as db:
        assert db.query(Transaction).count() == 0 and db.query(Approval).count() == 0


def test_every_suggestion_is_understood(env):  # noqa: F811
    from app.api.assistant import SUGGEST

    c, _ = env
    for lang, texts in SUGGEST.items():
        for text in texts:
            a = question(c, "committee", text)
            assert a["answered"], text
            assert a["lang"] == lang, text


def test_who_may_ask(env):  # noqa: F811
    c, _ = env
    body = {"question": "baki"}
    assert c.post("/i/m/assistant", json=body).status_code == 401
    assert c.post("/i/other/assistant", headers=login(c, "admin"), json=body).status_code == 404
    assert c.post("/i/m/assistant", headers=login(c, "admin"),
                  json={"question": "x" * 301}).status_code == 422
    bad = {"question": "bulan lepas", "context": {"intent": "donors", "funds": []}}
    assert c.post("/i/m/assistant", headers=login(c, "admin"), json=bad).status_code == 422


def test_an_approved_spend_shows_up(env):  # noqa: F811
    c, _ = env
    t, k = login(c, "treasurer"), login(c, "committee")
    give(c, t)
    aid = c.post("/i/m/approvals", headers=t, json={
        "fund_code": "sadaqah", "amount": "40", "purpose": "utilities", "description": "Bill"}).json()["id"]
    assert "1 requests are waiting; you can decide 1" in question(c, "committee", "what is pending approval")["text_en"]
    decide(c, k, aid)
    assert "RM 40.00" in question(c, "committee", "belanja hari ini")["text_ms"]
    assert "RM 40.00" in question(c, "committee", "belanja elektrik hari ini")["text_ms"]
    assert "RM 0.00" in question(c, "committee", "belanja gaji hari ini")["text_ms"]
