import type { RetailerId } from "./learning";

export const WATCHED_RETAILERS = [
  "albert",
  "billa",
  "dm",
  "globus",
  "kaufland",
  "kosik",
  "lidl",
  "penny",
  "rohlik",
  "rossmann",
  "tesco",
  "teta",
] as const;
export type WatchedRetailerId = (typeof WATCHED_RETAILERS)[number];

export const DEFAULT_WATCHER_INTERVAL_HOURS = 2;
export const WATCHER_ASSET_LIMIT = 12;

/** Daily UTC schedules. Vercel Hobby allows daily cron cadence. */
export const WATCHER_CRON_SCHEDULES: Record<WatchedRetailerId, string> = {
  kaufland: "13 7 * * *",
  lidl: "17 7 * * *",
  penny: "23 7 * * *",
  billa: "29 7 * * *",
  albert: "35 7 * * *",
  globus: "41 7 * * *",
  rossmann: "47 7 * * *",
  tesco: "53 7 * * *",
  teta: "59 7 * * *",
  dm: "5 8 * * *",
  kosik: "11 8 * * *",
  rohlik: "17 8 * * *",
};

export function isWatchedRetailer(id: string): id is WatchedRetailerId {
  return (WATCHED_RETAILERS as readonly string[]).includes(id);
}

export function getWatcherCronSchedule(retailer: WatchedRetailerId): string {
  return WATCHER_CRON_SCHEDULES[retailer];
}

export function getWatcherIntervalHours(env = process.env): number {
  const raw = env.LEAFLET_WATCHER_INTERVAL_HOURS?.trim();
  const parsed = raw ? Number(raw) : DEFAULT_WATCHER_INTERVAL_HOURS;
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WATCHER_INTERVAL_HOURS;
  return parsed;
}

export function nextWatcherCheckAt(checkedAt: string, intervalHours = getWatcherIntervalHours()): string {
  return new Date(new Date(checkedAt).getTime() + intervalHours * 60 * 60 * 1000).toISOString();
}

export function isWatcherCheckDue(
  lastCheckAt: string | null | undefined,
  now = new Date(),
  intervalHours = getWatcherIntervalHours(),
): { due: boolean; reason: string; next_check_at: string } {
  const nextFromNow = nextWatcherCheckAt(now.toISOString(), intervalHours);
  if (!lastCheckAt) return { due: true, reason: "never_checked", next_check_at: nextFromNow };
  const last = new Date(lastCheckAt).getTime();
  if (!Number.isFinite(last)) return { due: true, reason: "invalid_last_check", next_check_at: nextFromNow };
  const next = last + intervalHours * 60 * 60 * 1000;
  if (now.getTime() >= next) {
    return { due: true, reason: "interval_elapsed", next_check_at: nextWatcherCheckAt(now.toISOString(), intervalHours) };
  }
  return { due: false, reason: "interval_not_elapsed", next_check_at: new Date(next).toISOString() };
}

export function applyWatcherNextCheck(
  retailer: RetailerId,
  lastCheckAt: string,
  intervalHours = getWatcherIntervalHours(),
): string | null {
  if (!isWatchedRetailer(retailer)) return null;
  return nextWatcherCheckAt(lastCheckAt, intervalHours);
}
