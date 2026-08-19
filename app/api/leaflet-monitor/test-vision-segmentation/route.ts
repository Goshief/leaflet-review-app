import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { segmentPdfPageVisually } from "@/lib/leaflet-review/vision-segmentation";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  const pageNo = Math.max(1, Math.floor(Number(new URL(req.url).searchParams.get("page") || 1)));
  try {
    const { data, error } = await s.storage.from(BUCKET).download(SOURCE_PATH);
    if (error || !data) throw new Error(error?.message || "BILLA PDF nebylo nalezeno.");
    const bytes = new Uint8Array(await data.arrayBuffer());
    const result = await segmentPdfPageVisually({ bytes, filename: "billa-2026-08-19.pdf", pageNo });
    const named = result.blocks.filter((b) => b.product_name).length;
    const priced = result.blocks.filter((b) => b.price_sale != null).length;
    const highConfidence = result.blocks.filter((b) => b.confidence >= 0.8).length;
    return NextResponse.json({ ok: true, page_no: pageNo, block_count: result.blocks.length, named, priced, high_confidence: highConfidence, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, page_no: pageNo, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
