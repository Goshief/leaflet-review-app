import type { OcrWord } from "@/lib/ocr/types";
import type { ExtractedCandidate } from "./extractor";
import { applyCandidateQuality } from "./quality-resolver";

type PromoMatch={minimum_quantity:number;raw:string;source:"nearby_product_block_text"};
function inExpandedBox(w:OcrWord,b:{x:number;y:number;width:number;height:number}){const cx=w.x+w.w/2,cy=w.y+w.h/2;return cx>=b.x-20&&cx<=b.x+b.width+20&&cy>=b.y-26&&cy<=b.y+b.height+18;}
function clean(s:string){return s.replace(/\s+/g," ").trim();}
export function resolvePromoEvidence(candidate:ExtractedCandidate,words:OcrWord[]):PromoMatch|null{
 const b=candidate.source_bbox;if(!b)return null;
 const nearby=words.filter(w=>inExpandedBox(w,b));
 const od=nearby.map(w=>({w,m:clean(w.text).match(/^OD\s+(\d+)\s*KS$/i)})).filter(x=>x.m).sort((a,b)=>Math.abs((a.w.y+a.w.h/2)-candidate.source_bbox!.y)-Math.abs((b.w.y+b.w.h/2)-candidate.source_bbox!.y))[0];
 if(od?.m){const n=Number(od.m[1]);if(Number.isInteger(n)&&n>1&&n<100)return{minimum_quantity:n,raw:clean(od.w.text),source:"nearby_product_block_text"};}
 const direct=nearby.map(w=>({w,m:clean(w.text).match(/^PŘI\s+KOUPI(?:\s+OD)?\s+(\d+)\s*KS$/i)})).find(x=>x.m);
 if(direct?.m){const n=Number(direct.m[1]);if(Number.isInteger(n)&&n>0&&n<100)return{minimum_quantity:n,raw:clean(direct.w.text),source:"nearby_product_block_text"};}
 return null;
}
export function applyPromoEvidence(candidate:ExtractedCandidate,words:OcrWord[]):ExtractedCandidate{
 const found=resolvePromoEvidence(candidate,words);
 const enriched=found?{...candidate,minimum_quantity:found.minimum_quantity,promo_condition:found.raw,field_evidence:{...candidate.field_evidence,promo_condition:{raw_text:found.raw,source:found.source}},extraction_payload:{...candidate.extraction_payload,promo_resolution:found}}:candidate;
 return applyCandidateQuality(enriched);
}
