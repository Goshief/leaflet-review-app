type PublicDocument = { retailer_id: unknown; source_url: unknown; valid_from: unknown; valid_to: unknown };
const MAX_BYTES = 75 * 1024 * 1024;

/** Only a current, already-published Globus document may use this Node relay. */
export function currentGlobusSource(row: PublicDocument, today: string): URL | null {
  if (row.retailer_id !== "globus" || typeof row.source_url !== "string" || typeof row.valid_from !== "string" || typeof row.valid_to !== "string") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.valid_from) || !/^\d{4}-\d{2}-\d{2}$/.test(row.valid_to) || today < row.valid_from || today > row.valid_to) return null;
  try {
    const url = new URL(row.source_url);
    return url.protocol === "https:" && url.hostname === "gapi.globus.cz" && !url.username && !url.password && !url.port && url.pathname === "/OnlineAsset/3/asset" && /^[\da-f-]{36}$/i.test(url.searchParams.get("assetID") ?? "") ? url : null;
  } catch { return null; }
}

export async function relayGlobusPdf(source: URL, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55000);
  let upstream: Response;
  try {
    upstream = await fetchImpl(source, { redirect: "manual", signal: controller.signal, headers: { Accept: "application/pdf", "User-Agent": "SetrikLeafletCatalog/2.0" } });
  } finally { clearTimeout(timer); }
  if (!upstream.ok || !upstream.body || Number(upstream.headers.get("content-length")) > MAX_BYTES) {
    await upstream.body?.cancel(); throw new Error("globus_pdf_unavailable");
  }
  const reader = upstream.body.getReader();
  let first = await reader.read();
  while (!first.done && first.value.length < 5) {
    const next = await reader.read();
    if (next.done) break;
    const joined = new Uint8Array(first.value.length + next.value.length);
    joined.set(first.value); joined.set(next.value,first.value.length);
    first = {done:false,value:joined};
  }
  if (first.done || new TextDecoder().decode(first.value.slice(0,5)) !== "%PDF-") { await reader.cancel(); throw new Error("invalid_pdf"); }
  let pending: Uint8Array | null = first.value;
  let size = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(target) {
      try {
        const chunk = pending ? {done:false,value:pending} : await reader.read(); pending = null;
        if (chunk.done) { target.close(); return; }
        size += chunk.value.length;
        if (size > MAX_BYTES) { await reader.cancel(); target.error(new Error("pdf_too_large")); return; }
        target.enqueue(chunk.value);
      } catch (error) { target.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  });
  // The official endpoint ignores Range. A complete streamed 200 response is valid.
  return new Response(body, {headers:{"Content-Type":"application/pdf","Content-Disposition":"inline; filename=\"globus.pdf\"","Cache-Control":"public, max-age=0, s-maxage=300","X-Content-Type-Options":"nosniff"}});
}
