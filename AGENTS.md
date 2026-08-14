<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cursor Cloud specific instructions

Product: `leaflet-review-app` ("Letáky Admin") — a Next.js 16 / React 19 operator tool that turns Czech supermarket leaflets (PDF/image) into structured offers for the Šetřík price-comparison product. It is a single process serving both the UI and all `/api/*` route handlers.

Runtime: Node.js 22 is required. Test scripts run `.mts` files via `node --experimental-strip-types`, which needs Node ≥ 22.6.

Standard commands (defined in `package.json`):
- Dev server: `npm run dev` → http://localhost:3001 (NOT 3000; port 3000 is the parent Šetřík monorepo).
- Lint: `npm run lint`.
- Tests: `npm run verify` runs the full suite of ~32 `test:*` scripts. These are self-contained (in-memory/mock data) and need no database or network. E2E (`npm run test:e2e`) uses Playwright and requires browsers to be installed (`npx playwright install`).
- Build: `npm run build`. `npm run preview`/`deploy` target Cloudflare via OpenNext and are not needed for local dev.

Auth gating (important for testing): every admin page (except `/`) and most `/api/*` routes are gated by Supabase Auth + an `app_metadata.role` of `operator`/`admin` (see `lib/auth/access-matrix.ts`). Without Supabase env vars, only these work: `/`, `/login`, `/logout`, `/forbidden`, and `GET /api/setrik/offers`. Any protected page redirects to `/login`; protected APIs return 401. So the upload→extract→review→commit pipeline cannot be exercised without credentials.

To run the full pipeline you need a hosted Supabase project (this repo has no local Supabase config; `supabase/migrations/` holds the schema): set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `_ANON_KEY`), and `SUPABASE_SERVICE_ROLE_KEY`; apply the migrations; and provision an `operator`/`admin` user (role must be set in `app_metadata`, outside the app). Transactional commit additionally uses `SUPABASE_DB_URL`/`DATABASE_URL`. Copy `.env.example` to `.env` as a starting point.

Extraction providers are optional: with no `OPENAI_API_KEY`/`GEMINI_API_KEY`, extraction returns an 8-row mock, so the review UI still works. PDF preview renders via a pdf.js worker fetched from the unpkg CDN (needs outbound network); image uploads do not.

Non-obvious gotcha: `next dev`/`next build` auto-generates and rewrites the `<!-- BEGIN:nextjs-agent-rules -->` block at the top of `AGENTS.md` (and `CLAUDE.md`) on every run. Commit those files to keep the tree clean, and keep custom notes (like this section) below the `END` marker so they are preserved.
