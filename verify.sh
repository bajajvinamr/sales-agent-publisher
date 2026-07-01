#!/usr/bin/env bash
# verify.sh — local definition-of-done gate for sales-agent-publisher.
#
# Mirrors .github/workflows/ci.yml (check + build jobs) so a green local run
# predicts a green CI run. Exits non-zero if ANY blocking check fails.
# Stub env vars below match ci.yml exactly — no real DB / API key needed,
# and no .env file is read or modified by this script.
#
# The full gate (including remote checks on the DO droplet) is in DONE.md.

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RESULTS=()
FAILED=0

run_check() {
  local name="$1"; shift
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "  CHECK: ${name}"
  echo "════════════════════════════════════════════════════"
  if "$@"; then
    RESULTS+=("PASS  ${name}")
  else
    RESULTS+=("FAIL  ${name}")
    FAILED=1
  fi
}

run_check_nonblocking() {
  local name="$1"; shift
  echo ""
  echo "════════════════════════════════════════════════════"
  echo "  CHECK: ${name} (non-blocking, matches CI continue-on-error)"
  echo "════════════════════════════════════════════════════"
  if "$@"; then
    RESULTS+=("PASS  ${name}")
  else
    RESULTS+=("WARN  ${name} (non-blocking)")
  fi
}

# ── Preconditions ────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  echo "FATAL: node_modules missing — run 'npm ci' first." >&2
  exit 2
fi

# ── Gate (mirrors ci.yml "check" job) ────────────────────────────────
# 1. Prisma client must exist for tsc to pass (no DB connection needed).
run_check "prisma generate" npx prisma generate

# 2. Schema validation — stub DATABASE_URL, same as CI.
run_check "prisma validate" env \
  DATABASE_URL="postgresql://stub:stub@localhost:5432/stub" \
  npx prisma validate

# 3. Typecheck.
run_check "typecheck (tsc --noEmit)" npx tsc --noEmit

# 4. Unit tests (vitest).
run_check "tests (vitest run)" npm test

# 5. ESLint — CI runs this with continue-on-error, so non-blocking here too.
run_check_nonblocking "lint (next lint)" npm run lint

# ── Gate (mirrors ci.yml "build" job) ────────────────────────────────
# 6. Production build with dummy env, same as CI. Does NOT touch .env.
run_check "build (next build)" env \
  DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" \
  ANTHROPIC_API_KEY="dummy" \
  npx next build

# NOTE: ci.yml also runs a docker build job. Not replicated locally —
# requires Docker running; CI covers it on every PR/push.

# ── Summary ──────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
echo "  VERIFY SUMMARY — sales-agent-publisher"
echo "════════════════════════════════════════════════════"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo ""
if [ "$FAILED" -ne 0 ]; then
  echo "  RESULT: FAIL — do not deploy. See DONE.md for the full gate."
  exit 1
fi
echo "  RESULT: PASS (local gate). Remote droplet checks remain — see DONE.md."
exit 0
