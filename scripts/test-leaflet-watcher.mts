import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverLeafletAssets } from "../lib/leaflet-monitor/discovery.ts";
import {
  identityFromAsset,
  isDuplicateLeaflet,
  runLeafletWatchPass,
  selectWatchableAssets,
  type LeafletIdentity,
} from "../lib/leaflet-monitor/leaflet-identity.ts";
import {
  getWatcherCronSchedule,
  getWatcherIntervalHours,
  isWatchedRetailer,
  isWatcherCheckDue,
  WATCHED_RETAILERS,
  WATCHER_CRON_SCHEDULES,
} from "../lib/leaflet-monitor/watcher-config.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function identity(partial: Partial<LeafletIdentity> & Pick<LeafletIdentity, "retailer">): LeafletIdentity {
  return {
    canonical_source_url: null,
    pdf_url: null,
    valid_from: null,
    valid_to: null,
    external_id: null,
    content_hash: null,
    ...partial,
  };
}

{
  assert.deepEqual([...WATCHED_RETAILERS], ["billa", "lidl", "kaufland", "penny"]);
  assert.equal(isWatchedRetailer("billa"), true);
  assert.equal(isWatchedRetailer("albert"), false);
  assert.equal(getWatcherIntervalHours({} as NodeJS.ProcessEnv), 2);
  assert.equal(getWatcherIntervalHours({ LEAFLET_WATCHER_INTERVAL_HOURS: "4" } as NodeJS.ProcessEnv), 4);
  assert.equal(getWatcherIntervalHours({ LEAFLET_WATCHER_INTERVAL_HOURS: "nope" } as NodeJS.ProcessEnv), 2);
}

{
  const now = new Date("2026-08-31T12:00:00.000Z");
  assert.equal(isWatcherCheckDue(null, now, 2).due, true);
  assert.equal(isWatcherCheckDue("2026-08-31T10:00:00.000Z", now, 2).due, true);
  assert.equal(isWatcherCheckDue("2026-08-31T11:00:00.000Z", now, 2).due, false);
  assert.equal(isWatcherCheckDue("2026-08-31T11:00:00.000Z", now, 2).reason, "interval_not_elapsed");
}

{
  const known: LeafletIdentity[] = [
    identity({
      retailer: "billa",
      canonical_source_url: "https://view.publitas.com/billa-cz/old-letak",
      pdf_url: "https://cdn.example/old.pdf",
      content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      external_id: "old-letak",
      valid_from: "2026-08-05",
      valid_to: "2026-08-11",
    }),
  ];
  const registryBefore = JSON.parse(JSON.stringify(known));

  const sameBytesNewUrl = identity({
    retailer: "billa",
    canonical_source_url: "https://view.publitas.com/billa-cz/new-cdn-path",
    pdf_url: "https://cdn.example/new-name.pdf",
    content_hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    external_id: "new-cdn-path",
  });
  assert.equal(isDuplicateLeaflet(known[0]!, sameBytesNewUrl), true);

  const sameUrl = identity({
    retailer: "billa",
    canonical_source_url: "https://view.publitas.com/billa-cz/old-letak",
    pdf_url: "https://cdn.example/moved.pdf",
    content_hash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
  assert.equal(isDuplicateLeaflet(known[0]!, sameUrl), true);

  const sameExternal = identity({
    retailer: "billa",
    canonical_source_url: "https://view.publitas.com/billa-cz/old-letak?v=2",
    external_id: "old-letak",
  });
  assert.equal(isDuplicateLeaflet(known[0]!, sameExternal), true);

  const genuinelyNew = identity({
    retailer: "billa",
    canonical_source_url: "https://view.publitas.com/billa-cz/fresh-week",
    pdf_url: "https://cdn.example/fresh.pdf",
    content_hash: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    external_id: "fresh-week",
    valid_from: "2026-08-12",
    valid_to: "2026-08-18",
  });
  assert.equal(isDuplicateLeaflet(known[0]!, genuinelyNew), false);

  const pipeline: string[] = [];
  const pass = runLeafletWatchPass({
    retailer: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    checked_at: "2026-08-31T12:00:00.000Z",
    known,
    discovered: [sameBytesNewUrl, sameUrl, genuinelyNew],
  });
  for (const leaflet of pass.new_leaflets) pipeline.push(leaflet.content_hash || leaflet.canonical_source_url || "unknown");

  assert.equal(pass.found_leaflets_count, 3);
  assert.equal(pass.new_leaflets_count, 1);
  assert.deepEqual(pipeline, ["cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]);
  assert.equal(pass.duplicates.length, 2);
  assert.deepEqual(pass.errors, []);
  assert.equal(pass.retailer, "billa");
  assert.equal(pass.source_url, "https://www.billa.cz/letaky-billa/velky-letak");
  assert.equal(pass.checked_at, "2026-08-31T12:00:00.000Z");

  const failed = runLeafletWatchPass({
    retailer: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    checked_at: "2026-08-31T14:00:00.000Z",
    known: registryBefore,
    discovered: [genuinelyNew],
    source_error: "billa source HTTP 503",
  });
  assert.equal(failed.found_leaflets_count, 0);
  assert.equal(failed.new_leaflets_count, 0);
  assert.deepEqual(failed.errors, ["billa source HTTP 503"]);
  assert.deepEqual(failed.known_after, registryBefore);
}

{
  const html = `
    <a href="https://view.publitas.com/billa-cz/letak-a.pdf">Aktuální leták 5.8.2026-11.8.2026 stáhnout pdf</a>
    <a href="https://view.publitas.com/billa-cz/letak-b.pdf">Velký leták 12.8.2026-18.8.2026 stáhnout pdf</a>
    <a href="/privacy">Soukromí</a>
  `;
  const assets = discoverLeafletAssets(html, "https://www.billa.cz/letaky-billa/velky-letak", "billa", new Date("2026-08-31T12:00:00Z"));
  const watchable = selectWatchableAssets("billa", assets);
  assert.ok(watchable.length >= 2, `expected multiple leaflets, got ${watchable.length}`);
  const identities = watchable.map((asset) => identityFromAsset("billa", asset));
  const emptyPass = runLeafletWatchPass({
    retailer: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    checked_at: "2026-08-31T12:00:00.000Z",
    known: [],
    discovered: identities,
  });
  assert.equal(emptyPass.found_leaflets_count, identities.length);
  assert.equal(emptyPass.new_leaflets_count, identities.length);
  const secondPass = runLeafletWatchPass({
    retailer: "billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    checked_at: "2026-08-31T14:00:00.000Z",
    known: emptyPass.known_after,
    discovered: identities,
  });
  assert.equal(secondPass.new_leaflets_count, 0);
}

{
  const vercel = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  for (const retailer of WATCHED_RETAILERS) {
    const cron = vercel.crons.find((row) => row.path === `/api/cron/fetch-${retailer}-leaflet`);
    assert.ok(cron, `missing vercel cron for ${retailer}`);
    assert.equal(cron!.schedule, WATCHER_CRON_SCHEDULES[retailer]);
    assert.equal(getWatcherCronSchedule(retailer), WATCHER_CRON_SCHEDULES[retailer]);
  }
  assert.equal(vercel.crons.some((row) => row.path.includes("albert-leaflet")), false);
}

console.log("PASS leaflet watcher: 2h cadence, identity dedup, mock discovery, source-error keeps registry");
