#!/bin/bash
# Sales Tracker — One-command setup for Digital Ocean
set -e

echo "═══════════════════════════════════════════════"
echo " Sales Tracker — Setup"
echo "═══════════════════════════════════════════════"
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    echo "Docker installed."
fi

# Check .env
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  Created .env file. You MUST edit it before starting:"
    echo ""
    echo "   nano .env"
    echo ""
    echo "   Required:"
    echo "   - ANTHROPIC_API_KEY (get from console.anthropic.com)"
    echo "   - DB_PASSWORD (pick any strong password)"
    echo ""
    echo "   Optional:"
    echo "   - RESEND_API_KEY (for email alerts)"
    echo "   - APP_URL (your server's public URL)"
    echo ""
    echo "After editing .env, run this script again."
    exit 0
fi

# Check required env vars
source .env
if [ -z "$ANTHROPIC_API_KEY" ] || [ "$ANTHROPIC_API_KEY" = "sk-ant-..." ]; then
    echo "❌ ANTHROPIC_API_KEY not set in .env"
    echo "   Get your key from console.anthropic.com"
    exit 1
fi

if [ -z "$DB_PASSWORD" ] || [ "$DB_PASSWORD" = "changeme" ]; then
    echo "❌ DB_PASSWORD not set in .env (don't use 'changeme')"
    exit 1
fi

echo "✅ Environment configured"

# Start
echo ""
echo "Starting Sales Tracker..."
docker compose up -d --build

echo ""
echo "Waiting for database..."
sleep 5

echo ""
echo "═══════════════════════════════════════════════"
echo " ✅ Sales Tracker is running!"
echo ""
echo " Dashboard:  http://$(hostname -I | awk '{print $1}'):3000"
echo " Health:     http://$(hostname -I | awk '{print $1}'):3000/api/health"
echo ""
echo " Next steps:"
echo " 1. Open the dashboard in your browser"
echo " 2. Go to Settings → configure targets + emails"
echo " 3. Go to Connect → upload a WhatsApp chat export"
echo "═══════════════════════════════════════════════"
