# RUNBOOK

Everything you need, with no questions back to me. Work top to bottom. Each
part says what you should see, so you can tell success from failure yourself.

Nothing here asks you to write code. Auth, migrations and the app are already
built. You are running things, not implementing them.

---

## Part 0 — What changed since your last download

- Authentication added. Every ledger endpoint now needs a login.
- Roles enforced: treasurer and admin can write, auditor and committee read only.
- Tenant isolation: a user of one mosque cannot read another's ledger, even by
  editing the URL.
- Alembic migrations set up.
- Database URL now configurable, still SQLite by default.
- Mobile app: login screen, saved session, route guard, role-aware buttons.
- Test count is now 22 (was 12).

You must re-extract the project. Delete your old `amanahtrack` folder first.

---

## Part 1 — Backend setup (10 minutes)

Open PowerShell inside `amanahtrack\backend`. Fastest way: open that folder in
File Explorer, click the address bar, type `powershell`, press Enter.

**Paths in this document.** Every command below assumes you are already in the
right folder, so the path only appears where you have to move. Wherever you
see `<PROJECT>`, substitute wherever you actually keep the project. Right now
that is:

```
C:\Users\User\OneDrive\Desktop\FYP 2\amanahtrack
```

Always wrap it in double quotes when you type it, because `FYP 2` contains a
space. Never put a `$` in front of `C:` — PowerShell reads that as a variable
and fails.

```powershell
cd "C:\Users\User\OneDrive\Desktop\FYP 2\amanahtrack\backend"
```

**Python version.** Use 3.12, not 3.14. Many packages do not yet publish
prebuilt wheels for 3.14, so pip tries to compile them from source and demands
a C++ toolchain. If your venv is on 3.14 and an install fails asking for
"Microsoft Visual C++ 14.0 or greater", that is the cause. Rebuild on 3.12:

```powershell
Remove-Item -Recurse -Force .venv
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Run these one line at a time.

```powershell
python -m venv .venv
```

```powershell
.venv\Scripts\Activate.ps1
```

Your prompt must now start with `(.venv)`. If it does not, stop and read
Troubleshooting A.

```powershell
python -m pip install -r requirements.txt
```

```powershell
python -m pytest -q
```

**Expect:** `22 passed`. If fewer, read Troubleshooting D.

```powershell
alembic upgrade head
```

**Expect:** a line ending `Running upgrade -> ..., initial schema`.
This creates the tables. From now on this is how schema changes are applied,
not by deleting the database.

```powershell
python seed.py
```

**Expect:** fund balances, `chain: 12 entries verified, chain intact`, and a
list of four demo logins.

```powershell
python -m uvicorn app.main:app --reload
```

Leave this running. The terminal will look frozen. That is correct, it is
listening. Open http://localhost:8000/docs

---

## Part 2 — Confirm auth works (5 minutes)

In the `/docs` page:

**2.1 Confirm it is locked.** Expand `GET /i/{slug}/funds`, Try it out, slug
`al-hidayah`, Execute.
**Expect: 401.** Good. That is a locked door.

**2.2 Log in.** Click the green **Authorize** button at the top right.
- username: `bendahari@al-hidayah.my`
- password: `demo1234`

Leave client_id and client_secret empty. Click Authorize, then Close.

**2.3 Confirm it opened.** Run `GET /i/{slug}/funds` again with slug
`al-hidayah`.
**Expect: 200** and a list of funds.

**2.4 The refusal still works.** `POST /i/{slug}/disbursements`, slug
`al-hidayah`, body:

```json
{
  "fund_code": "zakat",
  "amount": 890,
  "purpose": "utilities",
  "description": "Bil elektrik TNB"
}
```

**Expect: 422**, citing Surah At-Tawbah 9:60.

**2.5 Roles are enforced.** Click **Authorize**, Logout, then log in as
`juruaudit@al-hidayah.my` / `demo1234`. Run the same disbursement.
**Expect: 403** with `insufficient_role`. An auditor reads, never writes.

If all five behave as described, the backend is finished and correct. Log back
in as the treasurer before moving on.

### The four demo accounts

Password for all: `demo1234`

| Email | Role | Can do |
|---|---|---|
| `bendahari@al-hidayah.my` | treasurer | record donations, disbursements, counts |
| `admin@al-hidayah.my` | admin | everything the treasurer can, plus user management later |
| `juruaudit@al-hidayah.my` | auditor | read everything, write nothing |
| `ajk@al-hidayah.my` | committee | read balances and reports |

---

## Part 3 — Mobile app (15 minutes)

You need Node.js. If `node --version` fails, install the LTS build from
https://nodejs.org first, then open a **new** PowerShell window.

**3.1 Find your computer's LAN IP.** A phone cannot reach `localhost` on your
laptop; that word means the phone itself.

```powershell
ipconfig
```

Look for **IPv4 Address** under your active Wi-Fi adapter. It looks like
`192.168.1.23`. Write it down.

**3.2 Configure the app.** In a second PowerShell window:

```powershell
cd "C:\Users\User\OneDrive\Desktop\FYP 2\amanahtrack\mobile"
```

```powershell
Copy-Item .env.example .env
```

```powershell
notepad .env
```

Change the line to your actual IP, keeping the port:

```
EXPO_PUBLIC_API_URL=http://192.168.1.23:8000
```

Save and close Notepad.

**3.3 Install and run.**

Expo Go on your phone only ever supports the newest SDK, so the project is
pinned to SDK 57 (React Native 0.86, React 19.2). It needs **Node 22.13 or
newer** — check with `node --version` and install the current LTS from
nodejs.org if yours is older.

```powershell
npm install
```

Takes a few minutes the first time. Then align every Expo package to the exact
version this SDK expects:

```powershell
npx expo install --fix
```

Run that whenever Expo Go complains about a version mismatch. It is the
supported way to resolve these, and it is more reliable than pinning versions
by hand.

```powershell
npx expo start
```

A QR code appears. Install **Expo Go** from the Play Store on your phone, open
it, scan the QR code. Phone and laptop must be on the same Wi-Fi.

**3.4 Let the backend accept your phone.** The server must be listening on the
network, not just on itself. Stop uvicorn (`Ctrl+C`) and restart it with:

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0
```

**Expect on the phone:** the login screen. Sign in with
`bendahari@al-hidayah.my` / `demo1234`. You should land on the fund list with
real balances, and tapping a fund opens the disbursement screen.

Try recording a spend from zakat for utilities. The block should appear as
soon as you pick the purpose, before you type an amount. That is the whole
product working on a real phone.

Then log out and back in as `juruaudit@al-hidayah.my`. The action buttons
should disappear and a read-only note appears instead.

---

## Part 4 — PostgreSQL (optional, 15 minutes)

**Do this only after Parts 1 to 3 all work.** SQLite is fine for now. Postgres
matters when several devices write at once, which is not yet true.

Install Docker Desktop from https://www.docker.com/products/docker-desktop,
let it start, then:

```powershell
docker run --name amanah-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=amanahtrack -p 5432:5432 -d postgres:16
```

```powershell
python -m pip install psycopg2-binary
```

Point the app at it, in the same terminal where you run the server:

```powershell
$env:AMANAH_DATABASE_URL = "postgresql+psycopg2://postgres:dev@localhost:5432/amanahtrack"
```

```powershell
alembic upgrade head
```

```powershell
python seed.py
```

```powershell
python -m uvicorn app.main:app --reload --host 0.0.0.0
```

That environment variable only lasts for the current terminal window. Open a
new one and you are back on SQLite, which is a useful escape hatch rather than
a bug. To go back deliberately:

```powershell
Remove-Item Env:\AMANAH_DATABASE_URL
```

To stop or restart the database container:

```powershell
docker stop amanah-db
docker start amanah-db
```

---

## Troubleshooting

**A. `(.venv)` does not appear, or `Activate.ps1 cannot be loaded`**

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Type `Y`, Enter. Then run the activate line again. Verify with
`Get-ExecutionPolicy -Scope CurrentUser`, which should print `RemoteSigned`.

**B0. `cd` fails with "Cannot find path" or "Variable reference is not valid"**

Three causes, in order of likelihood. The path has a space and is not quoted,
so wrap it: `cd "C:\...\FYP 2\amanahtrack\backend"`. Or there is a stray `$`
before `C:`, which PowerShell reads as a variable — remove it. Or you are one
folder too high: run `dir` and look for `app`, `tests`, `requirements.txt`. If
you see `backend` and `mobile` instead, you are in the project root and need
`cd backend`.

**B. `No module named 'fastapi'` (or uvicorn, jose, passlib)**

The venv is not active. Your prompt is missing `(.venv)`. Activate it. This is
the single most common cause of confusing errors, and it is what caused the
false "chain broken" result earlier.

**C0. pip fails wanting "Microsoft Visual C++ 14.0 or greater"**

Your venv is on Python 3.14, which has no prebuilt wheels for some packages
yet, so pip falls back to compiling. Rebuilding the venv on 3.12 fixes it
permanently and takes ten minutes. Installing C++ build tools also works but
you will hit the same wall on the next package you add.

**C. `python was not found` or a Microsoft Store window opens**

Python is not on PATH. Reinstall from python.org with **Add python.exe to
PATH** ticked, then Settings → Apps → Advanced app settings → App execution
aliases → turn off `python.exe` and `python3.exe`. Open a new terminal.

**D. Tests fail**

Read the last few lines, which name the failing test. Then:

```powershell
Remove-Item amanahtrack.db -ErrorAction SilentlyContinue
alembic upgrade head
python seed.py
python -m pytest -q
```

If a test still fails after a clean rebuild, that is a real bug in the code,
not your environment. Save the full output and send it to me next session.

**E. Everything returns 401 in /docs**

You have not clicked **Authorize**, or your token expired (12 hours). Click
Authorize and log in again.

**F. 404 when you expected data**

Either the slug is wrong (it is `al-hidayah`, with a hyphen), or you are
logged in as a user from a different institution. That 404 is deliberate: a
wrong-institution request must not reveal whether the other one exists.

**G. Phone shows "Network request failed"**

In order of likelihood: `.env` still says `localhost` instead of your IP;
uvicorn was started without `--host 0.0.0.0`; phone and laptop are on
different networks; Windows Firewall is blocking port 8000. For the last one,
allow Python through the firewall when Windows prompts, or test in the phone's
browser by visiting `http://YOUR_IP:8000/health`, which should return
`{"status":"ok"}`.

**H0. Expo Go says the project is incompatible with your SDK**

Expo Go ships only the newest SDK, so an older project will not open in it.

```powershell
npx expo install expo@latest --fix
```

Then stop the server and restart with a cleared cache:

```powershell
npx expo start -c
```

If `--fix` reports peer dependency conflicts, delete `node_modules` and
`package-lock.json`, run `npm install`, then `npx expo install --fix` again.

**H. `npm install` fails or Expo will not start**

Delete `node_modules` and `package-lock.json` in the `mobile` folder, then run
`npm install` again. If it still fails, your Node version may be too old;
install the current LTS.

**I. Port 8000 already in use**

An old server is still running. Close the other terminal, or run on a
different port with `--port 8001` and update `.env` to match.

---

## Where you actually are

**Done:** ledger engine, fund rules, sealing, reconciliation, auth, roles,
tenant isolation, migrations, and a mobile app with login and four screens.
22 tests passing.

**Not done, in priority order:**

1. Period closing. The chain proves nobody edited history, but nothing yet
   stops someone inserting a backdated entry into a month the committee has
   already signed off.
2. Telegram bot. The channel a real treasurer will actually use daily.
3. Monthly PDF reports. This is what turns a free user into a paying one.
4. Offline queue for poor connectivity.
5. Public transparency page as a real web page rather than a JSON endpoint.
6. Hardware ingestion against a real device.

**Two honest warnings.**

The secret key is a hardcoded development default. Before this touches a real
institution's data, set `AMANAH_SECRET_KEY` to a long random value in the
environment. Anyone who knows the default can forge a token.

The fiqh rules in `app/core/fiqh.py` are researched, not authoritative. They
need review by someone qualified before a mosque relies on them. That file is
deliberately written as readable data so a religious teacher can check it
without reading code, and getting that review is worth a paragraph in your
FYP writeup.

## New design: extra packages (run once in the mobile folder)

The redesign uses SVG icons and two Google fonts. In PowerShell, inside the mobile folder:

    npx expo install react-native-svg expo-font @expo-google-fonts/sora @expo-google-fonts/plus-jakarta-sans

Then restart with `npx expo start -c` (the -c clears the cache so the new fonts load).
