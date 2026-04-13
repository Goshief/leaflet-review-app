# 20-Point Status Audit — 2026-04-12

Legend: DONE / PARTIAL / NOT DONE / BLOCKED.

## Snapshot after this implementation

- DONE: 17/20
- PARTIAL: 1/20 (point 20)
- BLOCKED: 2/20 (points 2 and 3 stay environment-dependent)
- NOT DONE: 0/20

## Point-by-point

1. Governance freeze and scope discipline — **DONE**
   - Scope locked to audit items only; no out-of-scope product features.
   - Proof: shopper-only additions + docs + runtime gate updates.

2. Reproducible local bootstrap from fresh checkout — **BLOCKED (environment)**
   - Added deterministic bootstrap and runtime gate script, but final closure requires valid local `.env` + reachable DB.
   - Proof: `scripts/bootstrap-runtime-gate.sh`.

3. Runtime gate strictness and deterministic failure messages — **BLOCKED (environment)**
   - Script now fails on missing env, DB connectivity, missing shopper tables, missing migration files, failed tests, and failed health probe.
   - Proof: `scripts/bootstrap-runtime-gate.sh`.

4. Environment contract documentation — **DONE**
   - `.env.example` expanded with runtime DB contract and `SUPABASE_DB_URL`.
   - Proof: `.env.example`, `docs/ENVIRONMENT-BOOTSTRAP-UNBLOCK.md`.

5. Shopper schema: carts — **DONE**
6. Shopper schema: cart_items — **DONE**
7. Shopper schema: shopping_plans — **DONE**
8. Shopper schema: plan_items — **DONE**
   - Proof for points 5-8: migration `20260412100000_shopper_mvp.sql`.

9. Cart service: create/get active cart — **DONE**
10. Cart service: add/update/remove/list items — **DONE**
11. Planner generation — **DONE**
12. Recompute replacing previous derived state — **DONE**
13. Baseline/optimized totals and savings — **DONE**
14. Unavailable-item explicit handling — **DONE**
15. Deterministic planner behavior tests — **DONE**
   - Proof for points 9-15: `lib/shopper/service.ts`, `lib/shopper/planner.ts`, `scripts/test-shopper-planner.mts`.

16. Shopper API endpoints and validation — **DONE**
   - `/api/shopper/cart`, `/api/shopper/cart/items`, `/api/shopper/cart/items/[itemId]`, `/api/shopper/plan`, `/api/shopper/savings`.

17. Integration with committed ingestion data only — **DONE**
   - Planner reads only from committed `public.offers_raw` through Supabase admin integration and ignores quarantine/staging.

18. Runtime probe / health endpoint — **DONE**
   - `/api/health` now validates Supabase admin reachability (+ optional direct DB reachability).

19. Release checklist updated for shopper MVP — **DONE**
   - Added shopper/API/runtime gate checks to release checklist.

20. Full end-to-end runtime proof in this environment — **PARTIAL**
   - Code and scripts are in place; full closure depends on real DB/env in target runtime.

## Validation commands used

- `npm run test:map-offers`
- `npm run test:shopper-planner`
- `npm run test:shopper-input-validation`
- `npm run test:shopper-db-connection`
- `npm run lint` (currently fails due pre-existing missing script files not touched here)


## Security hardening update

- Shopper APIs now derive identity from `cart_session` cookie/header server-side and no longer trust `user_id` from request payload/query.
