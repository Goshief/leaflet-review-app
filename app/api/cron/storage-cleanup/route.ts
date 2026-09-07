import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PDF_INTAKE_BUCKET } from "@/lib/leaflet-monitor/pdf-intake";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_CANDIDATES = 1000;
const DELETE_BATCH_SIZE = 100;
const MIN_AGE_MS = 2 * 60 * 60 * 1000;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if ((req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin is not configured" }, { status: 503 });
  }

  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();

  const { data: candidates, error: candidateError } = await supabase
    .from("leaflet_pdf_pages")
    .select("page_id,image_storage_path,page_no,rendered_at,processing_status")
    .eq("processing_status", "parsed")
    .gt("page_no", 1)
    .neq("image_storage_path", "")
    .lt("rendered_at", cutoff)
    .order("rendered_at", { ascending: true })
    .limit(MAX_CANDIDATES);

  if (candidateError) {
    return NextResponse.json({ ok: false, error: `candidate query: ${candidateError.message}` }, { status: 500 });
  }

  const rows = (candidates ?? []).filter((row) => row.page_id && row.image_storage_path);
  if (!rows.length) {
    return NextResponse.json({ ok: true, candidates: 0, protected: 0, deleted: 0 });
  }

  const pageIds = rows.map((row) => String(row.page_id));
  const protectedIds = new Set<string>();

  for (const batch of chunks(pageIds, 100)) {
    const { data: openReview, error: reviewError } = await supabase
      .from("offers_staging")
      .select("page_id")
      .in("page_id", batch)
      .in("review_status", ["pending", "needs_review"]);

    if (reviewError) {
      return NextResponse.json({ ok: false, error: `review query: ${reviewError.message}` }, { status: 500 });
    }
    for (const row of openReview ?? []) {
      if (row.page_id) protectedIds.add(String(row.page_id));
    }
  }

  const deletable = rows.filter((row) => !protectedIds.has(String(row.page_id)));
  let deleted = 0;
  const errors: string[] = [];

  for (const batch of chunks(deletable, DELETE_BATCH_SIZE)) {
    const paths = batch.map((row) => String(row.image_storage_path));
    const { error: removeError } = await supabase.storage.from(PDF_INTAKE_BUCKET).remove(paths);
    if (removeError) {
      errors.push(`storage remove: ${removeError.message}`);
      continue;
    }

    const ids = batch.map((row) => String(row.page_id));
    const { error: updateError } = await supabase
      .from("leaflet_pdf_pages")
      .update({ image_storage_path: "" })
      .in("page_id", ids);

    if (updateError) {
      errors.push(`metadata update: ${updateError.message}`);
      continue;
    }
    deleted += batch.length;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    cutoff,
    candidates: rows.length,
    protected: protectedIds.size,
    deleted,
    errors,
  }, { status: errors.length ? 207 : 200 });
}
