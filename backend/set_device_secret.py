"""Replace the demo device secret with a fresh random one.

Run from the backend folder (venv active):
    python set_device_secret.py            # BOX-002
    python set_device_secret.py BOX-003    # another serial

Prints the new secret once. Put it in the Pi's AMANAH_DEVICE_SECRET.
"""

import secrets
import sys

from sqlalchemy import select

from app.main import SessionLocal
from app.models import Device

serial = sys.argv[1] if len(sys.argv) > 1 else "BOX-002"
with SessionLocal() as db:
    device = db.scalars(select(Device).where(Device.serial == serial)).first()
    if device is None:
        sys.exit(f"No device with serial {serial}")
    new = secrets.token_hex(24)
    device.shared_secret = new
    db.commit()
    print(f"{serial} secret rotated.\nAMANAH_DEVICE_SECRET={new}")
