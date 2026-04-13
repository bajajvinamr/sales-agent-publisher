# Sales Tracker — WhatsApp Field Team Intelligence

Parse WhatsApp field rep messages into structured school visit data. AI-powered dashboard with team performance tracking, alerts, and weekly digests.

![Dashboard Screenshot](docs/screenshot.png)

---

## What it does

- Reads WhatsApp group messages from your field sales team
- Claude Haiku extracts structured visit data: school name, board, principal, discussion topics, next steps
- Dashboard shows rep performance, visit streaks, missing-data alerts, and school pipeline
- Resend sends email alerts for incomplete entries and weekly digest summaries

---

## Quick Start (Local)

```bash
git clone <repo-url>
cd whatsapp-sales-agent
cp .env.example .env        # fill in ANTHROPIC_API_KEY + DB_PASSWORD
docker compose up -d
open http://localhost:3000
```

Migrations run automatically on first start via `prisma db push`.

---

## Quick Start (Digital Ocean Droplet)

1. Create a Droplet — Ubuntu 22.04, 2 GB RAM, $12/mo
2. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
3. Clone and configure:
   ```bash
   git clone <repo-url> && cd whatsapp-sales-agent
   cp .env.example .env
   nano .env   # set ANTHROPIC_API_KEY, DB_PASSWORD, APP_URL
   ```
4. Start:
   ```bash
   docker compose up -d
   ```
5. Access at `http://your-droplet-ip:3000`

> For HTTPS, put Nginx + Certbot in front of port 3000.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | Yes | Claude API key for extraction + summaries |
| `DB_PASSWORD` | Yes (Docker) | Postgres password used by docker-compose |
| `RESEND_API_KEY` | No | Email alerts via Resend (falls back to console log) |
| `APP_PASSWORD` | No | Simple password gate for the dashboard |
| `APP_URL` | No | Public URL for email links (default: http://localhost:3000) |

---

## Architecture

```
WhatsApp message
      ↓
  /api/ingest          — receives raw message text
      ↓
  Preprocessor         — normalises, strips noise
      ↓
  Claude Haiku         — extracts structured visit fields
      ↓
  Validator (Zod)      — enforces schema, flags missing fields
      ↓
  PostgreSQL (Prisma)  — stores visits, schools, reps
      ↓
  Dashboard            — Next.js UI, real-time table + charts
      ↓
  Resend alerts        — missing data notifications + weekly digest
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), Tailwind CSS, shadcn/ui |
| Backend | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL 16 |
| AI — Extraction | Claude Haiku (fast, cheap, structured output) |
| AI — Summaries | Claude Sonnet (weekly digest, exec reports) |
| Email | Resend |
| Deployment | Docker + docker-compose |

---

## Cost Estimate

| Service | Usage | Cost |
|---------|-------|------|
| Claude Haiku | ~30 visits/day, ~500 tokens each | ~₹165/month |
| Claude Sonnet | Weekly digests only | ~₹20/month |
| DO Droplet (2 GB) | Always-on | ~$6/month |
| Resend | <100 emails/day | Free tier |

**Total: ~$8/month**

---

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/ingest` | Ingest raw WhatsApp message, trigger extraction |
| `GET` | `/api/dashboard` | Aggregated metrics for dashboard |
| `GET` | `/api/schools` | School list with visit history |
| `GET/POST` | `/api/alerts` | Alert rules and manual trigger |
| `GET` | `/api/reports` | Weekly/monthly rep performance reports |
| `GET` | `/api/executives` | Exec-level summary data |
| `GET` | `/api/export` | CSV export of visit data |
| `GET/POST` | `/api/settings` | App configuration |
| `GET` | `/api/whatsapp` | WhatsApp connection status |

---

## Development

```bash
npm install
cp .env.example .env.local   # use local DB or set DATABASE_URL
npx prisma db push
npm run dev
```
