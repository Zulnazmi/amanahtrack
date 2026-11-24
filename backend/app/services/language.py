"""Works out what a Malay or English question is asking for.

A fixed word list, not a language model. It either recognises a question or
says it does not; it never fills a gap with a guess. Words it did not know are
handed back, and a question about money is not answered while any are left:
"debt of the mosque" must not be answered with its balance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from app.core.fiqh import FundCategory, PurposeCode

_SHORT = {
    "mggu": "minggu", "mgu": "minggu", "bln": "bulan", "thn": "tahun", "hr": "hari",
    "ni": "ini", "brp": "berapa", "brapa": "berapa", "berape": "berapa", "dlm": "dalam",
    "utk": "untuk", "tuk": "untuk", "bape": "berapa", "dgn": "dengan", "yg": "yang",
    "nk": "nak", "mcm": "macam", "camne": "bagaimana", "camna": "bagaimana", "mcmana": "bagaimana",
    "xde": "tiada", "blh": "boleh", "bole": "boleh", "sedekah": "sadaqah", "sedeqah": "sadaqah",
    "waqf": "wakaf", "infak": "infaq", "jumaat": "jumaat", "smlm": "semalam", "kmrn": "semalam",
    "keluarkan": "keluar", "donations": "donation", "donated": "donation", "funds": "fund",
    "weeks": "week", "months": "month", "days": "day", "alerts": "alert", "approvals": "approval",
    "boxes": "box", "counts": "count", "warnings": "warning", "derma2": "derma", "duit": "wang",
    "forecasts": "forecast", "predictions": "prediction", "predict": "prediction",
    "spending": "spend", "spent": "spend", "expenses": "spend", "expense": "spend",
    "balances": "balance", "collected": "collection", "whats": "what", "hows": "how",
}

# Intent -> phrases. Order matters: the first intent with a match wins.
_INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("help", (
        "terima kasih", "thanks", "thank you", "good morning", "selamat pagi", "siapa awak",
        "siapa kamu", "who are you", "are you ai", "what can you do", "apa boleh buat",
        "apa awak boleh", "apa kamu boleh",
    )),
    ("donors", (
        "siapa derma", "siapa yang derma", "siapa penderma", "nama penderma", "senarai penderma",
        "penderma", "who donation", "who gave", "donor", "donors", "donor names", "who donates",
    )),
    ("howto", (
        "macam mana", "bagaimana", "cara", "how do i", "how to", "how can i", "where do i",
        "di mana nak", "kat mana nak", "tunjuk cara", "kata laluan", "password", "resit",
        "receipt", "silap", "mistake",
    )),
    ("refuse", (
        "padam", "delete", "hapus", "buang", "transfer", "pindah", "pindahkan", "luluskan semua",
        "approve all", "ubah", "edit", "tolak semua", "reject all", "remove", "erase",
    )),
    ("who", ("siapa", "who")),
    ("brief", (
        "ringkasan", "rumusan", "laporan ringkas", "daily brief", "brief", "summary", "summarise",
        "summarize", "apa berlaku", "apa cerita", "what happened", "what is new", "what new",
        "apa khabar masjid",
    )),
    ("warnings", (
        "luar biasa", "pelik", "mencurigakan", "ganjil", "perlu disemak", "perlu perhatian",
        "ada masalah", "apa masalah", "amaran kewangan", "unusual", "strange", "suspicious",
        "anything wrong", "anomaly", "anomalies", "need attention", "needs attention", "warning",
    )),
    ("runway", (
        "berapa lama", "tahan berapa", "cukup sampai", "cukup berapa", "sampai bila",
        "bila habis", "how long", "run out", "last until", "runway",
    )),
    ("forecast", (
        "ramal", "ramalan", "jangka", "jangkaan", "dijangka", "anggaran", "unjuran",
        "minggu depan", "bulan depan", "akan datang", "forecast", "prediction", "predicted",
        "expect", "expected", "next week", "next month",
    )),
    ("afford", (
        "cukup tak", "cukup ke", "cukup wang", "wang cukup", "mampu", "afford", "enough",
    )),
    ("rule", (
        "boleh guna", "boleh digunakan", "boleh bayar", "boleh beli", "boleh baiki", "boleh belanja",
        "boleh dibelanjakan", "boleh tak", "bolehkah", "boleh ke", "hukum", "dibenarkan",
        "can i use", "can we use", "can be used", "can pay", "can we pay", "can i pay", "allowed",
        "permitted", "may we", "may i", "can zakat", "can sadaqah", "can wakaf", "can infaq",
        "can khairat", "boleh zakat", "can pay", "fund can",
    )),
    ("approvals", (
        "kelulusan", "lulus", "luluskan", "menunggu", "tertangguh", "approval", "approve",
        "pending", "waiting",
    )),
    ("alerts", (
        "alert", "amaran", "kecurian", "pencuri", "curi", "gegaran", "theft", "thief", "stolen",
        "steal", "vibration",
    )),
    ("box", (
        "tabung online", "tabung offline", "status tabung", "tabung pintar", "pintu tabung",
        "keadaan tabung", "tabung ok", "tabung okay", "box online", "box offline", "box status",
        "status box", "box ok", "box okay", "door open", "pintu", "box door", "is the box",
    )),
    ("verify", (
        "meterai", "lejar selamat", "lejar ok", "diubah", "diusik", "integriti", "rantaian",
        "ledger safe", "ledger ok", "ledger okay", "sealed", "seal", "tampered", "tamper",
        "integrity", "verify", "sahkan lejar", "semak lejar",
    )),
    ("last_count", (
        "kiraan terakhir", "kiraan tabung", "bila kira", "bila kali terakhir kira", "last count",
        "count last", "box count", "last counted", "kali terakhir dikira",
    )),
    ("spend", ("did we pay", "have we paid", "dah bayar", "sudah bayar", "telah bayar")),
    ("spend_form", (
        "nak belanja", "mahu belanja", "rekod belanja", "rekod perbelanjaan", "nak bayar",
        "bayar bil", "record spend", "record a spend", "i want to pay", "pay the", "pay bill",
        "new spend",
    )),
    ("donate_form", (
        "rekod derma", "nak rekod derma", "terima derma", "masukkan derma", "tambah derma",
        "record donation", "record a donation", "add donation", "add a donation", "new donation",
    )),
    ("count_form", (
        "nak kira tabung", "kira tabung", "rekod kiraan", "count the box", "count box",
        "record count", "record a count", "start count",
    )),
    ("balance", ("dana mana paling", "which fund has")),
    ("largest", (
        "terbesar", "paling besar", "paling banyak", "tertinggi", "largest", "biggest", "highest",
    )),
    ("spend", (
        "belanja", "perbelanjaan", "dibelanjakan", "keluar", "wang keluar", "spend", "paid out",
        "bayaran", "dibayar", "kos",
    )),
    ("income", (
        "derma", "kutipan", "sumbangan", "wang masuk", "masuk", "terima", "diterima", "terkumpul",
        "dikutip", "donation", "collection", "income", "received", "receive", "collect", "raised",
    )),
    ("balance", (
        "baki", "balance", "berapa wang", "wang ada", "ada berapa", "berapa ada", "jumlah dana",
        "berapa dalam", "berapa tinggal", "tinggal berapa", "how much in", "how much money",
        "how much do we have", "how much is in", "how much", "how much left", "berapa",
        "jumlah wang", "total held", "cash",
    )),
    ("help", (
        "tolong", "bantuan", "help", "hai", "hi", "hello", "salam", "assalamualaikum",
    )),
]

_HOWTO: list[tuple[str, tuple[str, ...]]] = [
    ("donate", ("derma", "donation", "donate", "sumbangan")),
    ("spend", ("belanja", "perbelanjaan", "spend", "bayar", "pay", "wang keluar")),
    ("count", ("kira", "kiraan", "count")),
    ("reverse", ("batal", "batalkan", "betulkan", "silap", "salah", "pembetulan", "reverse",
                 "undo", "mistake", "correct", "fix")),
    ("approve", ("lulus", "luluskan", "kelulusan", "approve", "approval")),
    ("receipt", ("resit", "receipt")),
    ("password", ("kata laluan", "password")),
    ("people", ("pengguna", "ahli", "user", "users", "people", "staff", "bendahari", "treasurer")),
    ("alert", ("alert", "amaran", "gambar", "foto", "photo")),
    ("verify", ("sahkan", "semak", "verify", "meterai", "lejar", "ledger", "check")),
]

_FUNDS: dict[FundCategory, tuple[str, ...]] = {
    FundCategory.ZAKAT: ("zakat",),
    FundCategory.SADAQAH: ("sadaqah", "sadaqah am", "tabung am", "dana am", "general fund"),
    FundCategory.INFAQ: ("infaq", "infaq anak yatim", "anak yatim", "tabung anak yatim", "dana anak yatim",
                         "orphan fund"),
    FundCategory.WAQF_PRINCIPAL: ("wakaf", "wakaf modal", "modal wakaf"),
    FundCategory.WAQF_INCOME: ("hasil wakaf", "wakaf hasil", "wakaf income"),
    FundCategory.NAZAR: ("nazar",),
    FundCategory.FIDYAH: ("fidyah",),
    FundCategory.KHAIRAT: ("khairat", "khairat kematian", "death benefit", "tabung khairat"),
}

_PURPOSES: list[tuple[PurposeCode, tuple[str, ...]]] = [
    (PurposeCode.UTILITIES, ("bil elektrik", "bil air", "bil api", "elektrik", "air", "bil",
                             "utiliti", "tnb", "electricity", "electric", "water", "bill",
                             "bills", "utility", "utilities")),
    (PurposeCode.MOSQUE_MAINTENANCE, ("bumbung", "baiki", "baiki masjid", "penyelenggaraan",
                                      "cat", "roof", "repair", "repairs", "maintenance",
                                      "aircond", "penghawa dingin")),
    (PurposeCode.STAFF_SALARY, ("gaji", "gaji imam", "gaji bilal", "elaun imam", "elaun", "salary", "salaries", "wages")),
    (PurposeCode.EDUCATION, ("kelas agama", "kelas", "pendidikan", "ceramah", "education",
                             "class", "classes", "lecture")),
    (PurposeCode.ORPHAN_WELFARE, ("anak yatim", "yatim", "orphan", "orphans")),
    (PurposeCode.FUNERAL_SUPPORT, ("kematian", "jenazah", "pengebumian", "funeral", "burial")),
    (PurposeCode.RAMADAN_PROGRAMME, ("program ramadan", "ramadan", "iftar", "berbuka", "moreh")),
    (PurposeCode.CAPITAL_PROJECT, ("bina", "pembinaan", "bangunan", "construction", "building")),
    (PurposeCode.ADMIN_COST, ("pentadbiran", "pejabat", "administration", "admin", "office")),
    (PurposeCode.ASNAF_FAKIR, ("fakir", "asnaf fakir", "orang fakir")),
    (PurposeCode.ASNAF_MISKIN, ("miskin", "asnaf miskin", "orang miskin", "poor", "needy")),
    (PurposeCode.ASNAF_MUALLAF, ("muallaf", "mualaf", "convert", "converts")),
    (PurposeCode.ASNAF_AMIL, ("amil",)),
    (PurposeCode.ASNAF_GHARIMIN, ("gharimin", "orang berhutang", "debtor", "debtors")),
    (PurposeCode.ASNAF_IBNUSSABIL, ("ibnu sabil", "ibnussabil", "musafir", "traveller")),
]

_MONTHS = {
    name: n
    for n, names in enumerate(
        (
            ("januari", "january"), ("februari", "february"), ("mac", "march"), ("april",),
            ("mei", "may"), ("jun", "june"), ("julai", "july"), ("ogos", "august"),
            ("september",), ("oktober", "october"), ("november",), ("disember", "december"),
        ),
        start=1,
    )
    for name in names
}

_MS_WORDS = set(
    "apa adakah ada baki berapa boleh bila di dalam dan dana derma belanja hari ini itu minggu "
    "bulan tahun lepas semalam untuk yang nak mahu tabung wang kutipan ramal ramalan macam mana "
    "bagaimana cara siapa perlu tolong saya kita kami lejar masjid jumlah kiraan kelulusan amaran "
    "guna bayar depan masuk keluar terbesar ringkasan pelik luar biasa rekod kira tak ke "
    "menunggu meterai pintu salam hai".split()
)
_EN_WORDS = set(
    "what how much is are the in of for this that week month year today yesterday last next can "
    "we i do does did show me donation donations spend balance fund any anything who when long "
    "record count pay summary brief unusual forecast approval alert box ledger my our have has "
    "hi hello help left be used with from to".split()
)
_FILLER = _MS_WORDS | _EN_WORDS | set(
    "a an at on it its and or so please tolonglah lah la kah pula pun juga sudah dah telah akan "
    "pada dari daripada oleh dengan sekarang now setakat belum many most rm ringgit total jumlahnya "
    "semua all every setiap berjalan ok okay going give tell bagi beri tunjuk lihat tengok see get "
    "was were been will would should there ni sini kat mana which per dia kah ialah adalah nya satu "
    "masjid mosque only sahaja saja status "
    "money each collected use used digunakan ke tak kini".split()
)


@dataclass
class Period:
    key: str
    start: date
    end: date
    ms: str
    en: str


@dataclass
class Question:
    intent: str | None = None
    lang: str = "ms"
    funds: list[str] = field(default_factory=list)
    purpose: PurposeCode | None = None
    period: Period | None = None
    amount: Decimal | None = None
    howto: str | None = None
    # Asked about a date this code cannot work out
    bad_period: bool = False
    unknown: list[str] = field(default_factory=list)
    text: str = ""


def normalise(text: str) -> str:
    t = text.lower().replace("’", "'").replace("'", "")
    t = re.sub(r"(?<=\d),(?=\d{3})", "", t)
    t = re.sub(r"[^\w.\s]", " ", t)
    t = re.sub(r"\.(?!\d)|(?<!\d)\.", " ", t)
    return " ".join(_SHORT.get(w, w) for w in t.split())


def _has(text: str, phrase: str) -> bool:
    return f" {phrase} " in f" {text} "


def _month_period(month: int, year: int | None, now: date) -> Period:
    if year is None:
        year = now.year if month <= now.month else now.year - 1
    start = date(year, month, 1)
    end = date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)
    ms = ("Januari Februari Mac April Mei Jun Julai Ogos September Oktober November Disember"
          ).split()[month - 1]
    en = ("January February March April May June July August September October November December"
          ).split()[month - 1]
    return Period("month", start, min(end, now), f"{ms} {year}", f"{en} {year}")


def named_period(key: str, now: date) -> Period:
    monday = now - timedelta(days=now.weekday())
    month = now.replace(day=1)
    last_month_end = month - timedelta(days=1)
    day = timedelta(days=1)
    return {
        "today": Period(key, now, now, "hari ini", "today"),
        "yesterday": Period(key, now - day, now - day, "semalam", "yesterday"),
        "this_week": Period(key, monday, now, "minggu ini", "this week"),
        "last_week": Period(key, monday - 7 * day, monday - day, "minggu lepas", "last week"),
        "this_month": Period(key, month, now, "bulan ini", "this month"),
        "last_month": Period(key, last_month_end.replace(day=1), last_month_end,
                             "bulan lepas", "last month"),
        "this_year": Period(key, date(now.year, 1, 1), now, "tahun ini", "this year"),
        "last_year": Period(key, date(now.year - 1, 1, 1), date(now.year - 1, 12, 31),
                            "tahun lepas", "last year"),
        "friday": Period(key, now - ((now.weekday() - 4) % 7) * day,
                         now - ((now.weekday() - 4) % 7) * day, "Jumaat terakhir", "last Friday"),
    }[key]


_PERIODS: list[tuple[str, tuple[str, ...]]] = [
    ("today", ("hari ini", "today")),
    ("yesterday", ("semalam", "yesterday")),
    ("last_week", ("minggu lepas", "minggu lalu", "last week")),
    ("this_week", ("minggu ini", "this week")),
    ("last_month", ("bulan lepas", "bulan lalu", "last month")),
    ("this_month", ("bulan ini", "this month")),
    ("last_year", ("tahun lepas", "tahun lalu", "last year")),
    ("this_year", ("tahun ini", "this year")),
    ("friday", ("jumaat lepas", "jumaat terakhir", "jumaat lalu", "last friday")),
]
# Times people ask about that this code does not know
_UNSUPPORTED = ("raya", "aidilfitri", "aidiladha", "syawal", "rejab", "syaaban", "muharram",
                "isnin", "selasa", "rabu", "khamis", "sabtu", "ahad", "jumaat", "monday",
                "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "jam", "hour")


def understand(text: str, now: date, fund_words: dict[str, list[str]]) -> Question:
    """fund_words: fund code -> names this mosque uses for it, normalised."""
    t = normalise(text)
    q = Question(text=t)
    left = f" {t} "

    def take(phrase: str) -> bool:
        nonlocal left
        if f" {phrase} " not in left:
            return False
        while f" {phrase} " in left:
            left = left.replace(f" {phrase} ", "  ")
        return True

    ms = sum(w in _MS_WORDS for w in t.split())
    en = sum(w in _EN_WORDS for w in t.split())
    q.lang = "en" if en > ms else "ms"

    for intent, phrases in _INTENTS:
        if any(_has(t, p) for p in phrases):
            q.intent = intent
            break

    # An amount is only an amount with RM in front or sen behind it
    money = re.search(r"\brm ?(\d{1,9}(?:\.\d{1,2})?)\b|\b(\d{1,9}\.\d{2})\b", t)
    if money:
        q.amount = Decimal(money[1] or money[2])
        left = left.replace(money[0], " ")

    for key, phrases in _PERIODS:
        if any(take(p) for p in phrases):
            q.period = named_period(key, now)
            break
    if q.period is None:
        year = re.search(r"\b(20\d\d)\b", left)
        month = next((m for m in _MONTHS if f" {m} " in left and (m != "may" or year)), None)
        if month:
            take(month)
            y = int(year[1]) if year else None
            if year:
                take(year[1])
            q.period = _month_period(_MONTHS[month], y, now)
            if q.period.start > now:
                q.period, q.bad_period = None, True
        elif year:
            take(year[1])
            y = int(year[1])
            if y <= now.year:
                q.period = Period("year", date(y, 1, 1), min(date(y, 12, 31), now), str(y), str(y))
            else:
                q.bad_period = True
        if re.search(r"\b\d+\b", left):
            q.bad_period = True
    if any(take(w) for w in _UNSUPPORTED):
        q.bad_period = True
    if q.period and q.period.key == "friday":
        q.bad_period = False

    # Longest names first, so "infaq anak yatim" is not read as two things
    names = sorted(
        ((n, code) for code, ns in fund_words.items() for n in ns), key=lambda x: -len(x[0])
    )
    phrases = sorted(
        ((p, code) for code, ps in _PURPOSES for p in ps), key=lambda x: -len(x[0])
    )

    def take_funds():
        for name, code in names:
            if take(name) and code not in q.funds:
                q.funds.append(code)

    def take_purpose():
        for phrase, code in phrases:
            if take(phrase) and q.purpose is None:
                q.purpose = code

    # "Anak yatim" is what money is for in one question and a fund in another
    wants_purpose = q.intent in ("rule", "afford", "spend_form") or (
        q.intent is None and any(_has(t, w) for w in ("boleh", "can", "ok", "okay"))
    )
    if wants_purpose:
        # A full fund name still wins over the purpose inside it
        for name, code in names:
            if len(name.split()) > 2 and take(name) and code not in q.funds:
                q.funds.append(code)
        take_purpose()
        take_funds()
    else:
        take_funds()
        if q.intent not in ("income", "largest", "balance", "forecast", "runway"):
            take_purpose()

    if q.intent == "howto":
        q.howto = next((k for k, ws in _HOWTO if any(_has(t, w) for w in ws)), None)
    if q.intent == "rule" and q.purpose is None and not q.funds:
        # "may" and "allowed" alone are not a question about a fund
        q.intent = None
    if q.intent is None and q.purpose and q.funds and wants_purpose:
        q.intent = "rule"
    if q.intent is None and q.funds and not q.purpose and not left.split():
        q.intent = "balance"

    known = set(_FILLER)
    for _, ps in _INTENTS:
        for p in ps:
            known.update(p.split())
    for _, ps in _HOWTO:
        for p in ps:
            known.update(p.split())
    q.unknown = [w for w in dict.fromkeys(left.split()) if w not in known]
    return q


def fund_names(funds) -> dict[str, list[str]]:
    """What people may call each of this mosque's funds."""
    out: dict[str, list[str]] = {}
    for f in funds:
        names = {normalise(f.label_ms), normalise(f.label_en), normalise(f.code)}
        same = [x for x in funds if x.category is f.category]
        # A shared nickname would pick one of several funds at random
        if len(same) == 1:
            names.update(_FUNDS[f.category])
        out[f.code] = [n for n in names if n]
    # Two labels that read the same name nothing
    seen: dict[str, int] = {}
    for ns in out.values():
        for n in ns:
            seen[n] = seen.get(n, 0) + 1
    return {c: [n for n in ns if seen[n] == 1] for c, ns in out.items()}
