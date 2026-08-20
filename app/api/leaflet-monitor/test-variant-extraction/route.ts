import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";
import { applyVariantEvidence } from "@/lib/leaflet-review/variant-resolver";

export const runtime="nodejs";
export const maxDuration=120;
const BUCKET="leaflet-intake";
const SOURCE_PATH="billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";
async function loadPdfDocument(bytes:Uint8Array){const worker=await import("pdfjs-dist/legacy/build/pdf.worker.mjs");(globalThis as typeof globalThis&{pdfjsWorker?:unknown}).pdfjsWorker={WorkerMessageHandler:worker.WorkerMessageHandler};const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs");return pdfjs.getDocument({data:bytes.slice()}).promise;}
async function pageWords(doc:any){const page=await doc.getPage(1);const content=await page.getTextContent();const words:OcrWord[]=[];for(const raw of content.items){if(!("str" in raw)||typeof raw.str!=="string")continue;const text=raw.str.trim();if(!text)continue;const t=Array.isArray(raw.transform)?raw.transform:[1,0,0,1,0,0];words.push({text,x:Number(t[4]??0),y:Number(t[5]??0),w:Math.max(1,Number(raw.width??text.length*5)),h:Math.max(1,Number(raw.height??Math.abs(Number(t[3]??10))))});}return words;}
const eq=(a:unknown,b:number)=>Math.abs(Number(a)-b)<0.001;
export async function GET(){const gate=await requireOperatorApi();if(!gate.ok)return gate.response;const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});let doc:any=null;try{const{data,error}=await s.storage.from(BUCKET).download(SOURCE_PATH);if(error||!data)throw new Error(error?.message||"BILLA PDF chybí.");doc=await loadPdfDocument(new Uint8Array(await data.arrayBuffer()));const rows=extractLeafletCandidates(await pageWords(doc),{pageNo:1,validFrom:"2026-08-19",validTo:"2026-08-25"}).map(applyVariantEvidence);const at=(price:number,needle?:RegExp)=>rows.find(r=>eq(r.price_sale,price)&&(!needle||needle.test(String(r.source_text||""))));const checks=[
{id:"hrozny_vinne_bile",value:at(39.9,/Hrozny/i)?.variant??null,ok:at(39.9,/Hrozny/i)?.variant==="vinné bílé"},
{id:"brambory_rane",value:at(9.9,/Brambory/i)?.variant??null,ok:at(9.9,/Brambory/i)?.variant==="rané"},
{id:"milka_generic_druhy_null",value:at(24.9,/Milka/i)?.variant??null,ok:at(24.9,/Milka/i)?.variant==null},
{id:"toffifee_generic_druhy_null",value:at(29.9,/Toffifee/i)?.variant??null,ok:at(29.9,/Toffifee/i)?.variant==null},
{id:"prosecco_no_variant_null",value:at(259.8,/Prosecco/i)?.variant??null,ok:at(259.8,/Prosecco/i)?.variant==null},
];const failures=checks.filter(x=>!x.ok).map(x=>x.id);return NextResponse.json({ok:true,point_5c:{pass:failures.length===0,checks,failures}});}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}finally{if(doc)await doc.destroy();}}
