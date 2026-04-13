# Environment Bootstrap Unblock

## Required stack

- Node.js 20+
- npm 10+
- Reachable PostgreSQL/Supabase transactional endpoint (`SUPABASE_DB_URL`)

## Fresh checkout bootstrap

1. `npm ci`
2. `cp .env.example .env`
3. Fill:
   - `SUPABASE_DB_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Run runtime gate:
   - `npm run runtime:gate`

## What runtime gate validates

- command prerequisites (`node`, `npm`)
- lockfile presence
- dependency install
- required Supabase env var declaration and non-empty values
- Supabase connectivity/schema smoke (`test:shopper-db-connection`)
- presence of critical migrations
- critical tests (`test:map-offers`, `test:shopper-planner`, `test:shopper-input-validation`)
- app startup + `/api/health` probe

## Deterministic failures

Runtime gate exits non-zero with clear message for each missing dependency.
