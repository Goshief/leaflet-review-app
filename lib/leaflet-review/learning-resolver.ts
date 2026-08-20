import type { ExtractedCandidate } from "./extractor";

const LEARNABLE_FIELDS = [
  "product_name","brand","variant","pack_qty","pack_unit","pack_unit_qty","pack_text",
  "price_sale","price_standard","price_loyalty","price_without_loyalty","price_per_unit","price_per_unit_unit",
  "item_valid_from","item_valid_to","loyalty_required","promo_label","promo_condition","minimum_quantity",
] as const;

type LearnableField = typeof LEARNABLE_FIELDS[number];
export type LearningSignal = {
  audit_id: string;
  retailer_id: string;
  source_text: string;
  previous: Record<string, unknown>;
  corrected: Record<string, unknown>;
  changed_fields: LearnableField[];
  created_at?: string | null;
};

function norm(v: unknown) {
  return String(v ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function tokens(v: unknown) { return new Set(norm(v).split(" ").filter(Boolean)); }
function jaccard(a: unknown, b: unknown) {
  const aa=tokens(a), bb=tokens(b); if(!aa.size||!bb.size) return 0;
  let inter=0; for(const x of aa) if(bb.has(x)) inter++;
  return inter / (aa.size + bb.size - inter);
}
function same(a: unknown, b: unknown) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null); }

export async function loadLearningSignals(s: any, retailerId: string): Promise<LearningSignal[]> {
  const { data, error } = await s.from("leaflet_item_review_audit")
    .select("id,previous_payload,next_payload,created_at")
    .eq("action","edited")
    .order("created_at",{ascending:false})
    .limit(500);
  if (error) throw new Error(`learning feedback lookup: ${error.message}`);
  const out: LearningSignal[]=[];
  for (const row of data ?? []) {
    const prev=(row as any).previous_payload ?? {};
    const next=(row as any).next_payload ?? {};
    const meta=next?._learning ?? prev?._learning ?? {};
    if (String(meta.retailer_id ?? "").toLowerCase() !== retailerId.toLowerCase()) continue;
    const sourceText=String(meta.source_text ?? prev.source_text ?? next.source_text ?? "");
    if (!sourceText.trim()) continue;
    const changed=LEARNABLE_FIELDS.filter(k=>!same(prev[k],next[k]));
    if (!changed.length) continue;
    out.push({audit_id:String(row.id),retailer_id:retailerId,source_text:sourceText,previous:prev,corrected:next,changed_fields:changed,created_at:(row as any).created_at ?? null});
  }
  return out;
}

export function applyLearningSignal(candidate: ExtractedCandidate, signals: LearningSignal[]): ExtractedCandidate {
  const source=String(candidate.source_text ?? "");
  if (!source.trim()) return candidate;
  let best: { signal: LearningSignal; score: number } | null = null;
  for (const signal of signals) {
    const score=jaccard(source,signal.source_text);
    if (score < .90) continue;
    // Additional guard: unchanged stable fields should still be compatible.
    const stablePrice = !signal.changed_fields.includes("price_sale") && signal.previous.price_sale != null && candidate.price_sale != null
      ? Math.abs(Number(signal.previous.price_sale)-Number(candidate.price_sale)) < .01 : true;
    const stableUnit = !signal.changed_fields.includes("pack_unit") && signal.previous.pack_unit && candidate.pack_unit
      ? norm(signal.previous.pack_unit)===norm(candidate.pack_unit) : true;
    if (!stablePrice || !stableUnit) continue;
    if (!best || score > best.score) best={signal,score};
  }
  if (!best) return candidate;
  const patch: Record<string,unknown>={};
  for (const field of best.signal.changed_fields) patch[field]=best.signal.corrected[field] ?? null;
  return {
    ...candidate,
    ...patch,
    field_evidence:{
      ...(candidate.field_evidence ?? {}),
      learning_feedback:{
        source:"review_audit",
        audit_id:best.signal.audit_id,
        similarity:Number(best.score.toFixed(4)),
        changed_fields:best.signal.changed_fields,
      },
    },
    extraction_payload:{
      ...(candidate.extraction_payload ?? {}),
      learning_feedback:{audit_id:best.signal.audit_id,similarity:Number(best.score.toFixed(4)),changed_fields:best.signal.changed_fields},
    },
  } as ExtractedCandidate;
}
