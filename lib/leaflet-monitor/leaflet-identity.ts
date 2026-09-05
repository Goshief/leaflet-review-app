import type { RetailerId } from "./learning";
import type { LeafletAsset } from "./discovery";

export type LeafletIdentity = {
  retailer: string;
  canonical_source_url: string | null;
  pdf_url: string | null;
  valid_from: string | null;
  valid_to: string | null;
  external_id: string | null;
  content_hash: string | null;
};

export type WatchCheckLog = {
  retailer: string;
  checked_at: string;
  source_url: string;
  found_leaflets_count: number;
  new_leaflets_count: number;
  errors: string[];
};

export function canonicalLeafletUrl(retailer: RetailerId | string, rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    if (retailer === "lidl") {
      url.pathname = url.pathname.replace(/\/view\/flyer\/page\/\d+\/?$/i, "/view/flyer");
      url.search = "";
    } else if (retailer === "kaufland" || retailer === "penny") {
      url.search = "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

export function canonicalizePdfUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl;
  }
}

export function extractExternalLeafletId(retailer: string, url: string): string | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    if (retailer === "billa") {
      const publitas = path.match(/\/billa-cz\/([^/]+)/i);
      if (publitas?.[1]) return publitas[1];
    }
    if (retailer === "lidl") {
      const flyer = path.match(/\/l\/cs\/letak\/([^/]+)/i);
      if (flyer?.[1]) return flyer[1];
    }
    if (retailer === "kaufland") {
      const leaflet = path.match(/\/cz-CZ\/([^/]+)/i);
      if (leaflet?.[1]) return leaflet[1];
    }
    const file = path.split("/").pop() || "";
    const stem = file.replace(/\.(pdf|html?)$/i, "");
    return stem || null;
  } catch {
    return null;
  }
}

export function extractValidityPeriod(text: string): { valid_from: string; valid_to: string } | null {
  const hay = text.replace(/\s+/g, " ");
  const ranged = hay.match(
    /(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2}).{0,40}?(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})/,
  );
  if (ranged) {
    return {
      valid_from: isoDate(Number(ranged[3]), Number(ranged[2]), Number(ranged[1])),
      valid_to: isoDate(Number(ranged[6]), Number(ranged[5]), Number(ranged[4])),
    };
  }
  const sameYear = hay.match(
    /(\d{1,2})[.\-/](\d{1,2}).{0,24}?(\d{1,2})[.\-/](\d{1,2})[.\-/](20\d{2})/,
  );
  if (sameYear) {
    return {
      valid_from: isoDate(Number(sameYear[5]), Number(sameYear[2]), Number(sameYear[1])),
      valid_to: isoDate(Number(sameYear[5]), Number(sameYear[4]), Number(sameYear[3])),
    };
  }
  return null;
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function todayPragueYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function normalizeContentHash(value: string | null | undefined): string | null {
  if (!value) return null;
  const hex = value.replace(/^pdf:/i, "").toLowerCase().replace(/[^a-f0-9]/g, "");
  return hex.length >= 16 ? hex : null;
}

export function contentHashesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeContentHash(a);
  const right = normalizeContentHash(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const n = Math.min(16, left.length, right.length);
  return n >= 16 && left.slice(0, 16) === right.slice(0, 16);
}

export function identityFromAsset(
  retailer: string,
  asset: Pick<LeafletAsset, "url" | "label" | "kind">,
  extras: Partial<LeafletIdentity> = {},
): LeafletIdentity {
  const validity = extractValidityPeriod(`${asset.label} ${asset.url}`);
  return {
    retailer,
    canonical_source_url: canonicalLeafletUrl(retailer, asset.url),
    pdf_url: extras.pdf_url ?? (asset.kind === "pdf" ? canonicalizePdfUrl(asset.url) : null),
    valid_from: extras.valid_from ?? validity?.valid_from ?? null,
    valid_to: extras.valid_to ?? validity?.valid_to ?? null,
    external_id: extras.external_id ?? extractExternalLeafletId(retailer, asset.url),
    content_hash: extras.content_hash ?? null,
  };
}

export function identityFromDocument(retailer: string, row: {
  source_url?: string | null;
  source_leaflet_number?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  filename?: string | null;
}): LeafletIdentity {
  const source = row.source_url ? String(row.source_url) : "";
  const filename = String(row.filename ?? "");
  const shortHash = filename.match(/__([a-f0-9]{16})\.pdf$/i)?.[1] ?? null;
  return {
    retailer,
    canonical_source_url: source ? canonicalLeafletUrl(retailer, source) : null,
    pdf_url: /\.pdf(?:$|[?#])/i.test(source) ? canonicalizePdfUrl(source) : null,
    valid_from: row.valid_from ? String(row.valid_from).slice(0, 10) : null,
    valid_to: row.valid_to ? String(row.valid_to).slice(0, 10) : null,
    external_id: row.source_leaflet_number ? String(row.source_leaflet_number) : (source ? extractExternalLeafletId(retailer, source) : null),
    content_hash: shortHash,
  };
}

function hasSpecificExternalId(value: string | null): boolean {
  if (!value) return false;
  return value.length >= 6 && /\d/.test(value) && !/^(nabidky|letak|letaky|akce|aktualni)$/i.test(value);
}

export function isDuplicateLeaflet(existing: LeafletIdentity, incoming: LeafletIdentity): boolean {
  if (existing.retailer !== incoming.retailer) return false;
  if (contentHashesMatch(existing.content_hash, incoming.content_hash)) return true;

  const sameValidity = Boolean(
    incoming.valid_from &&
    incoming.valid_to &&
    existing.valid_from === incoming.valid_from &&
    existing.valid_to === incoming.valid_to,
  );
  const sameSource = Boolean(
    incoming.canonical_source_url &&
    existing.canonical_source_url &&
    incoming.canonical_source_url === existing.canonical_source_url,
  );
  const samePdf = Boolean(
    incoming.pdf_url &&
    existing.pdf_url &&
    canonicalizePdfUrl(incoming.pdf_url) === canonicalizePdfUrl(existing.pdf_url),
  );
  const sameExternal = Boolean(
    incoming.external_id &&
    existing.external_id &&
    incoming.external_id === existing.external_id,
  );

  // A retailer can reuse the same viewer/PDF URL for a new week. Therefore URL alone
  // is never enough to suppress a new import when the validity window changed.
  if (sameValidity && (sameSource || samePdf || sameExternal)) return true;

  // For retailer-specific IDs that are actually versioned (Publitas/flyer/week IDs),
  // allow dedupe even when the validity text was not available on the source page.
  if (sameExternal && hasSpecificExternalId(incoming.external_id)) return true;

  return false;
}

export function findDuplicateLeaflet(known: LeafletIdentity[], incoming: LeafletIdentity): LeafletIdentity | null {
  return known.find((row) => isDuplicateLeaflet(row, incoming)) ?? null;
}

export function selectWatchableAssets(retailer: string, assets: LeafletAsset[], limit = 12): LeafletAsset[] {
  const seen = new Set<string>();
  const out: LeafletAsset[] = [];
  const today = todayPragueYmd();
  for (const asset of assets) {
    if (asset.score <= 0) continue;
    const identity = identityFromAsset(retailer, asset);
    // Expired dated flyers are never downloaded again. Current and future flyers stay eligible.
    if (identity.valid_to && identity.valid_to < today) continue;
    const key = canonicalLeafletUrl(retailer, asset.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(asset);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Pure watch pass: compare discovered leaflets to the already recorded set.
 * On source_error the known registry is left untouched.
 */
export function runLeafletWatchPass(input: {
  retailer: string;
  source_url: string;
  checked_at: string;
  discovered: LeafletIdentity[];
  known: LeafletIdentity[];
  source_error?: string | null;
}): WatchCheckLog & {
  new_leaflets: LeafletIdentity[];
  duplicates: LeafletIdentity[];
  known_after: LeafletIdentity[];
} {
  if (input.source_error) {
    return {
      retailer: input.retailer,
      checked_at: input.checked_at,
      source_url: input.source_url,
      found_leaflets_count: 0,
      new_leaflets_count: 0,
      errors: [input.source_error],
      new_leaflets: [],
      duplicates: [],
      known_after: input.known.slice(),
    };
  }

  const known = input.known.slice();
  const newLeaflets: LeafletIdentity[] = [];
  const duplicates: LeafletIdentity[] = [];

  for (const incoming of input.discovered) {
    if (findDuplicateLeaflet(known, incoming)) {
      duplicates.push(incoming);
      continue;
    }
    newLeaflets.push(incoming);
    known.push(incoming);
  }

  return {
    retailer: input.retailer,
    checked_at: input.checked_at,
    source_url: input.source_url,
    found_leaflets_count: input.discovered.length,
    new_leaflets_count: newLeaflets.length,
    errors: [],
    new_leaflets: newLeaflets,
    duplicates,
    known_after: known,
  };
}

export function buildWatchCheckLog(args: {
  retailer: string;
  checked_at: string;
  source_url: string;
  found_leaflets_count: number;
  new_leaflets_count: number;
  errors: string[];
}): WatchCheckLog {
  return {
    retailer: args.retailer,
    checked_at: args.checked_at,
    source_url: args.source_url,
    found_leaflets_count: args.found_leaflets_count,
    new_leaflets_count: args.new_leaflets_count,
    errors: args.errors,
  };
}
