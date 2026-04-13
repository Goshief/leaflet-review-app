# Production Release Checklist

## 1) Environment and Security

- [ ] `SUPABASE_DB_URL` / `DATABASE_URL` is set and points to production DB endpoint
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` configured
- [ ] `ALLOW_NON_TRANSACTIONAL_FALLBACK` is **not** enabled in production
- [ ] TLS/cert chain for DB endpoint validated in production runtime
- [ ] Secrets rotated (see `docs/SECRETS-ROTATION.md`)
- [ ] `npm run runtime:gate` pass on clean checkout with production-like env

## 2) Functional Smoke Tests (Admin ingestion)

- [ ] Upload -> Review flow loads products
- [ ] Status transitions: pending/approved/rejected/quarantine
- [ ] Commit of approved rows succeeds transactionally
- [ ] Quarantine page actions (approve/reject/return) work

## 3) Shopper MVP Smoke Tests

- [ ] Browser session sets `cart_session` cookie before shopper API usage

- [ ] `POST /api/shopper/cart` creates/fetches active cart
- [ ] `POST /api/shopper/cart/items` adds cart item
- [ ] `PATCH /api/shopper/cart/items/:itemId` updates quantity
- [ ] `POST /api/shopper/plan` generates/recomputes active plan
- [ ] `GET /api/shopper/savings` returns baseline/optimized/savings summary
- [ ] Shopper planner uses only committed `offers_raw` data

## 4) Dashboard Verification

- [ ] Summary cards and trend chart show consistent counts
- [ ] Day bucket behavior around midnight matches `Europe/Prague`
- [ ] Alerts route to expected targets (pending/quarantine)

## 5) Automated Checks

- [ ] `npm run test:shopper-db-connection`
- [ ] `npm run test:map-offers`
- [ ] `npm run test:shopper-planner`
- [ ] `npm run test:shopper-input-validation`
- [ ] `npm run build`

## 6) Post-deploy Validation

- [ ] Commit API responses include `tx_guarantee`
- [ ] No unexpected `fallback_used: "supabase-js"` in production
- [ ] No critical errors in server logs for first 30 min
- [ ] `/api/health` returns `{ ok: true, status: "ok" }`

## 7) Quarantine route contract (Bod #1) — production

Před označením bodu #1 za hotový ověř na **produkční URL** (ne jen lokálně):

- [ ] Vercel **Root Directory** = `parser/leaflet-review-app` (při monorepu v kořeni repo)
- [ ] Nasazená větev obsahuje commit s `app/quarantine/page.tsx` (DB-first, žádný `LocalQuarantine` na `/quarantine`) a `app/quarantine/local/page.tsx`
- [ ] `GET /quarantine/local` → **200**, viditelný `data-testid="quarantine-local-banner"` (text o tom, že to není DB)
- [ ] `GET /quarantine` → **ne** starý text „Lokální režim (bez Supabase)“ jako hlavní obsah celé stránky; buď DB výpis / empty / not-configured / error podle env
- [ ] `npm run build` v `parser/leaflet-review-app` v build výpisu obsahuje řádky `ƒ /quarantine` a `ƒ /quarantine/local`
- [ ] `npm run test:e2e:quarantine-db-route` proti produkci nebo stagingu s platným `PLAYWRIGHT_BASE_URL`
