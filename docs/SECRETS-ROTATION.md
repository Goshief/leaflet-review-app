# Secrets Rotation List

Rotate these secrets before production cutover:

1. `SUPABASE_SERVICE_ROLE_KEY` (highest priority)
2. `SUPABASE_DB_URL` / `DATABASE_URL` credentials
3. `OPENAI_API_KEY`
4. `GEMINI_API_KEY`
5. Any temporary deployment tokens used in CI/CD or Vercel CLI sessions

## Rotation Procedure (minimal)

1. Generate new secret in provider console.
2. Update production environment variables.
3. Deploy and verify health endpoints + commit flow.
4. Revoke old secret.
5. Confirm logs contain no auth failures for 15-30 minutes.

