# AmanahTrack

A fund ledger for Islamic institutions. The point of difference is that the
Shariah spending rules are enforced by the ledger engine itself, not by a
warning message or a note in a manual. Zakat cannot pay an electricity bill
because the database refuses to record it.

Final year project by Muhammad Zulnazmi Rafiqi bin Azhary and Muhammad Syamil bin Jeffry. Published for viewing and evaluation only,
see [LICENSE](LICENSE).

## What is actually built

| Part | State |
|---|---|
| Fund rules engine (8 categories) | working, tested |
| Double-entry ledger with balance invariant | working, tested |
| Hash-chain sealing and tamper detection (ledger and alerts) | working, tested |
| Signed device ingestion (HMAC-SHA256) and photo SHA-256 re-verification | working, tested |
| Manual counting with named witnesses | working, tested |
| JWT auth, four roles, per-institution isolation, separation of duties | working, tested |
| Two-person approval for spending, reversals and receipts | working, tested |
| Replay protection for box messages and login throttling | working, tested |
| Evidence photos in private cloud storage (Cloudflare R2) | working, tested |
| REST API | working |
| Pembantu Amanah: questions, forecasts and warnings (rules and statistics, no language model) | working, tested |
| Mobile app (alerts, photo evidence, verify, per-entry proof, Malay and English, Android build) | working |
| Box client (Raspberry Pi 5) | runs in simulation mode and posts signed events |
| Live sensor feed and push notifications | built, tested against simulated boxes |
| Cloud deployment | live on Render, with Neon PostgreSQL and Cloudflare R2 (see CLOUD_SETUP.md) |

211 tests pass (4 more are skipped unless a PostgreSQL test database is available). In the demo the box readings and alert photos are
**simulated**. The gaps are listed honestly because a demo that hides them
falls apart under a judge's questions.

## Security model

- **Tamper-evident records.** Ledger entries and alerts are sealed into a
  SHA-256 hash chain. Verification reports the exact entry where a change
  occurred, and re-sealing an edited alert is still caught by the next one.
- **No replays.** Every box message carries a time and a one-time id, and the
  signature covers the whole message. A captured message cannot be reused.
- **Device authenticity.** The box signs events with HMAC-SHA256. The server
  recomputes the photo hash and re-verifies the signature; bad signatures
  return 401 and non-image uploads are rejected.
- **Access control.** JWT authentication, role-based access, per-institution
  isolation (cross-institution access returns 404) and separation of duties
  (treasurers cannot clear alerts).

Not measured, and not claimed: performance figures
or any formal penetration test.

> **Secrets.** In production the server refuses to start without a strong
> `AMANAH_SECRET_KEY`. `seed.py` is for local demos only; set up a real
> mosque with `create_mosque.py`.

## Running the backend

```bash
cd backend
pip install -r requirements.txt
python seed.py          # creates a demo mosque with real balances
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs for the interactive API.

```bash
pytest -q               # 211 tests (pip install -r requirements-dev.txt first)
```

## Running the mobile app

```bash
cd mobile
npm install
cp .env.example .env    # point EXPO_PUBLIC_API_URL at your machine's LAN IP
npx expo start
```

The phone and the laptop must be on the same network. `localhost` will not
work from a physical device, which is why the env var exists.

## The three things worth demoing

1. **A refused spend.** Try paying utilities from zakat. The API returns 422
   with the fiqh basis (`Surah At-Tawbah 9:60`) and suggests which fund to use
   instead. In the app the block appears the moment you pick the purpose,
   before you type an amount.

2. **Tamper detection.** Edit an old amount directly in the SQLite file, then
   call `/i/al-hidayah/verify`. It names the exact entry that broke and every
   later seal fails with it. This is the property blockchain is usually
   imported for, done with a hash chain you can explain in one sentence.

3. **Witnessed counting.** The committee counts the cash and enters RM480
   with the names of at least two witnesses. It enters the ledger as one sealed
   entry that cannot be quietly changed.

## Design decisions worth knowing

**Status is not sealed.** Amounts, funds, dates and purposes are covered by
the hash. Status is not, because it legitimately moves. Transitions are still provable: a confirmation is
evidenced by the sealed count session, a void by the sealed reversal.

**Voided transactions stay in balances.** A mistake is corrected by posting
its mirror, not by hiding the original. The pair nets to zero on its own.

**Cash is an asset, funds behave like equity.** Debits raise cash, credits
raise a fund. Applying one convention to both is how a mosque ends up
appearing to hold negative money, which is the first bug this project hit.

**A box never adds money.** Its sensors and camera guard the cash. Only people
count it, in front of witnesses.

## What is missing before this touches a real mosque

Nothing here should be deployed as-is. In rough order:

- **Deployment hardening.** The backend runs on Render's free tier, which sleeps when idle and runs a single instance.
- **Known integrity gaps.** Transaction status is not sealed, and no copy of
  the latest hash is kept outside the database.
- **Database backups.** The live database is hosted PostgreSQL on Neon; scheduled backups of it and the evidence
  bucket are not automated yet.
- **Offline sync.** Rural suraus lose connectivity. The client currently
  assumes the network is there.
- **A real treasurer's review of the fiqh rules.** The rules in `core/fiqh.py`
  are researched, not authoritative. They need sign-off from someone
  qualified before anyone relies on them, and the file is deliberately written
  as reviewable data rather than buried logic so that review is possible.

## Layout

```
backend/
  app/core/fiqh.py        fund categories and their spending rules
  app/models/             institutions, funds, transactions, entries, seals
  app/services/ledger.py  posting, rule enforcement, balances, reconciliation
  app/services/sealing.py hash chain and verification
  app/main.py             REST API
  seed.py                 demo data
  tests/test_ledger.py    the guarantees, as tests
mobile/
  app/index.tsx           fund balances with constraint notes
  app/spend.tsx           disbursement with live rule checking
  app/count.tsx           box count reconciliation
  app/ledger.tsx          transaction history and seal status
  src/api/client.ts       typed API client
  src/theme/index.ts      design tokens
```
