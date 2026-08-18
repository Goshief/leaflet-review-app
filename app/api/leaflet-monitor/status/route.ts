import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { emptyLearningState, type RetailerId, type RetailerLearningState } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const RETAILERS: Array<{ id: RetailerId; name: string; source_url: string; connector: "active" | "pending" }> = [
  { id: "lidl", name: "Lidl", source_url: "https://www.lidl.cz/", connector: "pending" },
  { id: "kaufland", name: "Kaufland", source_url: "https://www.kaufland.cz/", connector: "active" },
  { id: "penny", name: "Penny", source_url: "https://www.penny.cz/", connector: "pending" },
  { id: "billa", name: "Billa", source_url: "https://www.billa.cz/", connector: "pending" },
  { id: "albert", name: "Albert", source_url: "https://www.albert.cz/", connector: "pending" },
];

async function readJson<T>(supabase: any, path: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return null;
  }
}

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const rows = await Promise.all(RETAILERS.map(async (retailer) => {
    const learning = await readJson<RetailerLearningState>(supabase, `_learning/${retailer.id}.json`) ?? emptyLearningState(retailer.id);
    const { data: files } = await supabase.storage.from(BUCKET).list(retailer.id, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    const pdfs = (files ?? []).filter((x: any) => x.name?.toLowerCase().endsWith(".pdf"));
    const states = (files ?? []).filter((x: any) => x.name?.endsWith(".ai-state.json"));
    let aiState: any = null;
    if (states[0]?.name) aiState = await readJson<any>(supabase, `${retailer.id}/${states[0].name}`);

    const { data: checks } = await supabase.storage.from(BUCKET).list("_checks", {
      search: `${retailer.id}-`,
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    const lastCheckName = checks?.[0]?.name ?? null;
    const lastCheck = lastCheckName ? await readJson<any>(supabase, `_checks/${lastCheckName}`) : null;

    return {
      ...retailer,
      pdf_count: pdfs.length,
      latest_pdf: pdfs[0]?.name ?? null,
      last_check: lastCheck,
      learning: {
        confidence: learning.confidence,
        preferred_weekdays: learning.preferred_weekdays,
        checks_this_week_limit: learning.max_checks_per_week,
        last_check_at: learning.last_check_at,
        last_downloaded_at: learning.last_downloaded_at,
        next_check_at: learning.next_check_at,
        download_hits: learning.weekday_download_hits,
      },
      ai: aiState ? {
        page_count: aiState.page_count ?? null,
        processed_pages: Array.isArray(aiState.processed_pages) ? aiState.processed_pages.length : 0,
        completed: Boolean(aiState.completed),
        next_page: aiState.next_page ?? null,
      } : null,
    };
  }));

  return NextResponse.json({ ok: true, retailers: rows });
}
