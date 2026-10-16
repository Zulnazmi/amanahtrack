"""Demo: tamper with an alert's photo, then restore it.

    python tamper_alert.py            swap the newest alert's photo
    python tamper_alert.py --restore  put the original back

After tampering, open that alert in the app and tap Verify now. The photo
check goes red because the stored bytes no longer hash to the SHA-256 that
was recorded when the photo arrived.
"""

import base64
import json
import sqlite3
import sys
from pathlib import Path

DB = Path("amanahtrack.db")
BACKUP = Path("tamper_alert_backup.json")


def main() -> int:
    if not DB.exists():
        print("amanahtrack.db not found. Run this from the backend folder.")
        return 1
    con = sqlite3.connect(DB)

    if "--restore" in sys.argv:
        if not BACKUP.exists():
            print("Nothing to restore.")
            return 1
        saved = json.loads(BACKUP.read_text())
        con.execute(
            "UPDATE alerts SET photo = ? WHERE id = ?",
            (base64.b64decode(saved["photo"]), saved["id"]),
        )
        con.commit()
        BACKUP.unlink()
        print(f"Restored the photo on alert {saved['id'][:8]}. Verify will pass again.")
        return 0

    row = con.execute(
        "SELECT id, photo, seq FROM alerts WHERE photo IS NOT NULL ORDER BY seq DESC LIMIT 1"
    ).fetchone()
    if row is None:
        print("No alert with a photo. Run seed.py first.")
        return 1
    alert_id, photo, seq = row
    BACKUP.write_text(json.dumps({"id": alert_id, "photo": base64.b64encode(photo).decode()}))
    # Keep it a valid PNG so it still opens, but change the bytes.
    con.execute(
        "UPDATE alerts SET photo = ? WHERE id = ?", (photo + b"\x00tampered", alert_id)
    )
    con.commit()
    print(f"Tampered with the photo on alert #{seq}. Open it in the app and tap Verify now.")
    print("Undo with: python tamper_alert.py --restore")
    return 0


if __name__ == "__main__":
    sys.exit(main())
