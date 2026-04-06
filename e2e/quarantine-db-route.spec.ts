/**
 * Guard: /quarantine = DB-first route contract.
 *
 * - `/quarantine` nesmí renderovat lokální karanténu jako hlavní obsah (žádný local-first fallback).
 * - `/quarantine/local` má explicitní banner a není náhrada za DB.
 *
 * Varianta C (missing env): pokud v CI není Supabase, `/quarantine` ukáže `quarantine-db-not-configured`
 * místo `quarantine-db-page` — test stále ověří, že route není local-first.
 */
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

async function skipIfPlaywrightBaseWrong(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

async function getStats(request: APIRequestContext) {
  const res = await request.get("/api/stats");
  if (!res.ok()) return null;
  const j = (await res.json()) as { ok?: boolean };
  return j.ok === true ? j : null;
}

test.describe("Quarantine DB route contract", () => {
  test("/quarantine není local-first fallback; /quarantine/local má disclaimer", async ({
    page,
    request,
  }) => {
    await skipIfPlaywrightBaseWrong(page);

    {
      const localProbe = await request.get("/quarantine/local");
      expect(
        localProbe.status(),
        "/quarantine/local musí existovat (jinak 404 = route nenasazená nebo chybí app/quarantine/local/page.tsx)"
      ).toBe(200);
    }

    await page.goto("/quarantine");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    await expect(page.getByTestId("quarantine-local-page")).toHaveCount(0);
    await expect(page.getByTestId("quarantine-local-banner")).toHaveCount(0);

    const hasDb = (await getStats(request)) != null;

    if (hasDb) {
      await expect(
        page.locator(
          '[data-testid="quarantine-db-page"], [data-testid="quarantine-db-empty"], [data-testid="quarantine-db-error"]'
        ).first()
      ).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByTestId("quarantine-db-not-configured")).toBeVisible();
    }

    await page.goto("/quarantine/local");
    await expect(page.getByTestId("quarantine-local-page")).toBeVisible();
    await expect(page.getByTestId("quarantine-local-banner")).toBeVisible();
    await expect(page.getByTestId("quarantine-local-banner")).toContainText(/není databázová karanténa/i);
  });
});
