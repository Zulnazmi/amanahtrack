# AmanahTrack

A fund ledger for Islamic institutions. The point of difference is that the
Shariah spending rules are enforced by the ledger engine itself, not by a
warning message or a note in a manual. Zakat cannot pay an electricity bill
because the database refuses to record it.

## What is actually built

| Part | State |
|---|---|
| Fund rules engine (8 categories) | working, tested |
| Double-entry ledger with balance invariant | working, tested |
| Hash-chain sealing and tamper detection (ledger and alerts) | working, tested |
| Signed device ingestion (HMAC-SHA256) and photo SHA-256 re-verification | working, tested |
| Count reconciliation (provisional to confirmed, variance alert) | working, tested |
| JWT auth, four roles, per-institution isolation, separation of duties | working, tested |
| REST API | working |
| Mobile app (alerts, photo evidence, verify, per-entry proof) | working |
| Box client (Raspberry Pi 5) | runs in simulation mode and posts signed events |
| Live sensor streaming, push notifications, cloud deployment | not built |
| Load-cell coin estimator | written, not tested on real hardware |

37 tests pass. In the demo the box readings and alert photos are
**simulated**. The gaps are listed honestly because a demo that hides them
falls apart under a judge's questions.

## Security model

- **Tamper-evident records.** Ledger entries and alerts are sealed into a
  SHA-256 hash chain. Verification reports the exact entry where a change
  occurred, and re-sealing an edited alert is still caught by the next one.
- **Device authenticity.** The box signs events with HMAC-SHA256. The server
  recomputes the photo hash and re-verifies the signature; bad signatures
  return 401 and non-image uploads are rejected.
- **Access control.** JWT authentication, role-based access, per-institution
  isolation (cross-institution access returns 404) and separation of duties
  (treasurers cannot clear alerts).

Not measured, and not claimed: coin-estimator accuracy, performance figures,
or any formal penetration test.

> **Secrets.** `AMANAH_SECRET_KEY` has a dev-only fallback and must be set
> from the environment in any real deployment. The device secret in
> `seed.py` is a demo value; rotate it with `set_device_secret.py`.

## Running the backend

```bash
cd backend
pip install -r requirements.txt
python seed.py          # creates a demo mosque with real balances
uvicorn app.main:app --reload
```

Open http://localhost:8000/docs for the interactive API.

```bash
pytest -q               # 37 tests
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

3. **Reconciliation.** The box estimates RM505.50, the committee counts
   RM480. The variance is written into the ledger permanently rather than
   quietly absorbed, with the witness count attached.

## Design decisions worth knowing

**Status is not sealed.** Amounts, funds, dates and purposes are covered by
the hash. Status is not, because it legitimately moves (provisional becomes
confirmed at counting time). Transitions are still provable: a confirmation is
evidenced by the sealed count session, a void by the sealed reversal.

**Voided transactions stay in balances.** A mistake is corrected by posting
its mirror, not by hiding the original. The pair nets to zero on its own.

**Cash is an asset, funds behave like equity.** Debits raise cash, credits
raise a fund. Applying one convention to both is how a mosque ends up
appearing to hold negative money, which is the first bug this project hit.

**Device events are provisional by default.** A sensor has an opinion about
what went into the box. It does not get to assert a balance. Only a witnessed
human count promotes an estimate into the ledger proper.

## What is missing before this touches a real mosque

Nothing here should be deployed as-is. In rough order:

- **Production secrets and deployment.** Keys must come from the
  environment, and there is no cloud deployment yet.
- **Real-time sensing.** Live door, vibration and camera streaming into the
  app is designed but not built, and push notifications are missing.
- **PostgreSQL.** SQLite is fine for development and wrong for concurrent
  writes from a bot, a dashboard, and several boxes at once.
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
