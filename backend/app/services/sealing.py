"""
Tamper-evident sealing.

Every transaction is hashed together with the hash before it, forming a chain.
Change one historical figure and every seal after it stops matching, which any
holder of an older root can detect. This gives the integrity property people
reach for blockchain to get, without a chain, a token, or a gas fee.

What it does prove: nobody has silently rewritten the past, including us.
What it does not prove: that the numbers were honest when they were entered.
No cryptography can do that. Point-of-entry honesty is what the sensor box and
the witnessed count session are for.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

GENESIS_HASH = "0" * 64


def _canonical(value) -> str:
    """Stable JSON so the same transaction always hashes the same way."""

    def encode(v):
        if isinstance(v, Decimal):
            return f"{v:.2f}"
        if isinstance(v, datetime):
            # SQLite does not preserve timezone info: a freshly created
            # object is tz-aware UTC, but the same row reloaded later comes
            # back naive. Left alone, the same transaction hashes two
            # different ways depending on whether it is fresh or reloaded,
            # which reads as tampering that never happened. Force UTC either
            # way so hashing is deterministic regardless of source.
            aware = v if v.tzinfo is not None else v.replace(tzinfo=timezone.utc)
            return aware.astimezone(timezone.utc).isoformat(timespec="seconds")
        if hasattr(v, "value"):
            return v.value
        return v

    return json.dumps(
        value, default=encode, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )


def hash_payload(payload: dict) -> str:
    return hashlib.sha256(_canonical(payload).encode("utf-8")).hexdigest()


def chain(prev_hash: str, payload_hash: str, seq: int) -> str:
    joined = f"{prev_hash}:{payload_hash}:{seq}"
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def transaction_payload(txn, entries) -> dict:
    """The canonical view of a transaction that gets sealed.

    Includes what must never change: the amounts, the funds they moved
    between, when it happened, and why. If any of that is edited later, the
    chain breaks.

    Deliberately excludes `status`. Status is lifecycle state that legitimately
    moves (provisional becomes confirmed at counting time, a transaction
    becomes void when reversed), and sealing it would mean every honest
    workflow step forged the chain. The transitions are still provable, just
    by different means: a confirmation is evidenced by the sealed count
    session that caused it, and a void is evidenced by the sealed reversal
    transaction that mirrors it. Nothing is taken on trust, and no money
    figure is ever mutable.
    """

    return {
        "reference": txn.reference,
        "seq": txn.seq,
        "description": txn.description,
        "occurred_at": txn.occurred_at,
        "channel": txn.channel,
        "purpose": txn.purpose,
        "device_id": txn.device_id,
        "entries": sorted(
            (
                {
                    "fund_id": e.fund_id,
                    "side": e.side,
                    "amount": e.amount,
                }
                for e in entries
            ),
            key=lambda d: (d["fund_id"], d["side"].value if hasattr(d["side"], "value") else d["side"]),
        ),
    }


@dataclass
class VerificationResult:
    intact: bool
    checked: int
    broken_at_seq: int | None = None
    reason: str = ""
    head_hash: str = GENESIS_HASH

    @property
    def summary(self) -> str:
        if self.intact:
            return f"{self.checked} entries verified, chain intact"
        return f"Chain broken at entry {self.broken_at_seq}: {self.reason}"


def verify_chain(records) -> VerificationResult:
    """Walk the chain from genesis and confirm every link.

    `records` is an ordered iterable of (seal, txn, entries) tuples.
    """

    prev = GENESIS_HASH
    checked = 0

    for seal, txn, entries in records:
        expected_payload = hash_payload(transaction_payload(txn, entries))
        if expected_payload != seal.payload_hash:
            return VerificationResult(
                intact=False,
                checked=checked,
                broken_at_seq=seal.seq,
                reason="transaction content does not match its seal",
                head_hash=prev,
            )
        if seal.prev_hash != prev:
            return VerificationResult(
                intact=False,
                checked=checked,
                broken_at_seq=seal.seq,
                reason="chain link does not follow the previous seal",
                head_hash=prev,
            )
        expected_chain = chain(prev, seal.payload_hash, seal.seq)
        if expected_chain != seal.chain_hash:
            return VerificationResult(
                intact=False,
                checked=checked,
                broken_at_seq=seal.seq,
                reason="seal hash was recomputed incorrectly or altered",
                head_hash=prev,
            )
        prev = seal.chain_hash
        checked += 1

    return VerificationResult(intact=True, checked=checked, head_hash=prev)
