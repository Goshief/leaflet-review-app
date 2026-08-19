import { NextRequest } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { validatePdfBytes } from "@/lib/leaflet-monitor/pdf-validation";
import { PDF_VIEWER_HEADERS } from "@/lib/security/headers";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const RETAILER_RE = /^[a-z0-9_-]+$/i;
const PDF_HEADERS = Object.fromEntries(PDF_VIEWER_HEADERS.map(({ key, value }) => [key, value]));

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

  const bytes = new Uint8Array(await data.arrayBuffer());
  const validation = validatePdfBytes(bytes);
  if (!validation.ok) {
    return new Response(`Uložený objekt není platné PDF (${validation.reason}).`, {
      status: 422,
      headers: { "Cache-Control": PDF_HEADERS["Cache-Control"], "X-Content-Type-Options": PDF_HEADERS["X-Content-Type-Options"] },
    });
  }

  const safeName = filename.replace(/[\r\n"]/g, "_");
  return new Response(bytes, {
    status: 200,
    headers: {
      ...PDF_HEADERS,
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
    },
  });
}
