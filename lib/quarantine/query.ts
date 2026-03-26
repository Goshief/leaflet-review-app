export function parseQuarantineQuery(search: string): { q: string; onlyOpen: boolean } {
  const s = (search ?? "").toString();
  const p = new URLSearchParams(s.startsWith("?") ? s.slice(1) : s);
  const q = (p.get("q") ?? "").toString();
  const onlyOpenRaw = (p.get("onlyOpen") ?? "").trim().toLowerCase();
  const onlyOpen = onlyOpenRaw === "0" || onlyOpenRaw === "false" ? false : true;
  return { q, onlyOpen };
}

