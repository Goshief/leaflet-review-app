#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "[bootstrap-runtime-gate] ERROR: $1" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command '$1'. Install it and retry."
}

require_cmd node
require_cmd npm

if [[ ! -f package-lock.json ]]; then
  fail "package-lock.json is missing. Use npm and commit lockfile for reproducible bootstrap."
fi

if [[ ! -d node_modules ]]; then
  echo "[bootstrap-runtime-gate] Installing dependencies via npm ci..."
  npm ci
fi

if [[ ! -f .env ]]; then
  fail "Missing .env. Copy .env.example to .env and fill required variables."
fi

required_env=(NEXT_PUBLIC_SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY)
for name in "${required_env[@]}"; do
  if ! grep -Eq "^${name}=" .env; then
    fail "Required env '${name}' is not declared in .env"
  fi
  value="$(grep -E "^${name}=" .env | tail -n1 | cut -d '=' -f2-)"
  if [[ -z "${value// }" ]]; then
    fail "Required env '${name}' is empty in .env"
  fi
done

set -a
source ./.env
set +a

echo "[bootstrap-runtime-gate] Checking DB connectivity and shopper tables..."
node scripts/test-shopper-db-connection.mjs || fail "Supabase shopper schema check failed. Verify migrations + NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY."

echo "[bootstrap-runtime-gate] Verifying required migrations exist..."
for f in \
  supabase/migrations/20250324120000_leaflet_admin.sql \
  supabase/migrations/20260412100000_shopper_mvp.sql
  do
  [[ -f "$f" ]] || fail "Missing migration file: $f"
done

echo "[bootstrap-runtime-gate] Running critical tests..."
npm run test:map-offers
npm run test:shopper-planner
npm run test:shopper-input-validation

echo "[bootstrap-runtime-gate] Starting app smoke check..."
PORT=3011 npm run dev >/tmp/leaflet-runtime-gate.log 2>&1 &
APP_PID=$!
cleanup() {
  kill "$APP_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:3011/api/health" >/tmp/leaflet-health.json 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! grep -q '"ok":true' /tmp/leaflet-health.json; then
  fail "Health endpoint did not return ok=true. See /tmp/leaflet-runtime-gate.log"
fi

echo "[bootstrap-runtime-gate] PASS"
