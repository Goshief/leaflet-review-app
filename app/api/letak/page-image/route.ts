import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabasePdfPagesBackend } from "@/lib/leaflet-monitor/pdf-pages";
import { PDF_PAGES_TABLE } from "@/lib/leaflet-monitor/pdf-pages";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const requestId = makeRequestId();
  const gate = await requireOperatorApi({ requestId });
  if (!gate.ok) return gate.response;
  const pageId = req.nextUrl.searchParams.get("page_id") || "";
  if (!pageId) {
    return NextResponse.json(
      safeErrorJson({ status: 400, code: "BAD_REQUEST", message: "Chybí page_id.", requestId }),
      { status: 400 },
    );
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      safeErrorJson({ status: 404, code: "NOT_FOUND", message: "Náhled stránky není k dispozici.", requestId }),
      { status: 404 },
    );
  }
  const { data: page, error } = await supabase
    .from(PDF_PAGES_TABLE)
    .select("image_storage_path")
    .eq("page_id", pageId)
    .maybeSingle();
  if (error || !page?.image_storage_path) {
    return NextResponse.json(
      safeErrorJson({ status: 404, code: "NOT_FOUND", message: "Stránka nebyla nalezena.", requestId }),
      { status: 404 },
    );
  }
  const bytes = await createSupabasePdfPagesBackend(supabase).getPageImage(String(page.image_storage_path));
  if (!bytes?.byteLength) {
    return NextResponse.json(
      safeErrorJson({ status: 404, code: "NOT_FOUND", message: "PNG stránky chybí.", requestId }),
      { status: 404 },
    );
  }
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=60",
    },
  });
}