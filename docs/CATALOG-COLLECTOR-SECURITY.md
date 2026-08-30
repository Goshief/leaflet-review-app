# Catalog collector security boundary

The collector only requests public HTTPS resources on `billa.cz`. It does not use customer sessions, retailer accounts, CAPTCHA bypasses, or protected endpoints. The current `robots.txt` is fetched and evaluated before product crawling.

RAW retailer responses are stored in the private Supabase `catalog-raw` bucket. Catalog tables have RLS enabled and revoke `anon` and `authenticated` privileges; collector writes use the existing server-only service-role client.

The cron endpoint requires `CRON_SECRET` and returns an error instead of running when the secret is absent.
