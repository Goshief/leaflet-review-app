import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { mapOffersForImportRun } from "@/lib/import-run/map-offers";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";
import { applyBrandAliases, loadBrandAliases } from "@/lib/leaflet-review/brand-resolver";
import { applyVariantEvidence } from "@/lib/leaflet-review/variant-resolver";
import { applyPromoEvidence } from "@/lib/leaflet-review/promo-resolver";
import { mergeRereadKeepingManualEdits } from "@/lib/leaflet-review/reread-merge";
import type { OcrWord } from "@/lib/ocr/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function auth() {
  const gate = await requireOperatorApi();
  return gate.ok ? null : gate.response;
}

export async function GET(req: NextRequest) {
  const unauthorized = await auth();
  if (unauthorized) return unauthorized;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });

  const q = req.nextUrl.searchParams;
  const leafletId = q.get("leaflet_id");
  const retailer = q.get("retailer")?.toLowerCase();
  const page = Number(q.get("page") || "1");
  let document: any = null;

  if (leafletId) {
    const { data, error } = await s.from("leaflet_documents").select("*").eq("id", leafletId).single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 });
    document = data;
  } else if (retailer) {
    const { data, error } = await s.from("leaflet_documents").select("*").eq("retailer_id", retailer).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    document = data;
  } else {
    return NextResponse.json({ ok: false, error: "Chybí leaflet_id nebo retailer." }, { status: 400 });
  }

  if (!document) return NextResponse.json({ ok: true, document: null, pages: [], items: [] });

  const pageNo = Number.isFinite(page) && page > 0 ? page : 1;
  const { data: items, error } = await s.from("leaflet_item_candidates").select("*").eq("leaflet_id", document.id).eq("page_no", pageNo).order("created_at");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const { data: all } = await s.from("leaflet_item_candidates").select("page_no,status").eq("leaflet_id", document.id);
  const pages = Array.from({ length: document.page_count || 0 }, (_, i) => {
    const rows = (all || []).filter((x: any) => x.page_no === i + 1);
    return {
      page_no: i + 1,
      count: rows.length,
      unreviewed: rows.filter((x: any) => ["unreviewed", "needs_reread", "quarantine"].includes(x.status)).length,
      approved: rows.filter((x: any) => x.status === "approved").length,
      rejected: rows.filter((x: any) => x.status === "rejected").length,
    };
  });

  return NextResponse.json({ ok: true, document, pages, items: items || [] });
}

const EDITABLE = [
  "product_name", "brand", "variant", "pack_qty", "pack_unit", "pack_unit_qty", "pack_text",
  "price_sale", "price_standard", "price_loyalty", "price_without_loyalty", "price_per_unit", "price_per_unit_unit",
  "item_valid_from", "item_valid_to", "loyalty_required", "promo_label", "promo_condition", "minimum_quantity",
] as const;

const REREAD_FIELDS = [
  "source_bbox", "source_text", "product_name", "brand", "variant", "pack_qty", "pack_unit", "pack_unit_qty", "pack_text",
  "price_sale", "price_standard", "price_loyalty", "price_without_loyalty", "price_per_unit", "price_per_unit_unit",
  "leaflet_valid_from", "leaflet_valid_to", "item_valid_from", "item_valid_to", "loyalty_required", "promo_label",
  "promo_condition", "minimum_quantity", "field_evidence", "extraction_payload", "extractor_version", "confidence",
  "review_reason",
] as const;

async function recount(s: any, leafletId: string) {
  const { data } = await s.from("leaflet_item_candidates").select("status").eq("leaflet_id", leafletId);
  const rows = data || [];
  const n = (x: string) => rows.filter((r: any) => r.status === x).length;
  const vals = {
    candidate_count: rows.length,
    unreviewed_count: n("unreviewed") + n("needs_reread"),
    approved_count: n("approved"),
    rejected_count: n("rejected"),
    quarantine_count: n("quarantine"),
  };
  const waiting = vals.unreviewed_count + vals.quarantine_count;
  const status = waiting ? ((vals.approved_count || vals.rejected_count) ? "partially_reviewed" : "ready_for_review") : "completed";
  await s.from("leaflet_documents").update({ ...vals, processing_status: status, updated_at: new Date().toISOString() }).eq("id", leafletId);
  return { ...vals, processing_status: status };
}

function bboxCenter(b: any) {
  if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) return null;
  return { x: Number(b.x) + Number(b.width) / 2, y: Number(b.y) + Number(b.height) / 2 };
}

function overlapsExpandedBox(word: OcrWord, b: any) {
  if (!b) return true;
  const padX = Math.max(24, Number(b.width || 0) * 0.18);
  const padY = Math.max(20, Number(b.height || 0) * 0.18);
  const x0 = Number(b.x) - padX;
  const y0 = Number(b.y) - padY;
  const x1 = Number(b.x) + Number(b.width) + padX;
  const y1 = Number(b.y) + Number(b.height) + padY;
  const cx = word.x + word.w / 2;
  const cy = word.y + word.h / 2;
  return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
}

async function readPageWords(doc: any, pageNo: number): Promise<OcrWord[]> {
  const page = await doc.getPage(pageNo);
  const content = await page.getTextContent();
  const words: OcrWord[] = [];
  for (const raw of content.items) {
    if (!("str" in raw) || typeof raw.str !== "string") continue;
    const text = raw.str.trim();
    if (!text) continue;
    const t = Array.isArray(raw.transform) ? raw.transform : [1, 0, 0, 1, 0, 0];
    words.push({
      text,
      x: Number(t[4] ?? 0),
      y: Number(t[5] ?? 0),
      w: Math.max(1, Number(raw.width ?? text.length * 5)),
      h: Math.max(1, Number(raw.height ?? Math.abs(Number(t[3] ?? 10)))),
    });
  }
  return words;
}

async function rereadSingleCandidate(s: any, item: any, docRow: any) {
  if (!item.source_bbox) throw new Error("Položku nelze cíleně přečíst znovu: chybí source_bbox.");

  const { data: pdfBlob, error: downloadError } = await s.storage.from(docRow.storage_bucket).download(docRow.storage_path);
  if (downloadError || !pdfBlob) throw new Error(downloadError?.message || "PDF nebylo nalezeno.");

  const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = {
    WorkerMessageHandler: worker.WorkerMessageHandler,
  };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice() });
  const pdf = await task.promise;
  try {
    const allWords = await readPageWords(pdf, Number(item.page_no));
    const scopedWords = allWords.filter((w) => overlapsExpandedBox(w, item.source_bbox));
    if (!scopedWords.length) throw new Error("Ve zdrojové oblasti položky nebyl nalezen žádný text.");

    const brandAliases = await loadBrandAliases(s);
    const extracted = extractLeafletCandidates(scopedWords, {
      pageNo: Number(item.page_no),
      validFrom: docRow.valid_from ?? item.leaflet_valid_from ?? null,
      validTo: docRow.valid_to ?? item.leaflet_valid_to ?? null,
    }).map((c) => applyPromoEvidence(applyVariantEvidence(applyBrandAliases(c, brandAliases)), allWords));
    if (!extracted.length) throw new Error("Zdrojový blok po novém čtení nevytvořil žádného doložitelného kandidáta.");

    const originalCenter = bboxCenter(item.source_bbox);
    const chosen = extracted.slice().sort((a, b) => {
      const ac = bboxCenter(a.source_bbox);
      const bc = bboxCenter(b.source_bbox);
      const ad = originalCenter && ac ? Math.hypot(ac.x - originalCenter.x, ac.y - originalCenter.y) : 999999;
      const bd = originalCenter && bc ? Math.hypot(bc.x - originalCenter.x, bc.y - originalCenter.y) : 999999;
      const ap = item.price_sale != null && a.price_sale != null ? Math.abs(Number(item.price_sale) - Number(a.price_sale)) : 0;
      const bp = item.price_sale != null && b.price_sale != null ? Math.abs(Number(item.price_sale) - Number(b.price_sale)) : 0;
      return (ad + ap * 12) - (bd + bp * 12);
    })[0]!;
    const merged = mergeRereadKeepingManualEdits(chosen as unknown as Record<string, unknown>, item);

    const patch: Record<string, unknown> = {};
    for (const key of REREAD_FIELDS) patch[key] = merged[key];
    patch.status = merged.status;
    patch.revision = Number(item.revision || 1) + 1;
    patch.reread_count = Number(item.reread_count || 0) + 1;
    patch.last_reread_at = new Date().toISOString();
    patch.reviewed_at = null;
    patch.updated_at = new Date().toISOString();

    const { data: updated, error } = await s.from("leaflet_item_candidates").update(patch).eq("id", item.id).select("*").single();
    if (error) throw new Error(error.message);
    return updated;
  } finally {
    await pdf.destroy();
  }
}

export async function POST(req: NextRequest) {
  const unauthorized = await auth();
  if (unauthorized) return unauthorized;
  const s = getSupabaseAdmin();
  if (!s) return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, error: "Očekávám JSON body." }, { status: 400 }); }

  const id = String(body.id || "");
  const action = String(body.action || "");
  if (!id || !action) return NextResponse.json({ ok: false, error: "Chybí id nebo action." }, { status: 400 });

  const { data: item, error: ie } = await s.from("leaflet_item_candidates").select("*, leaflet_documents(*)").eq("id", id).single();
  if (ie || !item) return NextResponse.json({ ok: false, error: ie?.message || "Položka nenalezena." }, { status: 404 });
  const before = { ...item };
  const doc = (item as any).leaflet_documents;

  try {
    if (action === "edit") {
      const patch: any = {};
      for (const key of EDITABLE) if (Object.prototype.hasOwnProperty.call(body.changes || {}, key)) patch[key] = (body.changes || {})[key];
      patch.status = "unreviewed";
      patch.revision = Number(item.revision || 1) + 1;
      patch.updated_at = new Date().toISOString();
      patch.field_evidence = { ...(item.field_evidence || {}), manual_edit: { at: new Date().toISOString(), fields: Object.keys(patch) } };
      const { data, error } = await s.from("leaflet_item_candidates").update(patch).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await s.from("leaflet_item_review_audit").insert({ candidate_id: id, action: "edited", previous_payload: before, next_payload: data, note: "Ruční oprava operátorem." });
      await recount(s, item.leaflet_id);
      return NextResponse.json({ ok: true, item: data });
    }

    if (action === "reject" || action === "quarantine") {
      const status = action === "reject" ? "rejected" : "quarantine";
      const { data, error } = await s.from("leaflet_item_candidates").update({ status, review_reason: body.note || item.review_reason, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await s.from("leaflet_item_review_audit").insert({ candidate_id: id, action: action === "reject" ? "rejected" : "quarantined", previous_payload: before, next_payload: data, note: body.note || null });
      await recount(s, item.leaflet_id);
      return NextResponse.json({ ok: true, item: data });
    }

    if (action === "reread") {
      if (!doc) throw new Error("Chybí dokument letáku.");
      const newItem = await rereadSingleCandidate(s, item, doc);
      await s.from("leaflet_item_review_audit").insert({
        candidate_id: id,
        action: "reread",
        previous_payload: before,
        next_payload: newItem,
        note: "Cíleně znovu načten pouze původní source_bbox této položky; ostatní kandidáti na stránce nebyli změněni.",
      });
      await recount(s, item.leaflet_id);
      return NextResponse.json({ ok: true, item: newItem });
    }

    if (action === "approve") {
      if (item.status === "approved" && item.approved_offer_id) {
        return NextResponse.json({ ok: true, item, offer_id: item.approved_offer_id, already_approved: true });
      }
      if (!item.product_name || item.price_sale == null) return NextResponse.json({ ok: false, error: "Nelze schválit: chybí jednoznačný název produktu nebo hlavní cena." }, { status: 409 });
      const validFrom = item.item_valid_from || item.leaflet_valid_from || doc?.valid_from || null;
      const validTo = item.item_valid_to || item.leaflet_valid_to || doc?.valid_to || null;
      if (!validTo) return NextResponse.json({ ok: false, error: "Nelze schválit: není doložen konec platnosti." }, { status: 409 });

      const mapped = mapOffersForImportRun({
        offers: [{
          store_id: doc.retailer_id,
          source_type: "leaflet",
          extracted_name: item.product_name,
          brand: item.brand,
          price_total: item.price_sale,
          price_standard: item.price_standard,
          price_with_loyalty_card: item.price_loyalty,
          has_loyalty_card_price: item.price_loyalty != null,
          typical_price_per_unit: item.price_per_unit,
          pack_qty: item.pack_qty,
          pack_unit: item.pack_unit,
          pack_unit_qty: item.pack_unit_qty,
          valid_from: validFrom,
          valid_to: validTo,
          currency: "CZK",
          notes: [item.promo_label, item.promo_condition, `leaflet_candidate:${id}`, `page:${item.page_no}`].filter(Boolean).join(" | "),
        }],
        row_status: { 0: "approved" },
        meta: { import_id: doc.import_id, source_type: "leaflet", source_url: doc.source_url, today_iso: new Date().toISOString().slice(0, 10) },
      });
      if (mapped.rawRows.length !== 1) return NextResponse.json({ ok: false, error: "Položka nesplňuje povinná pole pro ostrý zápis." }, { status: 409 });

      const { data: raw, error: re } = await s.from("offers_raw").insert(mapped.rawRows[0]).select("id").single();
      if (re) throw new Error(re.message);
      const { data, error } = await s.from("leaflet_item_candidates").update({ status: "approved", approved_offer_id: raw.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
      if (error) throw new Error(error.message);
      await s.from("leaflet_item_review_audit").insert({ candidate_id: id, action: "approved", previous_payload: before, next_payload: data, note: "Schváleno jednotlivě operátorem a zapsáno do offers_raw." });
      await recount(s, item.leaflet_id);
      return NextResponse.json({ ok: true, item: data, offer_id: raw.id });
    }

    return NextResponse.json({ ok: false, error: "Neznámá akce." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}