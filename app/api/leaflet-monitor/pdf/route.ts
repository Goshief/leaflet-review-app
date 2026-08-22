import { NextRequest } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const RETAILER_RE = /^[a-z0-9_-]+$/i;

function pdfResponse(bytes: ArrayBuffer, filename: string) {
  const safeName = filename.replace(/[\r\n"]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-scripts allow-forms allow-downloads",
    },
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const retailer = req.nextUrl.searchParams.get("retailer")?.trim() ?? "";
  const filename = req.nextUrl.searchParams.get("filename")?.trim() ?? "";
  if (!RETAILER_RE.test(retailer) || !filename || filename.includes("/") || !filename.toLowerCase().endsWith(".pdf")) {
    return new Response("Neplatný PDF požadavek.", { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return new Response("Supabase není nakonfigurovaný.", { status: 503 });

  const path = `${retailer}/${filename}`;
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (!error && data) return pdfResponse(await data.arrayBuffer(), filename);

  const { data: doc, error: docError } = await supabase
    .from("leaflet_documents")
    .select("storage_path,source_url")
    .eq("retailer_id", retailer)
    .eq("filename", filename)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (docError) return new Response(docError.message, { status: 500 });

  const remote = String(doc?.storage_path ?? "").includes("/remote-");
  const sourceUrl = typeof doc?.source_url === "string" ? doc.source_url.trim() : "";
  if (!remote || !sourceUrl) return new Response(error?.message ?? "PDF nebylo nalezeno.", { status: 404 });

  try {
    const response = await fetch(sourceUrl, { cache: "no-store", redirect: "follow" });
    if (!response.ok) return new Response(`Vzdálené PDF HTTP ${response.status}.`, { status: 502 });
    const bytes = await response.arrayBuffer();
    const signature = new TextDecoder().decode(new Uint8Array(bytes).slice(0, 5));
    if (signature !== "%PDF-") return new Response("Vzdálený zdroj nevrátil PDF.", { status: 502 });
    return pdfResponse(bytes, filename);
  } catch (cause) {
    return new Response(cause instanceof Error ? cause.message : String(cause), { status: 502 });
  }
}
