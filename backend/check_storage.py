"""Check the evidence storage settings with a tiny test file.

    python check_storage.py

Never prints the keys.
"""

import os
import secrets

from app.services import storage


def main():
    store = storage.from_env()
    if store is None:
        raise SystemExit("Evidence storage is not configured")
    key, data = f"setup-check/{secrets.token_hex(8)}.txt", os.urandom(32)
    try:
        store.put(key, data, "text/plain")
        ok = store.get(key) == data
        store.client.delete_object(Bucket=store.bucket, Key=key)
    except Exception as exc:
        raise SystemExit(f"Storage check failed: {exc}")
    raise SystemExit(0 if ok and print("Storage works") is None else "Read back differently")


if __name__ == "__main__":
    main()
