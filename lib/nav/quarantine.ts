export function quarantineHomeHref() {
  // Primární karanténní view (napříč dávkami) — databázová pravda (offers_quarantine).
  return "/quarantine";
}

/** Lokální karanténa z rozpracované review session — není databázový seznam. */
export function quarantineLocalHref() {
  return "/quarantine/local";
}

export function quarantineSearchHref(q: string) {
  const qq = (q ?? "").toString().trim();
  if (!qq) return quarantineHomeHref();
  const p = new URLSearchParams({ q: qq });
  return `/quarantine?${p.toString()}`;
}

export function reviewQuarantineHref() {
  // Deep-link do review se zapnutou karanténou (tab + status filtr v URL).
  return "/review?tab=quarantine&filter=quarantine";
}

