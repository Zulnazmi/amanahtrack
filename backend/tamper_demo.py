"""Live tamper demo for the lecturer.

Run from the backend folder, with the backend STOPPED or running, either is fine:

    python tamper_demo.py          secretly changes a sealed RM 4,500 entry to RM 450
    python tamper_demo.py --restore   puts it back

After tampering, open the app Home screen (pull down to refresh) or call
/i/al-hidayah/verify. The seal turns red: "Chain broken". Restore, refresh,
and it is green again.
"""

import json
import sqlite3
import sys
from pathlib import Path

DB = Path("amanahtrack.db")
BACKUP = Path("tamper_backup.json")

if not DB.exists():
    sys.exit("Run this from the backend folder (amanahtrack.db not found).")

con = sqlite3.connect(DB)
cur = con.cursor()

if "--restore" in sys.argv:
    if not BACKUP.exists():
        sys.exit("Nothing to restore.")
    for entry_id, amount in json.loads(BACKUP.read_text()):
        cur.execute("UPDATE entries SET amount = ? WHERE id = ?", (amount, entry_id))
    con.commit()
    BACKUP.unlink()
    print("Restored. The chain should verify as intact again.")
    sys.exit(0)

if BACKUP.exists():
    sys.exit("Already tampered. Run with --restore first.")

rows = cur.execute(
    "SELECT id, amount FROM entries WHERE CAST(amount AS REAL) = 4500.0"
).fetchall()
if not rows:
    sys.exit("Could not find the RM 4,500 khairat entry (was the database re-seeded?).")

BACKUP.write_text(json.dumps([[r[0], r[1]] for r in rows]))
for entry_id, _ in rows:
    cur.execute("UPDATE entries SET amount = ? WHERE id = ?", ("450.00", entry_id))
con.commit()
print(f"Changed {len(rows)} rows from 4500.00 to 450.00 directly in the database.")
print("Now refresh the app. Restore with: python tamper_demo.py --restore")
