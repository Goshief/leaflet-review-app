import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const RETAILERS = ["lidl", "kaufland", "penny", "billa", "albert"] as const;

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
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  }

  const items: any[] = [];

  for (const retailer of RETAILERS) {
    const { data: files, error } = await supabase.storage.from(BUCKET).list(retailer, {
      limit: 200,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (error) continue;

    const pdfs = (files ?? []).filter((x: any) => x.name?.toLowerCase().endsWith(".pdf"));

    for (const pdf of pdfs) {
      const state = await readJson<any>(supabase, `${retailer}/${pdf.name}.ai-state.json`);
      const reviews = (files ?? []).filter((x: any) => x.name?.startsWith(`${pdf.name}.page-`) && x.name?.endsWith(".review.json"));

      let approved = 0;
      let quarantine = 0;
      let validFrom: string | null = null;
      let validTo: string | null = null;

      for (const reviewFile of reviews) {
        const review = await readJson<any>(supabase, `${retailer}/${reviewFile.name}`);
        approved += Number(review?.approved_count ?? 0);
        quarantine += Number(review?.quarantine_count ?? 0);
        if (!validFrom && review?.valid_from) validFrom = review.valid_from;
        if (!validTo && review?.valid_to) validTo = review.valid_to;
      }

      const pageCount = Number(state?.page_count ?? 0) || null;
      const processedPages = Array.isArray(state?.processed_pages) ? state.processed_pages.length : 0;
      const completed = Boolean(state?.completed);
      const status = completed
        ? "hotovo"
        : state
          ? processedPages > 0 ? "rozpracováno" : "čeká na schválení"
          : "staženo";

      items.push({
        retailer,
        pdf: pdf.name,
        created_at: pdf.created_at ?? null,
        updated_at: pdf.updated_at ?? null,
        status,
        page_count: pageCount,
        processed_pages: processedPages,
        approved_count: approved,
        quarantine_count: quarantine,
        valid_from: validFrom,
        valid_to: validTo,
      });
    }
  }

  items.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  return NextResponse.json({ ok: true, items });
}
