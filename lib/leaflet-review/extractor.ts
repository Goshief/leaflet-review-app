import type { OcrWord } from "@/lib/ocr/types";
import { clusterIntoLines, unionWordsBBox } from "@/lib/ocr/price-anchors";
import { parsePriceText } from "@/lib/ocr/price-parse";

export const EXTRACTOR_VERSION = "leaflet-layout-v4";

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
const GENERIC = /^(?:naše cena|naše|cena|běžná cena|původní cena|cena za|cena při koupi|při koupi|při koupi balení|při koupi od \d+ ks|s klubem|bez klubu|s kartou|bez karty|více druhů|regionální|super pátek|pátek|více víkendových slev uvnitř|slev uvnitř|to dobré začíná u nás|na víkend už|ve čtvrtek|připravte se|do vyprodání zásob|v katalogu|akční nabídka|cena za 1 ks|cena za 1 kg)$/i;
const PROMO_ONLY = /^(?:-?\d+\s*%|od \d+\.\s*\d+\. do \d+\.\s*\d+\.|\d+\.\s*\d+\.|\d+\s*(?:ks|bal\.)|cena za \d+\s*(?:g|kg|ml|l|ks))$/i;
const DATE_TEXT = /(?:nabídka platí|platí od|\bod\s+\w*\s*\d{1,2}\.\s*\d{1,2}\.\s+do|\d{1,2}\.\s*\d{1,2}\.\s*[-–—]\s*\d{1,2}\.\s*\d{1,2}\.)/i;
const MONEY_LIKE = /\b\d{1,3}[,.]\d{2}\b/;
const BAD_NAME_FRAGMENT = /\b(?:běžná cena|původní cena|s klubem|bez klubu|s kartou|bez karty|při koupi|cena za|sleva|nabídka platí|super pátek|více víkendových|do vyprodání|od \d+\.\s*\d+\.|do \d+\.\s*\d+\.)\b/i;

function center(w: OcrWord) { return { x: w.x + w.w / 2, y: w.y + w.h / 2 }; }
function box(words: OcrWord[]) { const b = unionWordsBBox(words, 3); return b ? { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 } : null; }
function lineText(words: OcrWord[]) { return words.slice().sort((a,b)=>a.x-b.x).map(w=>w.text.trim()).filter(Boolean).join(" ").replace(/\s+/g," ").trim(); }
function evidence(raw: string | null, bbox: unknown) { return raw ? { raw_text: raw, bbox: bbox ?? null, source: "pdf_text" } : null; }

function strictPrice(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g," ");
  if (!s || /%/.test(s) || /\b(?:kg|g|ml|l|ks|m)\b/i.test(s)) return null;
  // A main CZ price must be visually printed as a decimal price (e.g. 49,90 / 49,-).
  // Deliberately reject embedded spaces such as "250 7,56"; that is pack text + unit price, not 2507.56 Kč.
  const m = s.match(/^(?:Kč\s*)?(\d{1,3}[,.]\d{2}|\d{1,3},-)(?:\s*Kč)?\/?$/i);
  if (!m) return null;
  const n = parsePriceText(m[1]!);
  return n != null && n > 0 && n < 1000 ? n : null;
}

function lineObjects(words: OcrWord[], medianH: number): Line[] {
  return clusterIntoLines(words, Math.max(4, medianH * 0.52)).map(ws => {
    const b=unionWordsBBox(ws,0); const hs=ws.map(w=>w.h).sort((a,b)=>a-b);
    return {words:ws,text:lineText(ws),y:b?(b.y0+b.y1)/2:0,height:hs[Math.floor(hs.length/2)]||medianH,bbox:b};
  }).filter(l=>l.text);
}

function cleanNameText(text:string):string {
  return text
    .replace(/\b\d{1,3}[,.]\d{2}\/?\b/g," ")
    .replace(/-?\d+\s*%/g," ")
    .replace(/\b(?:běžná cena|původní cena|s klubem|bez klubu|s kartou|bez karty|cena za \d+\s*(?:g|kg|ml|l|ks)|cena za|při koupi(?: balení)?|od \d+ ks)\b/gi," ")
    .replace(/\s+/g," ").trim();
}

function isNameText(s: string) {
  const t=s.trim();
  if(t.length<3||t.length>80||GENERIC.test(t)||PROMO_ONLY.test(t)||DATE_TEXT.test(t)||UNIT_PRICE_PREFIX.test(t)) return false;
  if(/^[-–—+\d\s.,%/=]+$/.test(t)) return false;
  if(/\b(?:kč|kc)\b/i.test(t)||BAD_NAME_FRAGMENT.test(t)) return false;
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

function globalLineForWord(lines:Line[], word:OcrWord):Line|null {
  return lines.find(l=>l.words.includes(word)) ?? null;
}

function isSecondaryPriceLine(line:Line|null, raw:string):boolean {
  if(!line) return false;
  const t=line.text;
  if(UNIT_PRICE_PREFIX.test(t)) return true;
  if(/\b(?:běžná cena|původní cena|bez klubu|s klubem|bez karty|s kartou|cena za 100|cena za 1\s*(?:kg|l|m|ks))\b/i.test(t)) return true;
  // If the line contains several distinct decimal prices, it is an explanatory price line, not a safe main-price anchor.
  const prices=[...t.matchAll(/\b\d{1,3}[,.]\d{2}\b/g)].map(m=>m[0]);
  return prices.length > 1 && !prices.includes(raw.replace(/\/$/,""));
}

function assignWords(words: OcrWord[], anchors: Anchor[]) {
  const groups=anchors.map(()=>[] as OcrWord[]);
  for(const w of words){
    const p=center(w);let best=-1,bestScore=Infinity;
    anchors.forEach((a,i)=>{
      const dx=Math.abs(p.x-a.cx); const dy=Math.abs(p.y-a.cy);
      if(dx>92||dy>78)return;
      const score=(dx/92)**2+(dy/78)**2;
      if(score<bestScore){bestScore=score;best=i;}
    });
    if(best>=0&&bestScore<=1.08)groups[best]!.push(w);
  }
  return groups;
}

function chooseNameLines(lines:Line[], anchor:Anchor):Line[] {
  const candidates=lines
    .map(l=>({line:l,clean:cleanNameText(l.text)}))
    .filter(x=>isNameText(x.clean))
    .filter(x=>Math.abs(x.line.y-anchor.cy)<=68)
    .sort((a,b)=>{
      const da=Math.abs(a.line.y-anchor.cy); const db=Math.abs(b.line.y-anchor.cy);
      if(Math.abs(da-db)>4)return da-db;
      return b.line.height-a.line.height;
    });
  if(!candidates.length)return[];
  const first=candidates[0]!;
  const selected=[first.line];
  // A second adjacent textual line is allowed only when it is spatially close; this supports names split over two lines.
  const second=candidates.slice(1).find(x=>Math.abs(x.line.y-first.line.y)<=24 && Math.abs(x.line.y-anchor.cy)<=68);
  if(second)selected.push(second.line);
  return selected;
}

export function extractLeafletCandidates(words: OcrWord[], meta: Meta): ExtractedCandidate[] {
  if(!words.length)return[];
  const heights=words.map(w=>w.h).filter(h=>Number.isFinite(h)&&h>0).sort((a,b)=>a-b);const medianH=heights[Math.floor(heights.length/2)]||8;
  const minMainHeight=Math.max(18,medianH*2.05);
  const globalLines=lineObjects(words,medianH);
  const anchors:Anchor[]=[];
  for(const w of words){
    const value=strictPrice(w.text);if(value==null||w.h<minMainHeight)continue;
    const containing=globalLineForWord(globalLines,w);
    if(isSecondaryPriceLine(containing,w.text.trim()))continue;
    const p=center(w);anchors.push({word:w,value,raw:w.text.trim(),cx:p.x,cy:p.y});
  }
  const dedup=anchors.filter((a,i,all)=>!all.some((b,j)=>j<i&&Math.abs(a.cx-b.cx)<10&&Math.abs(a.cy-b.cy)<10&&Math.abs(a.value-b.value)<0.001));
  const groups=assignWords(words,dedup);const year=Number((meta.validTo||meta.validFrom||String(new Date().getFullYear())).slice(0,4))||new Date().getFullYear();
  const out:ExtractedCandidate[]=[];
  dedup.forEach((a,index)=>{
    const group=groups[index]||[];if(!group.length)return;
    const lines=lineObjects(group,medianH);
    const selected=chooseNameLines(lines,a);
    const cleanedNames=selected.map(l=>cleanNameText(l.text)).filter(isNameText);
    let productName=cleanedNames.join(" ").replace(/\s+/g," ").trim()||null;
    if(productName&&productName.length>100)productName=null;
    const nameBox=selected.length?box(selected.flatMap(l=>l.words)):null;
    const standard=findExplicitPrice(lines,/běžná\s*cena|původní\s*cena/i);
    const loyalty=findExplicitPrice(lines,/s\s*klubem|s\s*kartou|klubová\s*cena/i);
    const without=findExplicitPrice(lines,/bez\s*klubu|bez\s*karty/i);
    const unit=findUnitPrice(lines);
    const source=lines.slice().sort((x,y)=>y.y-x.y).map(l=>l.text).join(" | ");
    const pack=source.match(PACK_RE);const qty=source.match(/při\s+koupi(?:\s+od)?\s+(\d+)\s*ks/i);const promo=source.match(/(při\s+koupi[^|]{0,80}|s\s+Klubem[^|]{0,70}|bez\s+Klubu[^|]{0,70})/i);const iv=itemValidity(source,year);
    const ambiguousName=!productName || MONEY_LIKE.test(productName) || BAD_NAME_FRAGMENT.test(productName);
    const hasCore=!ambiguousName&&a.value!=null;
    out.push({candidate_key:`p${meta.pageNo}-v4-${index}-${Math.round(a.cx)}-${Math.round(a.cy)}`,page_no:meta.pageNo,source_bbox:box(group),source_text:source||null,product_name:hasCore?productName:null,brand:null,variant:null,pack_qty:pack?1:null,pack_unit:pack?pack[2]!.toLowerCase():null,pack_unit_qty:pack?Number(pack[1]!.replace(",",".")):null,pack_text:pack?pack[0]:null,price_sale:a.value,price_standard:standard?.value??null,price_loyalty:loyalty?.value??null,price_without_loyalty:without?.value??null,price_per_unit:unit?.value??null,price_per_unit_unit:unit?.unit??null,leaflet_valid_from:meta.validFrom,leaflet_valid_to:meta.validTo,item_valid_from:iv.from,item_valid_to:iv.to,loyalty_required:loyalty?true:null,promo_label:null,promo_condition:promo?promo[1]!.trim():null,minimum_quantity:qty?Number(qty[1]):null,field_evidence:{product_name:hasCore?evidence(productName,nameBox):null,price_sale:evidence(a.raw,box([a.word])),price_standard:standard?evidence(standard.raw,standard.bbox):null,price_loyalty:loyalty?evidence(loyalty.raw,loyalty.bbox):null,price_without_loyalty:without?evidence(without.raw,without.bbox):null,price_per_unit:unit?evidence(unit.raw,unit.bbox):null,pack_text:pack?evidence(pack[0],box(group)):null},extraction_payload:{main_price:{raw:a.raw,value:a.value,height:a.word.h,x:a.word.x,y:a.word.y},min_main_height:minMainHeight,lines:lines.map(l=>l.text),name_lines:cleanedNames},extractor_version:EXTRACTOR_VERSION,confidence:hasCore?0.55:0.15,status:hasCore?"unreviewed":"quarantine",review_reason:hasCore?"Kandidát je svázaný pouze s lokálním blokem dominantní ceny. Automatické schválení je zakázané; člověk musí ověřit vazbu proti náhledu stránky.":"Dominantní cena existuje, ale název produktu není v lokálním bloku jednoznačně doložen. Hodnota se nesmí domýšlet."});
  });
  return out;
}
