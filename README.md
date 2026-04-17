# Sales Tracker — WhatsApp Field Team Intelligence

AI-powered dashboard that reads your sales team's WhatsApp group, extracts structured visit data, and tracks performance automatically.

**Replaces 2-3 hours of manual data entry every evening.**

---

## How It Works

```
Sales reps report in WhatsApp group
         ↓
Upload chat export (.txt) to dashboard
         ↓
AI extracts: school, board, principal, strength, book seller, remark
         ↓
Dashboard shows: team performance, alerts, school tracking
         ↓
Reports sent via email + WhatsApp
```

---

## Deploy to Digital Ocean (10 minutes)

### Step 1: Create a Droplet

- Go to [cloud.digitalocean.com](https://cloud.digitalocean.com)
- Create Droplet → **Ubuntu 24.04** → **2GB RAM / 1 CPU** ($12/month)
- Add your SSH key

### Step 2: SSH in and setup

```bash
ssh root@your-droplet-ip
```

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone the app
git clone https://github.com/bajajvinamr/sales-agent-publisher.git
cd sales-agent-publisher

# Configure
cp .env.example .env
nano .env
```

Fill in your `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...    # Get from console.anthropic.com
DB_PASSWORD=pick-a-strong-password
RESEND_API_KEY=re_...           # Optional: for email alerts
APP_URL=http://your-droplet-ip:3000
```

### Step 3: Start

```bash
docker compose up -d
```

### Step 4: Open

Go to `http://your-droplet-ip:3000` in your browser.

**That's it.** Database, AI pipeline, and dashboard are all running.

---

## First Time Setup (After Deploy)

1. **Go to Settings** (`/settings`)
   - Set daily visit target (e.g. 8)
   - Set WhatsApp group name
   - Set alert email + manager email

2. **Upload your first chat export** (`/connect`)
   - Open the sales WhatsApp group on your phone
   - Tap ⋮ → More → Export Chat → Without Media
   - Upload the .txt file on the Connect page
   - Dashboard populates automatically

3. **Connect WhatsApp for reports** (`/connect`)
   - Click "Connect WhatsApp"
   - Scan QR code with your phone
   - Now you can send daily reports to the team via WhatsApp

---

## Daily Usage

**Every evening at 8 PM:**

1. Export today's chat from WhatsApp group (.txt, without media)
2. Upload on the Connect page
3. AI processes all messages in ~30 seconds
4. Check dashboard for today's summary
5. Download Excel if needed
6. Reports auto-sent to WhatsApp + email (if configured)

---

## What You See

### Dashboard
- Total visits today
- Which reps reported, who didn't
- Who hit target, who's behind
- AI-generated daily summary
- Alerts: missing data, under-target, status changes

### Report
- Every visit as a card: school, board, strength, principal, remark
- Click to expand: full details, phone, book seller, location
- Filter by rep, navigate by date
- Download as Excel (same format you use today)

### Schools
- Every school visited, total visit count
- Click to see visit timeline
- Search by name

### Connect
- Upload WhatsApp chat export
- Connect WhatsApp for sending reports
- Step-by-step instructions included

---

## Environment Variables

| Variable | Required | What it does |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | **Yes** | Claude AI for extracting visit data |
| `DB_PASSWORD` | **Yes** | PostgreSQL database password |
| `DATABASE_URL` | Auto | Set by docker-compose automatically |
| `RESEND_API_KEY` | No | Email alerts (works without it, just no emails) |
| `APP_URL` | No | Your server URL (for email links) |

---

## Monthly Cost

| What | Cost |
|------|------|
| Digital Ocean Droplet (2GB) | $12/month |
| Claude AI (Haiku extraction) | ~₹165/month (~$2) |
| Email (Resend free tier) | Free |
| **Total** | **~$14/month** |

vs. 2-3 hours of manual data entry every day.

---

## Tech Details (For Developers)

**Stack:** Next.js 15, Tailwind CSS, Prisma, PostgreSQL, Claude Haiku/Sonnet, Baileys (WhatsApp), Resend

**Pipeline accuracy:** 99% field-level extraction on 20-record eval

**Architecture:**
```
Upload .txt → Preprocessor (noise filter + chunking)
           → Claude Haiku (structured extraction per visit)
           → Validator (required fields, target check)
           → School matcher (fuzzy name normalization)
           → PostgreSQL (visits, schools, alerts)
           → Dashboard + Email + WhatsApp reports
```

**API Routes:**

| Route | What |
|-------|------|
| `GET /api/dashboard` | Today's stats, alerts, team progress |
| `GET /api/reports/:date` | All visits for a date |
| `GET /api/reports/:date/excel` | Download Excel |
| `GET /api/schools` | All schools with visit counts |
| `GET /api/executives` | All reps with performance |
| `POST /api/ingest` | Process uploaded messages |
| `GET /api/ingest/status` | Last pipeline run stats |
| `POST /api/whatsapp/connect` | Start WhatsApp connection |
| `POST /api/whatsapp/send-report` | Send daily report via WhatsApp |
| `GET /api/settings` | App configuration |
| `POST /api/sheet-sync/run` | Manually run Google Sheet sync |
| `GET/POST /api/cron/sync-sheet` | Cron endpoint (Bearer `CRON_SECRET`) |
| `GET /api/health` | Health check |

**Local development:**
```bash
npm install
cp .env.example .env.local
# Set DATABASE_URL to a local PostgreSQL
npx prisma db push
npm run dev
```

---

## Google Sheets Auto-Fill (Zapier-style, zero Zapier)

Visits auto-append to a Google Sheet in real time as each WhatsApp chat is ingested. A nightly GitHub Actions cron re-runs sync as a safety net for anything missed (network blip, quota, etc.).

### One-time setup (~10 min)

**1. Create a Google service account**
- [console.cloud.google.com](https://console.cloud.google.com) → new project (or existing) → **Enable APIs** → enable **Google Sheets API**.
- **IAM & Admin → Service Accounts → Create**. Name it e.g. `sales-sync`.
- On the new account → **Keys → Add Key → JSON**. Downloads a `.json` file.

**2. Add credentials to `.env`**
Base64-encode the JSON to avoid newline escaping issues:
```bash
base64 -i path/to/service-account.json | tr -d '\n'
```
Add to `.env` on your server:
```
GOOGLE_SERVICE_ACCOUNT_JSON=<the base64 string>
CRON_SECRET=<any long random string>
```
Restart the app.

**3. Create the target Google Sheet**
- Make a new blank sheet.
- Go to **Settings → Google Sheets Auto-Fill** in the app → copy the service account email shown → **Share the sheet with that email as Editor**.
- Paste the sheet URL into the form, toggle **Enabled**, **Save**, click **Sync Now**.

The sheet auto-creates a `Visits` tab with 13 columns: Date, Employee Name, School Name, Address, Board, Strength, Principal Name, Principal Mobile, Principal DOB, Principal Email, Book Seller, Remark, Visit ID.

### How the automation fires

- **Real-time**: every `POST /api/ingest` triggers sync after the pipeline finishes. New visits appear in the sheet within seconds.
- **Nightly safety net**: `.github/workflows/sync-sheet.yml` runs at **21:00 IST** (15:30 UTC). Add `APP_URL` and `CRON_SECRET` to your repo secrets (Settings → Secrets and variables → Actions).
- **Idempotent**: each visit has a `sheetAppendedAt` timestamp in the DB. Sync only appends rows where that's null, so reruns are safe — no duplicate rows.
- **Manual**: Settings page has a **Sync Now** button that flushes pending rows immediately.

### Not using GitHub Actions?

Any scheduler that can hit an HTTP endpoint works. The cron endpoint is:
```
POST https://your-app/api/cron/sync-sheet
Authorization: Bearer <CRON_SECRET>
```
Drop-in alternatives: Vercel Cron, EasyCron, `crontab` on the droplet with `curl`, n8n if you must.

