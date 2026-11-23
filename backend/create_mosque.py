"""Set up a real mosque. Never deletes anything.

    python create_mosque.py

Asks for the mosque, its first admin and its first box, creates the standard
funds, and prints the box secret once. Safe to run again for another mosque.
"""

import getpass
import re
import secrets

from sqlalchemy import select

from app.core import auth, migrate
from app.core.fiqh import FundCategory, PurposeCode
from app.main import SessionLocal, engine
from app.models import AccountNature, Device, Fund, Institution, Role, User

FUNDS = [
    ("cash", FundCategory.SADAQAH, "Tunai di tangan", "Cash on hand", None),
    ("sadaqah", FundCategory.SADAQAH, "Sedekah am", "General sadaqah", None),
    ("zakat", FundCategory.ZAKAT, "Zakat", "Zakat", None),
    ("waqf", FundCategory.WAQF_PRINCIPAL, "Wakaf modal", "Waqf principal", None),
    ("yatim", FundCategory.INFAQ, "Infaq anak yatim", "Orphan infaq",
     PurposeCode.ORPHAN_WELFARE),
    ("khairat", FundCategory.KHAIRAT, "Khairat kematian", "Death benefit fund", None),
]


def create(db, *, name, slug, state, admin_name, email, password, serial, box_label):
    """Create everything in one transaction. Returns the box secret."""
    email = email.strip().lower()
    if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", slug):
        raise ValueError("Short name: lower case letters, numbers and dashes only")
    if not 10 <= len(password.encode()) <= 72:
        raise ValueError("Password must be 10 to 72 characters")
    for model, column, value, what in (
        (Institution, Institution.slug, slug, "That short name"),
        (User, User.email, email, "That email"),
        (Device, Device.serial, serial, "That box serial"),
    ):
        if db.scalars(select(model).where(column == value)).first():
            raise ValueError(f"{what} is already used")

    inst = Institution(name=name, slug=slug, state=state, public_page_enabled=False)
    db.add(inst)
    db.flush()
    funds = {}
    for code, category, ms, en, bound in FUNDS:
        funds[code] = Fund(
            institution_id=inst.id,
            code=code,
            category=category,
            label_ms=ms,
            label_en=en,
            bound_purpose=bound,
            nature=AccountNature.ASSET if code == "cash" else AccountNature.FUND,
        )
    db.add_all(funds.values())
    db.add(
        User(
            institution_id=inst.id,
            name=admin_name,
            email=email,
            password_hash=auth.hash_password(password),
            role=Role.ADMIN,
        )
    )
    db.flush()
    secret = secrets.token_hex(24)
    db.add(
        Device(
            institution_id=inst.id,
            serial=serial,
            label=box_label,
            default_fund_id=funds["sadaqah"].id,
            shared_secret=secret,
        )
    )
    db.commit()
    return secret


def main():
    migrate.upgrade(engine)
    details = {
        "name": input("Mosque name: ").strip(),
        "slug": input("Short name (for example al-hidayah): ").strip(),
        "state": input("State: ").strip(),
        "admin_name": input("Admin name: ").strip(),
        "email": input("Admin email: ").strip(),
        "serial": input("Box serial (for example BOX-101): ").strip(),
        "box_label": input("Where the box is: ").strip(),
        "password": getpass.getpass("Admin password (at least 10 characters): "),
    }
    if getpass.getpass("Password again: ") != details["password"]:
        raise SystemExit("Passwords do not match")
    with SessionLocal() as db:
        try:
            secret = create(db, **details)
        except ValueError as exc:
            raise SystemExit(str(exc))
    print(f"\n{details['name']} is ready. Put this in the Pi's box.env, shown once:")
    print(f"AMANAH_DEVICE_SECRET={secret}")


if __name__ == "__main__":
    main()
