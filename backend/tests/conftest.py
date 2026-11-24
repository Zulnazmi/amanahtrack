"""No test may reach the real push service."""

import os

os.environ["AMANAH_EXPO_PUSH_URL"] = "http://127.0.0.1:9/send"
os.environ["AMANAH_EXPO_RECEIPTS_URL"] = "http://127.0.0.1:9/receipts"
