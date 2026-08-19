export type RetailerId = "lidl" | "kaufland" | "penny" | "billa" | "albert";

export type CheckStatus = "downloaded" | "asset_found" | "unchanged" | "error" | "skipped";

export type LearningObservation = {
  checked_at: string;
  status: CheckStatus;
  visited_url?: string | null;
};

export type RetailerLearningState = {
  version: 1;
  retailer: RetailerId;
  max_checks_per_week: 2;
  observations: LearningObservation[];
  weekday_download_hits: number[];
  preferred_weekdays: number[];
  confidence: number;
  last_check_at: string | null;
  last_visit_at: string | null;
  last_visit_url: string | null;
  last_downloaded_at: string | null;
  next_check_at: string | null;
  updated_at: string;
};

const MS_DAY = 86_400_000;
const DEFAULT_EXPLORATION_DAYS = [1, 4];

function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / MS_DAY) + 1) / 7);
  return `${d.getUTCFullYear()}-${String(week).padStart(2, "0")}`;
}

function weekdayPrague(iso: string): number {
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Prague",
    weekday: "short",
  }).format(new Date(iso));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(text);
}

function nextPreferredDate(from: Date, weekdays: number[]): Date {
  const start = new Date(from.getTime() + 6 * 60 * 60 * 1000);
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(start.getTime() + offset * MS_DAY);
    const weekday = weekdayPrague(candidate.toISOString());
    if (weekdays.includes(weekday)) {
      candidate.setUTCHours(7, 13, 0, 0);
      return candidate;
    }
  }
  return new Date(start.getTime() + 3 * MS_DAY);
}

export function emptyLearningState(retailer: RetailerId): RetailerLearningState {
  const now = new Date();
  return {
    version: 1,
    retailer,
    max_checks_per_week: 2,
    observations: [],
    weekday_download_hits: [0, 0, 0, 0, 0, 0, 0],
    preferred_weekdays: DEFAULT_EXPLORATION_DAYS,
    confidence: 0,
    last_check_at: null,
    last_visit_at: null,
    last_visit_url: null,
    last_downloaded_at: null,
    next_check_at: nextPreferredDate(now, DEFAULT_EXPLORATION_DAYS).toISOString(),
    updated_at: now.toISOString(),
  };
}

export function recordObservation(
  previous: RetailerLearningState | null,
  retailer: RetailerId,
  status: CheckStatus,
  checkedAt = new Date().toISOString(),
  visitedUrl: string | null = null,
): RetailerLearningState {
  const state = previous ?? emptyLearningState(retailer);
  const observations = [...state.observations, { checked_at: checkedAt, status, visited_url: visitedUrl }].slice(-32);
  const hits = [...state.weekday_download_hits];
  if (status === "downloaded") {
    const day = weekdayPrague(checkedAt);
    if (day >= 0) hits[day] = (hits[day] ?? 0) + 1;
  }

  const ranked = hits
    .map((score, day) => ({ day, score }))
    .sort((a, b) => b.score - a.score || a.day - b.day);
  const totalDownloads = hits.reduce((a, b) => a + b, 0);
  const preferred = totalDownloads >= 2
    ? ranked.filter((x) => x.score > 0).slice(0, 2).map((x) => x.day)
    : DEFAULT_EXPLORATION_DAYS;
  const best = ranked[0]?.score ?? 0;
  const confidence = totalDownloads === 0 ? 0 : Math.min(1, best / Math.max(2, totalDownloads));
  const now = new Date(checkedAt);

  return {
    ...state,
    observations,
    weekday_download_hits: hits,
    preferred_weekdays: preferred.length ? preferred : DEFAULT_EXPLORATION_DAYS,
    confidence,
    last_check_at: checkedAt,
    last_visit_at: visitedUrl ? checkedAt : (state.last_visit_at ?? null),
    last_visit_url: visitedUrl || state.last_visit_url || null,
    last_downloaded_at: status === "downloaded" ? checkedAt : state.last_downloaded_at,
    next_check_at: nextPreferredDate(now, preferred.length ? preferred : DEFAULT_EXPLORATION_DAYS).toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function shouldVisitRetailer(state: RetailerLearningState | null, now = new Date()): {
  due: boolean;
  reason: string;
  checks_this_week: number;
} {
  if (!state) return { due: true, reason: "no_learning_state", checks_this_week: 0 };
  const currentWeek = isoWeekKey(now);
  const checksThisWeek = state.observations.filter((x) => isoWeekKey(new Date(x.checked_at)) === currentWeek && x.status !== "skipped").length;
  if (checksThisWeek >= state.max_checks_per_week) {
    return { due: false, reason: "weekly_limit_reached", checks_this_week: checksThisWeek };
  }
  if (state.next_check_at && now.getTime() < new Date(state.next_check_at).getTime()) {
    return { due: false, reason: "not_due_yet", checks_this_week: checksThisWeek };
  }
  return { due: true, reason: "due", checks_this_week: checksThisWeek };
}
