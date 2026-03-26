# Production Release Checklist

## 1) Environment and Security

- [ ] `SUPABASE_DB_URL` / `DATABASE_URL` is set and points to production DB endpoint
- [ ] `ALLOW_NON_TRANSACTIONAL_FALLBACK` is **not** enabled in production
- [ ] TLS/cert chain for DB endpoint validated in production runtime
- [ ] Secrets rotated (see `docs/SECRETS-ROTATION.md`)

## 2) Functional Smoke Tests

- [ ] Upload -> Review flow loads products
- [ ] Status transitions: pending/approved/rejected/quarantine
- [ ] Commit of approved rows succeeds transactionally
- [ ] Quarantine page actions (approve/reject/return) work

## 3) Dashboard Verification

- [ ] Summary cards and trend chart show consistent counts
- [ ] Day bucket behavior around midnight matches `Europe/Prague`
- [ ] Alerts route to expected targets (pending/quarantine)

## 4) Automated Checks

- [ ] `npm run lint`
- [ ] `npm run test:parser`
- [ ] `npm run test:map-offers`
- [ ] `npm run test:quarantine`
- [ ] `npm run test:stabilization`
- [ ] `npm run build`

## 5) Post-deploy Validation

- [ ] Commit API responses include `tx_guarantee`
- [ ] No unexpected `fallback_used: "supabase-js"` in production
- [ ] No critical errors in server logs for first 30 min

