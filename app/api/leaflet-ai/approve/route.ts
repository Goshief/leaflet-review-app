import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapOffersForImportRun, type MapOfferInput, type RowStatus } from "@/lib/import-run/map-offers";

export const runtime = "nodejs";

const DEFAULT_BUCKET = "leaflet-intake";

type VerifiedOffer = MapOfferInput & {
  page_no: number;
  confidence: number | null;
  status: "approved" | "quarantine";
  verification_reason?: string | null;
};

type State = {
  version: 1;
  bucket: string;
  path: string;
  retailer: string;
  source_url: string | null;
  import_id: string;
  openai_file_id: string;
  page_count: number;
  next_page: number;
  processed_pages: number[];
  completed: boolean;
  created_at: string;
  updated_at: string;
};

type Body = {
  bucket?: string;
  path?: string;
  page?: number;
  verified_offers?: VerifiedOffer[];
};

function statePath(pdfPath: string) {
  return `${pdfPath}.ai-state.json`;
}

function reviewPath(pdfPath: string, page: number) {
  return `${pdfPath}.page-${page}.review.json`;
}

async function readState(supabase: any, bucket: string, pdfPath: string): Promise<State | null> {
  const { data, error } = await supabase.storage.from(bucket).download(statePath(pdfPath));
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as State;
  } catch {
    return null;
  }
}

async function writeState(supabase: any, state: State) {
  state.updated_at = new Date().toISOString();
  const { error } = await supabase.storage.from(state.bucket).upload(
    statePath(state.path),
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    { contentType: "application/json", upsert: true },
  );
  if (error) throw new Error(`Nelze uložit AI stav: ${error.message}`);
}

export async function POST(req: NextRequest) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = await req.json() as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "Očekávám JSON body." }, { status: 400 });
  }

  const bucket = body.bucket?.trim() || DEFAULT_BUCKET;
  const path = body.path?.trim();
  const page = body.page;
  const verified = Array.isArray(body.verified_offers) ? body.verified_offers : [];
  if (!path || !Number.isInteger(page) || !page || page < 1) {
    return NextResponse.json({ ok: false, error: "Chybí path nebo platné číslo stránky." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });

  try {
    const state = await readState(supabase, bucket, path);
    if (!state) return NextResponse.json({ ok: false, error: "AI stav PDF nebyl nalezen. Nejprve spusť dry-run stránky." }, { status: 409 });
    if (page > state.page_count) return NextResponse.json({ ok: false, error: `Stránka musí být 1 až ${state.page_count}.` }, { status: 400 });
    if (state.processed_pages.includes(page)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "page_already_processed", state });
    }

    const statuses: Record<number, RowStatus> = {};
    verified.forEach((offer, index) => {
      statuses[index] = offer.status === "approved" ? "approved" : "quarantine";
      if (offer.verification_reason) {
        offer.notes = [offer.notes, `AI verification: ${offer.verification_reason}`].filter(Boolean).join(" | ");
      }
    });

    const mapped = mapOffersForImportRun({
      offers: verified,
      row_status: statuses,
      meta: {
        import_id: state.import_id,
        source_type: "leaflet",
        source_url: state.source_url,
        today_iso: new Date().toISOString().slice(0, 10),
      },
    });

    if (mapped.rawRows.length) {
      const { error } = await supabase.from("offers_raw").insert(mapped.rawRows);
      if (error) throw new Error(`offers_raw insert: ${error.message}`);
    }
    if (mapped.quarantineRows.length) {
      const { error } = await supabase.from("offers_quarantine").insert(mapped.quarantineRows);
      if (error) throw new Error(`offers_quarantine insert: ${error.message}`);
    }

    const review = {
      approved_at: new Date().toISOString(),
      retailer: state.retailer,
      bucket,
      path,
      page,
      approved_count: mapped.rawRows.length,
      quarantine_count: mapped.quarantineRows.length,
      verified_offers: verified,
    };
    await supabase.storage.from(bucket).upload(
      reviewPath(path, page),
      new Blob([JSON.stringify(review, null, 2)], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );

    state.processed_pages = [...state.processed_pages, page].sort((a, b) => a - b);
    state.next_page = Math.min(state.page_count + 1, page + 1);
    state.completed = state.processed_pages.length >= state.page_count;
    await writeState(supabase, state);

    return NextResponse.json({
      ok: true,
      page,
      approved_count: mapped.rawRows.length,
      quarantine_count: mapped.quarantineRows.length,
      completed: state.completed,
      next_page: state.next_page,
      state,
    });
  } catch (error) {
    console.error("[leaflet-ai-approve]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
