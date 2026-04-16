# WorkPulse — Attendance & Leave Management

## Deploying to Render (Free)

### Step 1 — Create a PostgreSQL database on Render
1. Go to [render.com](https://render.com) → **New** → **PostgreSQL**
2. Name it `workpulse-db`, choose the free plan
3. Click **Create Database**
4. Copy the **External Database URL** (starts with `postgres://...`)

### Step 2 — Deploy the web service
1. Push this folder to a GitHub repository
2. On Render → **New** → **Web Service** → connect your GitHub repo
3. Settings:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app`
4. Under **Environment Variables**, add:
   - `DATABASE_URL` → paste the External Database URL from Step 1
   - `SECRET_KEY` → any long random string (e.g. `openssl rand -hex 32`)

### Step 3 — Initialize the database
After the first deploy, open the Render **Shell** tab and run:
```
python startup.py
```
This creates all tables and seeds the demo accounts.

### Step 4 — Update the base URL in Settings
Log in as HR Admin → Settings → change **App Base URL** to your Render URL
(e.g. `https://workpulse.onrender.com`) so email links work correctly.

---

## Demo Accounts

| Role      | Email                    | Password  |
|-----------|--------------------------|-----------|
| HR Admin  | hr@company.com           | hr123     |
| Manager   | manager@company.com      | mgr123    |
| Employee  | alice@company.com        | emp123    |

---

## Local Development (with PostgreSQL)
```bash
# Set your local DB URL
export DATABASE_URL=postgresql://user:pass@localhost/workpulse

pip install -r requirements.txt
python startup.py   # initialize DB once
python app.py       # start dev server → http://localhost:5000
```

## Gmail App Password Setup
1. Enable 2FA on your Google account
2. Go to myaccount.google.com/apppasswords
3. Create an app password for "Mail"
4. In WorkPulse: HR Admin → Settings → paste the 16-char code in Gmail App Password field
