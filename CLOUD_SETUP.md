# Putting AmanahTrack online (free)

Database: Neon (PostgreSQL). Backend: Render (web service).
After this, the Pi and the app use one fixed https address.

## Part 1. Database (Neon)
1. Sign up at neon.com (no card needed). Create a project, any name, region Singapore if offered.
2. On the project page click Connect and copy the connection string. It looks like
   postgresql://user:password@ep-xxxx.aws.neon.tech/neondb?sslmode=require
   Keep it private. Call it DB_URL.

## Part 2. Fill the cloud database (laptop, one time)
```
cd C:\amanahtrack\backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:AMANAH_DATABASE_URL="DB_URL"
$env:AMANAH_SECRET_KEY="<the same key you will use in Part 3>"
python create_mosque.py
```
It asks for the mosque, the first admin and the box, then prints the box secret once.
Write it down. It goes in the Pi. It never deletes anything.
Do NOT run seed.py here. It erases the database, is for local demos only, and now
refuses to run against a real one.

## Part 3. Backend (Render)
1. Put the project on GitHub (private repo is fine). Do not commit amanahtrack.db or box.env.
2. On render.com: New, Web Service, pick the repo.
   Root Directory: backend
   Build Command: pip install -r requirements.txt
   Start Command: uvicorn app.main:app --host 0.0.0.0 --port $PORT
   Instance type: Free
3. Environment variables:
   AMANAH_DATABASE_URL = DB_URL
   AMANAH_SECRET_KEY = a long random string (run: python -c "import secrets; print(secrets.token_hex(32))")
   PYTHON_VERSION = 3.12.7
   AMANAH_S3_ENDPOINT = https://<account id>.r2.cloudflarestorage.com
   AMANAH_S3_BUCKET = amanahtrack-evidence
   AMANAH_S3_ACCESS_KEY_ID = from Cloudflare, R2, Manage API tokens
   AMANAH_S3_SECRET_ACCESS_KEY = shown once by Cloudflare
   The R2 token needs Object Read & Write on this one bucket only.
   Keep the bucket private: public development URL off, no custom domain.
   Check the settings with: python check_storage.py
4. Deploy. When it is live, open https://<name>.onrender.com/docs to check.

## Part 4. Point the Pi and the app at it
Pi: edit /home/pi/amanahtrack_device/box.env
   AMANAH_API_URL=https://<name>.onrender.com
   AMANAH_DEVICE_SECRET=<the new secret from Part 2>
then: sudo systemctl restart amanahtrack-box

App (laptop):
   cd C:\amanahtrack\mobile
   $env:EXPO_PUBLIC_API_URL="https://<name>.onrender.com"
   npx expo start -c

## Notes
- Free Render services sleep after 15 minutes without traffic. The box heartbeat every 30 seconds keeps it awake while the Pi is on. The first request after a sleep takes about a minute, so open the /docs page before a demo.
- Only run one backend instance (the live feed keeps its connections in memory).
- Photos are saved with the alert, then moved to R2 within about a minute and checked
  before the database copy is removed. If R2 is down they wait in the database.
- Back up the database and the bucket. Nothing is deleted automatically.
- The database is upgraded by itself when the server starts. Back it up first.
- The server will not start without a strong AMANAH_SECRET_KEY.
- The server and the files in device/ must be updated together. Boxes running older
  code are refused, because their messages could be replayed.
- The Pi clock must be right to within 5 minutes. Raspberry Pi OS sets it from the
  network. Events are kept and sent later if it is wrong.
