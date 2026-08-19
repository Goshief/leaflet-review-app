import type { OcrWord } from "@/lib/ocr/types";
import { clusterIntoLines, findPriceAnchors, unionWordsBBox } from "@/lib/ocr/price-anchors";
import { parsePriceText } from "@/lib/ocr/price-parse";

export const EXTRACTOR_VERSION = "leaflet-evidence-v2";

export type ExtractedCandidate = {
  candidate_key: string;
  page_no: number;
  source_bbox: { x: number; y: number; width: number; height: number } | null;
  source_text: string | null;
  product_name: string | null;
  brand: string | null;
  variant: string | null;
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  pack_text: string | null;
  price_sale: number | null;
  price_standard: number | null;
  price_loyalty: number | null;
  price_without_loyalty: number | null;
  price_per_unit: number | null;
  price_per_unit_unit: string | null;
  leaflet_valid_from: string | null;
  leaflet_valid_to: string | null;
  item_valid_from: string | null;
  item_valid_to: string | null;
  loyalty_required: boolean | null;
  promo_label: string | null;
  promo_condition: string | null;
  minimum_quantity: number | null;
  field_evidence: Record<string, unknown>;
  extraction_payload: Record<string, unknown>;
  extractor_version: string;
  confidence: number | null;
  status: "unreviewed" | "quarantine";
  review_reason: string | null;
};

type Meta = { pageNo: number; validFrom: string | null; validTo: string | null };

const GENERIC_LINE = /^(?:běžná cena|puvodni cena|původní cena|cena při koupi|při koupi balení|při koupi|s klubem|bez klubu|s kartou|bez karty|více druhů|regionální|pátek|super pátek|a v katalogu|to dobré začíná u nás|připravte se|a čerstvost)$/i;
const DATE_LINE = /(?:nabídka platí|platí od|\bod\s+\d{1,2}\.\s*\d{1,2}\.\s+do\s+\d{1,2}\.\s*\d{1,2}\.|\d{1,2}\.\s*\d{1,2}\.\s*[-–—]\s*\d{1,2}\.\s*\d{1,2}\.)/i;
const PACK_RE = /\b(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|ks|kus)\b/i;

function bbox(words: OcrWord[]) {
  const b = unionWordsBBox(words, 4);
  return b ? { x: b.x0, y: b.y0, width: Math.max(0, b.x1 - b.x0), height: Math.max(0, b.y1 - b.y0) } : null;
}
function textOf(words: OcrWord[]) { return words.slice().sort((a,b) => b.y-a.y || a.x-b.x).map(w => w.text.trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
function centerWord(w: OcrWord) { return { x: w.x + w.w/2, y: w.y + w.h/2 }; }
function centerBox(b: {x0:number;y0:number;x1:number;y1:number}) { return {x:(b.x0+b.x1)/2,y:(b.y0+b.y1)/2}; }
function evidence(raw: string | null, box: unknown) { return raw ? { raw_text: raw, bbox: box ?? null, source: "pdf_text" } : null; }
function normalizeLine(words: OcrWord[]) { return words.slice().sort((a,b)=>a.x-b.x).map(w=>w.text.trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
function isPlausibleName(s: string) {
  if (!s || s.length < 3 || s.length > 90) return false;
  if (GENERIC_LINE.test(s) || DATE_LINE.test(s)) return false;
  if (/^[-–—+\d\s.,%/]+$/.test(s)) return false;
  if (/\b(?:kč|kc)\b/i.test(s) && !/[A-Za-zÁ-ž]{3}/.test(s)) return false;
  if (/^(?:od|do)\s+\d/i.test(s)) return false;
  return /[A-Za-zÁ-ž]{3}/.test(s);
}
function labelledPrice(blockText: string, label: RegExp): number | null {
  const chunks = blockText.split(/\s{2,}|[|]/).filter(Boolean);
  for (const chunk of chunks) {
    if (!label.test(chunk)) continue;
    const m = chunk.match(/(\d{1,4}[,.]\d{1,2}|\d{1,4},-)/);
    if (m) return parsePriceText(m[1]!) ?? null;
  }
  const rx = new RegExp(`${label.source}.{0,35}?(\\d{1,4}[,.]\\d{1,2}|\\d{1,4},-)`, "i");
  const m = blockText.match(rx);
  return m ? parsePriceText(m[1]!) : null;
}
function itemValidity(text: string, year: number) {
  const m = text.match(/\bod\s+(\d{1,2})\.\s*(\d{1,2})\.?\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.?/i);
  if (!m) return {from:null,to:null};
  const p=(n:number)=>String(n).padStart(2,"0");
  return {from:`${year}-${p(Number(m[2]))}-${p(Number(m[1]))}`,to:`${year}-${p(Number(m[4]))}-${p(Number(m[3]))}`};
}

export function extractLeafletCandidates(words: OcrWord[], meta: Meta): ExtractedCandidate[] {
  if (!words.length) return [];
  const heights = words.map(w=>w.h).filter(h=>Number.isFinite(h)&&h>0).sort((a,b)=>a-b);
  const medianH = heights[Math.floor(heights.length/2)] || 10;
  const anchors = findPriceAnchors(words).filter(a => {
    const h = a.bbox.y1-a.bbox.y0;
    if (a.priceKc <= 0 || a.priceKc > 9999) return false;
    const nearby = words.filter(w => { const p=centerWord(w), c=centerBox(a.bbox); return Math.abs(p.x-c.x)<90 && Math.abs(p.y-c.y)<35; });
    const t=textOf(nearby);
    if (DATE_LINE.test(t) || /%/.test(a.rawText)) return false;
    if (/\b(?:kg|100\s*g|1\s*l|100\s*ml)\b/i.test(t) && h < medianH*1.4) return false;
    return h >= medianH*1.05 || /[,.-]\d{1,2}$/.test(a.rawText);
  });
  const out: ExtractedCandidate[]=[];
  const year = Number((meta.validTo || meta.validFrom || `${new Date().getFullYear()}`).slice(0,4)) || new Date().getFullYear();
  anchors.forEach((anchor,index)=>{
    const c=centerBox(anchor.bbox);
    const block=words.filter(w=>{ const p=centerWord(w); return p.x>=c.x-145&&p.x<=c.x+145&&p.y>=c.y-105&&p.y<=c.y+85; });
    if (!block.length) return;
    const lines=clusterIntoLines(block, Math.max(8,medianH*0.8)).map(normalizeLine).filter(Boolean);
    const source=textOf(block);
    const candidates=lines.filter(isPlausibleName).filter(s=>parsePriceText(s)===null).filter(s=>!PACK_RE.test(s) || /[A-Za-zÁ-ž]{4}/.test(s.replace(PACK_RE,"")));
    let name:string|null=null;
    for (const line of candidates) {
      if (/\b(?:cena|klub|balení|nabídka|katalog|sleva)\b/i.test(line)) continue;
      name=line; break;
    }
    const packM=source.match(PACK_RE);
    const standard=labelledPrice(source,/běžná\s*cena|původní\s*cena/i);
    const loyalty=labelledPrice(source,/s\s*klubem|s\s*kartou|klubová\s*cena/i);
    const noLoyalty=labelledPrice(source,/bez\s*klubu|bez\s*karty/i);
    const unitM=source.match(/(?:1\s*kg|100\s*g|1\s*l|100\s*ml)\s*[=:]?\s*(\d{1,4}[,.]\d{1,2})/i);
    const qtyM=source.match(/při\s+koupi(?:\s+od)?\s+(\d+)\s*ks/i);
    const promoM=source.match(/(při\s+koupi[^.;]{0,60}|s\s+Klubem[^.;]{0,40}|bez\s+Klubu[^.;]{0,40})/i);
    const itemV=itemValidity(source,year);
    const blockBox=bbox(block);
    const nameLine=name ? lines.find(l=>l===name) ?? name : null;
    const hasCore=Boolean(name && anchor.priceKc != null);
    out.push({
      candidate_key:`p${meta.pageNo}-a${index}-${Math.round(c.x)}-${Math.round(c.y)}`,
      page_no:meta.pageNo, source_bbox:blockBox, source_text:source || null,
      product_name:name, brand:null, variant:null,
      pack_qty:packM?1:null, pack_unit:packM?packM[2]!.toLowerCase():null, pack_unit_qty:packM?Number(packM[1]!.replace(",",".")):null, pack_text:packM?packM[0]:null,
      price_sale:anchor.priceKc, price_standard:standard, price_loyalty:loyalty, price_without_loyalty:noLoyalty,
      price_per_unit:unitM?parsePriceText(unitM[1]!):null, price_per_unit_unit:unitM?unitM[0]!.split(/[=:]/)[0]!.trim():null,
      leaflet_valid_from:meta.validFrom, leaflet_valid_to:meta.validTo, item_valid_from:itemV.from, item_valid_to:itemV.to,
      loyalty_required:loyalty!=null?true:null, promo_label:null, promo_condition:promoM?promoM[1]!.trim():null, minimum_quantity:qtyM?Number(qtyM[1]):null,
      field_evidence:{
        product_name:evidence(nameLine,blockBox), price_sale:evidence(anchor.rawText,{x:anchor.bbox.x0,y:anchor.bbox.y0,width:anchor.bbox.x1-anchor.bbox.x0,height:anchor.bbox.y1-anchor.bbox.y0}),
        price_standard:standard!=null?evidence("běžná/původní cena",blockBox):null,
        price_loyalty:loyalty!=null?evidence("s Klubem/s kartou",blockBox):null,
        price_without_loyalty:noLoyalty!=null?evidence("bez Klubu/bez karty",blockBox):null,
        pack_text:packM?evidence(packM[0],blockBox):null,
      },
      extraction_payload:{anchor:{price:anchor.priceKc,raw:anchor.rawText},lines}, extractor_version:EXTRACTOR_VERSION,
      confidence:hasCore?0.55:0.25, status:hasCore?"unreviewed":"quarantine",
      review_reason:hasCore?"Strojový kandidát čeká na kontrolu. Žádná hodnota není automaticky schválena.":"Není jednoznačně doložen název produktu a cena v jednom produktovém bloku."
    });
  });
  return out;
}
