import { NextRequest } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const RETAILER_RE = /^[a-z0-9_-]+$/i;

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
  if (error || !data) return new Response(error?.message ?? "PDF nebylo nalezeno.", { status: 404 });

  const bytes = await data.arrayBuffer();
  const safeName = filename.replace(/[\r\n"]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      // The global security policy intentionally blocks framing. This endpoint is
      // the one exception: the operator UI embeds the original leaflet PDF from
      // the same origin next to the review controls.
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'; sandbox allow-same-origin allow-scripts allow-forms allow-downloads",
    },
  });
}
