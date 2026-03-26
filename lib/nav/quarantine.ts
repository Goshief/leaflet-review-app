export function quarantineHomeHref() {
  // Primární karanténní view (napříč dávkami).
  return "/quarantine";
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

