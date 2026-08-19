import type { OcrWord } from "@/lib/ocr/types";
import { clusterIntoLines, unionWordsBBox } from "@/lib/ocr/price-anchors";
import { parsePriceText } from "@/lib/ocr/price-parse";

export const EXTRACTOR_VERSION = "leaflet-layout-v3";

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
type Anchor = { word: OcrWord; value: number; raw: string; cx: number; cy: number };
type Line = { words: OcrWord[]; text: string; y: number; height: number; bbox: ReturnType<typeof unionWordsBBox> };

const PACK_RE = /\b(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l|ks|kus|m)\b/i;
const UNIT_PRICE_PREFIX = /(?:1\s*kg|100\s*g|1\s*l|100\s*ml|1\s*m|1\s*ks)\s*=/i;
const GENERIC = /^(?:naše cena|cena|běžná cena|původní cena|cena za|cena při koupi|při koupi|při koupi balení|při koupi od \d+ ks|s klubem|bez klubu|s kartou|bez karty|více druhů|regionální|super pátek|pátek|více víkendových slev uvnitř|slev uvnitř|to dobré začíná u nás|na víkend už|ve čtvrtek|připravte se|do vyprodání zásob|v katalogu|akční nabídka)$/i;
const PROMO_ONLY = /^(?:-?\d+\s*%|od \d+\.\s*\d+\. do \d+\.\s*\d+\.|\d+\.\s*\d+\.|\d+\s*(?:ks|bal\.)|cena za \d+\s*(?:g|kg|ml|l|ks))$/i;
const DATE_TEXT = /(?:nabídka platí|platí od|\bod\s+\w*\s*\d{1,2}\.\s*\d{1,2}\.\s+do|\d{1,2}\.\s*\d{1,2}\.\s*[-–—]\s*\d{1,2}\.\s*\d{1,2}\.)/i;

function center(w: OcrWord) { return { x: w.x + w.w / 2, y: w.y + w.h / 2 }; }
function box(words: OcrWord[]) { const b = unionWordsBBox(words, 3); return b ? { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } : null; }
function lineText(words: OcrWord[]) { return words.slice().sort((a,b)=>a.x-b.x).map(w=>w.text.trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
function evidence(raw: string | null, bbox: unknown) { return raw ? { raw_text: raw, bbox: bbox ?? null, source: "pdf_text" } : null; }
function strictPrice(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g," ");
  if (!s || /%/.test(s) || /\b(?:kg|g|ml|l|ks|m)\b/i.test(s)) return null;
  const m = s.match(/^(?:Kč\s*)?(\d{1,3}(?:[ .]\d{3})*[,.]\d{2}|\d{1,3},-)(?:\s*Kč)?\/?$/i);
  if (!m) return null;
  const n = parsePriceText(m[1]!);
  return n != null && n > 0 && n < 1000 ? n : null;
}
function lineObjects(words: OcrWord[], medianH: number): Line[] {
  return clusterIntoLines(words, Math.max(5, medianH * 0.62)).map(ws => {
    const b=unionWordsBBox(ws,0); const hs=ws.map(w=>w.h).sort((a,b)=>a-b);
    return {words:ws,text:lineText(ws),y:b?(b.y0+b.y1)/2:0,height:hs[Math.floor(hs.length/2)]||medianH,bbox:b};
  }).filter(l=>l.text);
}
function isNameLine(s: string) {
  const t=s.trim();
  if(t.length<3||t.length>85||GENERIC.test(t)||PROMO_ONLY.test(t)||DATE_TEXT.test(t)||UNIT_PRICE_PREFIX.test(t)) return false;
  if(/^[-–—+\d\s.,%/=]+$/.test(t)) return false;
  if(/\b(?:kč|kc)\b/i.test(t)) return false;
  if(/\b(?:běžná cena|s klubem|bez klubu|při koupi|cena za|sleva|nabídka platí)\b/i.test(t)) return false;
  if(/^(?:naše|cena|balení|papír|volné|mix barev|více druhů)$/i.test(t)) return false;
  return /[A-Za-zÁ-ž]{3}/.test(t);
}
function findExplicitPrice(lines: Line[], rx: RegExp): {value:number; raw:string; bbox:unknown}|null {
  for(const l of lines){
    if(!rx.test(l.text)) continue;
    const prices=l.words.map(w=>({raw:w.text,value:strictPrice(w.text),w})).filter(x=>x.value!=null) as Array<{raw:string;value:number;w:OcrWord}>;
    if(!prices.length) continue;
    const chosen=prices[prices.length-1]!;
    return {value:chosen.value,raw:chosen.raw,bbox:box([chosen.w])};
  }
  return null;
}
function findUnitPrice(lines: Line[]) {
  for(const l of lines){
    if(!UNIT_PRICE_PREFIX.test(l.text)) continue;
    const m=l.text.match(/((?:1\s*kg|100\s*g|1\s*l|100\s*ml|1\s*m|1\s*ks))\s*=\s*(\d{1,4}[,.]\d{1,2})/i);
    if(m){const v=parsePriceText(m[2]!);if(v!=null)return {value:v,unit:m[1]!,raw:m[0],bbox:l.bbox};}
  }
  return null;
}
function itemValidity(text:string, year:number){
  const m=text.match(/\bod\s+(\d{1,2})\.\s*(\d{1,2})\.?\s+do\s+(\d{1,2})\.\s*(\d{1,2})\.?/i);if(!m)return{from:null,to:null};
  const p=(n:number)=>String(n).padStart(2,"0");return{from:`${year}-${p(Number(m[2]))}-${p(Number(m[1]))}`,to:`${year}-${p(Number(m[4]))}-${p(Number(m[3]))}`};
}
function assignWords(words: OcrWord[], anchors: Anchor[]) {
  const groups=anchors.map(()=>[] as OcrWord[]);
  for(const w of words){const p=center(w);let best=-1,bestScore=Infinity;anchors.forEach((a,i)=>{const dx=Math.abs(p.x-a.cx)/125;const dy=Math.abs(p.y-a.cy)/105;const score=dx*dx+dy*dy;if(score<bestScore){bestScore=score;best=i;}});if(best>=0&&bestScore<=1.65)groups[best]!.push(w);}
  return groups;
}

export function extractLeafletCandidates(words: OcrWord[], meta: Meta): ExtractedCandidate[] {
  if(!words.length)return[];
  const heights=words.map(w=>w.h).filter(h=>Number.isFinite(h)&&h>0).sort((a,b)=>a-b);const medianH=heights[Math.floor(heights.length/2)]||8;
  const minMainHeight=Math.max(16,medianH*1.85);
  const anchors:Anchor[]=[];
  for(const w of words){const value=strictPrice(w.text);if(value==null||w.h<minMainHeight)continue;const p=center(w);anchors.push({word:w,value,raw:w.text.trim(),cx:p.x,cy:p.y});}
  const dedup=anchors.filter((a,i,all)=>!all.some((b,j)=>j<i&&Math.abs(a.cx-b.cx)<10&&Math.abs(a.cy-b.cy)<10&&Math.abs(a.value-b.value)<0.001));
  const groups=assignWords(words,dedup);const year=Number((meta.validTo||meta.validFrom||String(new Date().getFullYear())).slice(0,4))||new Date().getFullYear();
  const out:ExtractedCandidate[]=[];
  dedup.forEach((a,index)=>{
    const group=groups[index]||[];if(!group.length)return;
    const lines=lineObjects(group,medianH);const mainLine=lines.find(l=>l.words.includes(a.word));
    const nameLines=lines.filter(l=>isNameLine(l.text)).sort((x,y)=>{
      const dx=Math.abs(x.y-a.cy),dy=Math.abs(y.y-a.cy);return dx-dy;
    });
    const near=nameLines.filter(l=>Math.abs(l.y-a.cy)<=80).slice(0,3);
    const selected=near.length?near.sort((x,y)=>y.y-x.y):[];
    let productName=selected.map(l=>l.text).join(" ").replace(/\s+/g," ").trim()||null;
    if(productName&&productName.length>100)productName=null;
    const nameBox=selected.length?box(selected.flatMap(l=>l.words)):null;
    const standard=findExplicitPrice(lines,/běžná\s*cena|původní\s*cena/i);
    const loyalty=findExplicitPrice(lines,/s\s*klubem|s\s*kartou|klubová\s*cena/i);
    const without=findExplicitPrice(lines,/bez\s*klubu|bez\s*karty/i);
    const unit=findUnitPrice(lines);
    const source=lines.slice().sort((x,y)=>y.y-x.y).map(l=>l.text).join(" | ");
    const pack=source.match(PACK_RE);const qty=source.match(/při\s+koupi(?:\s+od)?\s+(\d+)\s*ks/i);const promo=source.match(/(při\s+koupi[^|]{0,80}|s\s+Klubem[^|]{0,70}|bez\s+Klubu[^|]{0,70})/i);const iv=itemValidity(source,year);
    const hasCore=Boolean(productName&&a.value!=null);
    out.push({candidate_key:`p${meta.pageNo}-m${index}-${Math.round(a.cx)}-${Math.round(a.cy)}`,page_no:meta.pageNo,source_bbox:box(group),source_text:source||null,product_name:productName,brand:null,variant:null,pack_qty:pack?1:null,pack_unit:pack?pack[2]!.toLowerCase():null,pack_unit_qty:pack?Number(pack[1]!.replace(",",".")):null,pack_text:pack?pack[0]:null,price_sale:a.value,price_standard:standard?.value??null,price_loyalty:loyalty?.value??null,price_without_loyalty:without?.value??null,price_per_unit:unit?.value??null,price_per_unit_unit:unit?.unit??null,leaflet_valid_from:meta.validFrom,leaflet_valid_to:meta.validTo,item_valid_from:iv.from,item_valid_to:iv.to,loyalty_required:loyalty?true:null,promo_label:null,promo_condition:promo?promo[1]!.trim():null,minimum_quantity:qty?Number(qty[1]):null,field_evidence:{product_name:evidence(productName,nameBox),price_sale:evidence(a.raw,box([a.word])),price_standard:standard?evidence(standard.raw,standard.bbox):null,price_loyalty:loyalty?evidence(loyalty.raw,loyalty.bbox):null,price_without_loyalty:without?evidence(without.raw,without.bbox):null,price_per_unit:unit?evidence(unit.raw,unit.bbox):null,pack_text:pack?evidence(pack[0],box(group)):null},extraction_payload:{main_price:{raw:a.raw,value:a.value,height:a.word.h},min_main_height:minMainHeight,lines:lines.map(l=>l.text)},extractor_version:EXTRACTOR_VERSION,confidence:hasCore?0.62:0.2,status:hasCore?"unreviewed":"quarantine",review_reason:hasCore?"Kandidát vznikl z dominantní ceny a výhradně přiřazeného textového bloku. Stále vyžaduje lidské schválení.":"Dominantní cena byla nalezena, ale název produktu není jednoznačně doložen ve stejném bloku."});
  });
  return out;
}
