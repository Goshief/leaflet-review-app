import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";
import { applyBrandAliases, loadBrandAliases } from "@/lib/leaflet-review/brand-resolver";
import { applyVariantEvidence } from "@/lib/leaflet-review/variant-resolver";
import { applyPromoEvidence } from "@/lib/leaflet-review/promo-resolver";

export const runtime="nodejs"; export const maxDuration=120;
const BUCKET="leaflet-intake", PATH="billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";
async function load(bytes:Uint8Array){const worker=await import("pdfjs-dist/legacy/build/pdf.worker.mjs");(globalThis as any).pdfjsWorker={WorkerMessageHandler:worker.WorkerMessageHandler};const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");return pdfjs.getDocument({data:bytes.slice()}).promise;}
async function words(doc:any):Promise<OcrWord[]>{const page=await doc.getPage(2),content=await page.getTextContent(),out:OcrWord[]=[];for(const raw of content.items){if(!("str" in raw)||typeof raw.str!=="string")continue;const text=raw.str.trim();if(!text)continue;const t=Array.isArray(raw.transform)?raw.transform:[1,0,0,1,0,0];out.push({text,x:Number(t[4]??0),y:Number(t[5]??0),w:Math.max(1,Number(raw.width??text.length*5)),h:Math.max(1,Number(raw.height??Math.abs(Number(t[3]??10))))});}return out;}
const near=(a:any,b:number)=>a!=null&&Math.abs(Number(a)-b)<.01;
export async function GET(){const gate=await requireOperatorApi();if(!gate.ok)return gate.response;const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});let doc:any=null;try{const {data,error}=await s.storage.from(BUCKET).download(PATH);if(error||!data)throw new Error(error?.message||"PDF chybí");doc=await load(new Uint8Array(await data.arrayBuffer()));const ws=await words(doc);const aliases=await loadBrandAliases(s);const raw=extractLeafletCandidates(ws,{pageNo:2,validFrom:"2026-08-19",validTo:"2026-08-25"});const trace=(price:number)=>{const a=raw.find(x=>near(x.price_sale,price));if(!a)return null;const b=applyBrandAliases(a,aliases);const v=applyVariantEvidence(b);const p=applyPromoEvidence(v,ws);return {source:a.source_text,raw:{name:a.product_name,status:a.status,reason:a.review_reason},brand_learning:{name:b.product_name,status:b.status,reason:b.review_reason,learning:(b.field_evidence as any)?.learning_feedback??null},variant:{name:v.product_name,status:v.status,reason:v.review_reason},promo_quality:{name:p.product_name,status:p.status,reason:p.review_reason,quality:(p.extraction_payload as any)?.quality_gate??null}}};return NextResponse.json({ok:true,lucina:trace(42.9),sunka:trace(26.9)});}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}finally{if(doc)await doc.destroy();}}
