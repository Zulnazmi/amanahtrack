"""Seed a demo institution so the app has something to show."""

import struct
import zlib
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.core import auth
from app.core.fiqh import FundCategory, PurposeCode
from app.main import Base, SessionLocal, engine
from app.models import (
    AccountNature,
    AlertKind,
    AlertSeverity,
    Channel,
    Device,
    Fund,
    Institution,
    Role,
    TxnStatus,
    User,
)
from app.services import alerts as alert_service
from app.services import ledger

FUND_SPEC = [
    ("cash", FundCategory.SADAQAH, "Tunai di tangan", "Cash on hand", None),
    ("sadaqah", FundCategory.SADAQAH, "Sedekah am", "General sadaqah", None),
    ("zakat", FundCategory.ZAKAT, "Zakat", "Zakat", None),
    ("waqf", FundCategory.WAQF_PRINCIPAL, "Wakaf modal", "Waqf principal", None),
    (
        "yatim",
        FundCategory.INFAQ,
        "Infaq anak yatim",
        "Orphan infaq",
        PurposeCode.ORPHAN_WELFARE,
    ),
    (
        "khairat",
        FundCategory.KHAIRAT,
        "Khairat kematian",
        "Death benefit fund",
        None,
    ),
]


def demo_photo(variant: str) -> bytes:
    """A small synthetic camera frame (PNG, stdlib only).

    Stands in for a picture from the box camera so the demo works without
    hardware: a dim interior, the tray as a lighter rectangle, and one object.
    """
    w, h = 480, 360
    rows = []
    for y in range(h):
        row = bytearray([0])
        for x in range(w):
            shade = 22 + int(18 * y / h)
            r, g, b = shade, shade + 6, shade + 4
            if 90 <= x < 390 and 120 <= y < 300:        # the tray
                r, g, b = 58, 70, 66
                if (x // 20 + y // 20) % 2 == 0:
                    r, g, b = 52, 63, 60
            if variant == "object":
                if (x - 250) ** 2 + (y - 215) ** 2 < 34 ** 2:   # foreign object
                    r, g, b = 220, 190, 90
                if (x - 250) ** 2 + (y - 215) ** 2 < 16 ** 2:
                    r, g, b = 150, 120, 40
            elif variant == "empty":
                pass
            row += bytes((r, g, b))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def seed_alerts(db, inst, device):
    import hashlib

    now = datetime.now(timezone.utc)
    demo = [
        (
            AlertKind.TRAY_EMPTIED,
            AlertSeverity.INFO,
            "Tray was emptied",
            "Weight dropped by 142.3 g. A witnessed count should follow.",
            "empty",
            timedelta(hours=26),
        ),
        (
            AlertKind.UNEXPLAINED_WEIGHT,
            AlertSeverity.WARNING,
            "Unexplained weight in the tray",
            "+11.8 g does not match any coin combination. Could be a note "
            "folded around something, or a foreign object.",
            "object",
            timedelta(minutes=47),
        ),
    ]
    for kind, severity, title, detail, variant, ago in demo:
        photo = demo_photo(variant)
        sha = hashlib.sha256(photo).hexdigest()
        alert_service.create_alert(
            db,
            institution_id=inst.id,
            kind=kind,
            severity=severity,
            title=title,
            detail=detail,
            device=device,
            photo=photo,
            claimed_sha256=sha,
            signature=alert_service.device_signature(
                device.serial, kind.value, sha, device.shared_secret
            ),
            occurred_at=now - ago,
        )


def run():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    db = SessionLocal()

    inst = Institution(name="Masjid Al-Hidayah", slug="al-hidayah", state="Perak")
    db.add(inst)
    db.flush()

    demo_accounts = [
        ("Ustaz Rahim", "bendahari@al-hidayah.my", Role.TREASURER),
        ("Hj Kamal", "admin@al-hidayah.my", Role.ADMIN),
        ("Pn Siti", "juruaudit@al-hidayah.my", Role.AUDITOR),
        ("En Faiz", "ajk@al-hidayah.my", Role.COMMITTEE),
    ]
    for name, email, role in demo_accounts:
        db.add(
            User(
                institution_id=inst.id,
                name=name,
                email=email,
                password_hash=auth.hash_password("demo1234"),
                role=role,
                telegram_id="100200300" if role is Role.TREASURER else None,
            )
        )

    funds = {}
    for code, cat, ms, en, bound in FUND_SPEC:
        f = Fund(
            institution_id=inst.id,
            code=code,
            category=cat,
            label_ms=ms,
            label_en=en,
            bound_purpose=bound,
            nature=(
                AccountNature.ASSET if code == "cash" else AccountNature.FUND
            ),
        )
        db.add(f)
        funds[code] = f
    db.flush()

    device = Device(
        institution_id=inst.id,
        serial="BOX-002",
        label="Tabung pintu utama",
        default_fund_id=funds["sadaqah"].id,
        shared_secret="demo-secret-key-change-me",
        firmware="0.3.1",
    )
    db.add(device)
    db.flush()

    inflows = [
        ("sadaqah", "18430.50", "Kutipan Jumaat kumulatif", Channel.TELEGRAM),
        ("zakat", "42900.00", "Kutipan zakat fitrah", Channel.DASHBOARD),
        ("waqf", "96000.00", "Wakaf tunai keluarga Almarhum", Channel.DASHBOARD),
        ("yatim", "7180.00", "Infaq QR anak yatim", Channel.QR_PAYMENT),
        ("khairat", "4500.00", "Yuran khairat ahli", Channel.DASHBOARD),
    ]
    for code, amount, desc, channel in inflows:
        ledger.record_donation(
            db,
            institution_id=inst.id,
            fund_id=funds[code].id,
            cash_fund_id=funds["cash"].id,
            amount=amount,
            description=desc,
            channel=channel,
        )

    outflows = [
        ("zakat", "3000.00", PurposeCode.ASNAF_FAKIR, "Bantuan 6 keluarga asnaf"),
        ("sadaqah", "890.00", PurposeCode.UTILITIES, "Bil elektrik TNB"),
        ("yatim", "2000.00", PurposeCode.ORPHAN_WELFARE, "Program anak yatim"),
        ("sadaqah", "1450.00", PurposeCode.MOSQUE_MAINTENANCE, "Baiki penghawa dingin"),
    ]
    for code, amount, purpose, desc in outflows:
        ledger.record_disbursement(
            db,
            institution_id=inst.id,
            fund_id=funds[code].id,
            cash_fund_id=funds["cash"].id,
            amount=amount,
            purpose=purpose,
            description=desc,
        )

    for amount in ("120.00", "85.50", "300.00"):
        ledger.record_donation(
            db,
            institution_id=inst.id,
            fund_id=funds["sadaqah"].id,
            cash_fund_id=funds["cash"].id,
            amount=amount,
            description="Sensor insertion, Tabung pintu utama",
            channel=Channel.DEVICE,
            status=TxnStatus.PROVISIONAL,
            device_id=device.id,
            confidence=Decimal("0.85"),
        )

    seed_alerts(db, inst, device)

    db.commit()

    result = ledger.verify(db, inst.id)
    print(f"Seeded {inst.name} ({inst.slug})")
    for code, bal in ledger.balances(db, inst.id).items():
        print(f"  {code:10s} RM {bal:>12,.2f}")
    print(f"  chain: {result.summary}")
    print(f"  head:  {result.head_hash[:16]}...")
    print("  alerts: 2 demo alerts with photo evidence")
    print("\n  Demo logins (password: demo1234)")
    for name, email, role in demo_accounts:
        print(f"    {role.value:10s} {email}")
    db.close()


if __name__ == "__main__":
    run()
