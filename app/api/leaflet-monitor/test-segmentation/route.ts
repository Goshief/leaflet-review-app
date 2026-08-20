import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "@/lib/leaflet-review/extractor";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";
const DEBUG_RE = /^(?:Kuře|Anglická|slanina|Pilsner|Urquell|Toaletní|papír|Milka|Čokoláda|Jihočeské|máslo)$/i;

async function loadPdfDocument(bytes: Uint8Array) {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = { WorkerMessageHandler: worker.WorkerMessageHandler };
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}
async function pageWords(doc:any,pageNo:number):Promise<OcrWord[]>{const page=await doc.getPage(pageNo);const content=await page.getTextContent();const words:OcrWord[]=[];for(const raw of content.items){if(!("str" in raw)||typeof raw.str!=="string")continue;const text=raw.str.trim();if(!text)continue;const t=Array.isArray(raw.transform)?raw.transform:[1,0,0,1,0,0];words.push({text,x:Number(t[4]??0),y:Number(t[5]??0),w:Math.max(1,Number(raw.width??text.length*5)),h:Math.max(1,Number(raw.height??Math.abs(Number(t[3]??10))))});}return words;}
function region(words:OcrWord[],x0:number,x1:number,y0:number,y1:number){return words.filter(w=>w.x+w.w/2>=x0&&w.x+w.w/2<=x1&&w.y+w.h/2>=y0&&w.y+w.h/2<=y1).sort((a,b)=>b.y-a.y||a.x-b.x).map(w=>({text:w.text,x:Math.round(w.x*10)/10,y:Math.round(w.y*10)/10,w:Math.round(w.w*10)/10,h:Math.round(w.h*10)/10}));}
const eq=(a:unknown,b:number)=>Math.abs(Number(a)-b)<0.001;

export async function GET(){const gate=await requireOperatorApi();if(!gate.ok)return gate.response;const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});let doc:any=null;try{const{data:source,error}=await s.storage.from(BUCKET).download(SOURCE_PATH);if(error||!source)throw new Error(error?.message||"BILLA PDF chybí.");const bytes=new Uint8Array(await source.arrayBuffer());doc=await loadPdfDocument(bytes);const words=await pageWords(doc,1);const candidates=extractLeafletCandidates(words,{pageNo:1,validFrom:"2026-08-19",validTo:"2026-08-25"});
  const genericMixed=candidates.filter(r=>{const text=String(r.source_text||"");const names=Array.isArray(r.extraction_payload?.name_candidates)?r.extraction_payload.name_candidates as unknown[]:[];return names.length>=4||text.split(" | ").length>=13;});
  const knownContamination=candidates.filter(r=>{const text=String(r.source_text||"");return(/\bKuře\b/i.test(text)&&/Anglická\s*\|?\s*slanina/i.test(text))||(/\bPilsner\b/i.test(text)&&/1\s*m\s*=\s*0,28/i.test(text));});
  const atPrice=(price:number)=>candidates.filter(r=>eq(r.price_sale,price));
  const checks=[
    {id:"kure_49_90",ok:atPrice(49.9).some(r=>/\bKuře\b/i.test(String(r.source_text||""))&&!/Anglická|slanina/i.test(String(r.source_text||"")))},
    {id:"toaletni_99_90",ok:atPrice(99.9).some(r=>/(?:Toaletní|papír)/i.test(String(r.source_text||""))&&!/(?:Pilsner|Urquell)/i.test(String(r.source_text||"")))},
    {id:"pilsner_28_83",ok:atPrice(28.83).some(r=>/Urquell/i.test(String(r.source_text||""))&&/6×\s*0,5\s*l/i.test(String(r.source_text||""))&&!/Jihočeské\s+máslo/i.test(String(r.source_text||"")))},
    {id:"maslo_32_90",ok:atPrice(32.9).some(r=>/Jihočeské\s+máslo/i.test(String(r.source_text||""))&&/250\s*g/i.test(String(r.source_text||""))&&!/(?:Pilsner|Urquell)/i.test(String(r.source_text||"")))},
    {id:"brambory_9_90",ok:atPrice(9.9).some(r=>/Brambory/i.test(String(r.source_text||"")))},
    {id:"hrozny_39_90",ok:atPrice(39.9).some(r=>/Hrozny/i.test(String(r.source_text||"")))},
    {id:"rajcata_39_90",ok:atPrice(39.9).some(r=>/Rajčata/i.test(String(r.source_text||"")))},
    {id:"tvaroh_18_90",ok:atPrice(18.9).some(r=>/Tvaroh/i.test(String(r.source_text||"")))},
  ];
  const standardChecks=[
    {id:"kure_std_89_90",ok:atPrice(49.9).some(r=>eq(r.price_standard,89.9))},
    {id:"toaletni_std_139_90",ok:atPrice(99.9).some(r=>eq(r.price_standard,139.9))},
    {id:"maslo_std_44_90",ok:atPrice(32.9).some(r=>eq(r.price_standard,44.9))},
    {id:"vejce_std_139_90",ok:atPrice(84.9).some(r=>eq(r.price_standard,139.9))},
    {id:"veprova_std_209_90",ok:atPrice(74.9).some(r=>eq(r.price_standard,209.9))},
    {id:"toffifee_std_54_90",ok:atPrice(29.9).some(r=>eq(r.price_standard,54.9))},
    {id:"tvaroh_std_29_90",ok:atPrice(18.9).some(r=>eq(r.price_standard,29.9))},
    {id:"brambory_std_24_90",ok:atPrice(9.9).some(r=>eq(r.price_standard,24.9))},
  ];
  const loyaltyChecks=[
    {id:"maslo_loyalty_32_90",ok:atPrice(32.9).some(r=>eq(r.price_loyalty,32.9)&&eq(r.price_without_loyalty,44.9)&&r.loyalty_required===true)},
    {id:"vejce_loyalty_84_90",ok:atPrice(84.9).some(r=>eq(r.price_loyalty,84.9)&&eq(r.price_without_loyalty,139.9)&&r.loyalty_required===true)},
    {id:"toffifee_loyalty_29_90",ok:atPrice(29.9).some(r=>eq(r.price_loyalty,29.9)&&eq(r.price_without_loyalty,54.9)&&r.loyalty_required===true)},
    {id:"kure_not_loyalty",ok:atPrice(49.9).some(r=>r.price_loyalty==null&&r.price_without_loyalty==null&&r.loyalty_required==null)},
  ];
  const blockChecks=[
    {id:"kure_block_fields",ok:atPrice(49.9).some(r=>/\bKuře\b/i.test(String(r.source_text||""))&&r.pack_text==="1 kg"&&!/slanina/i.test(String(r.source_text||"")))},
    {id:"pilsner_block_fields",ok:atPrice(28.83).some(r=>/Urquell/i.test(String(r.source_text||""))&&r.pack_text==="0,5 l"&&eq(r.price_per_unit,57.67)&&/^1\s*l$/i.test(String(r.price_per_unit_unit||""))&&!/Jihočeské\s+máslo/i.test(String(r.source_text||"")))},
    {id:"tvaroh_block_fields",ok:atPrice(18.9).some(r=>/Tvaroh/i.test(String(r.source_text||""))&&r.pack_text==="250 g"&&eq(r.price_per_unit,7.56)&&/^100\s*g$/i.test(String(r.price_per_unit_unit||"")))},
    {id:"rajcata_block_fields",ok:atPrice(39.9).some(r=>/Rajčata/i.test(String(r.source_text||""))&&r.pack_text==="250 g"&&eq(r.price_per_unit,15.96)&&/^100\s*g$/i.test(String(r.price_per_unit_unit||"")))},
    {id:"prosecco_block_fields",ok:atPrice(259.8).some(r=>/Prosecco/i.test(String(r.source_text||""))&&r.pack_text==="0,75 l"&&eq(r.price_per_unit,346.4)&&/^1\s*l$/i.test(String(r.price_per_unit_unit||"")))},
    {id:"toaletni_block_fields",ok:atPrice(99.9).some(r=>/(?:Toaletní|papír)/i.test(String(r.source_text||""))&&r.pack_text==="360 m"&&eq(r.price_per_unit,0.28)&&/^1\s*m$/i.test(String(r.price_per_unit_unit||""))&&!/(?:Pilsner|Urquell)/i.test(String(r.source_text||"")))},
  ];
  const failures=checks.filter(c=>!c.ok).map(c=>c.id);const standardFailures=standardChecks.filter(c=>!c.ok).map(c=>c.id);const loyaltyFailures=loyaltyChecks.filter(c=>!c.ok).map(c=>c.id);const blockFailures=blockChecks.filter(c=>!c.ok).map(c=>c.id);const named=candidates.filter(r=>typeof r.product_name==="string"&&r.product_name.trim());const quarantine=candidates.filter(r=>r.status==="quarantine");const debugWords=words.filter(w=>DEBUG_RE.test(w.text.trim())).map(w=>({text:w.text,x:w.x,y:w.y,w:w.w,h:w.h}));
  return NextResponse.json({ok:true,page_no:1,extractor_version:candidates[0]?.extractor_version??null,total:candidates.length,named:named.length,quarantine:quarantine.length,suspiciously_mixed:genericMixed.length,known_contamination:knownContamination.length,point_4c:{pass:failures.length===0,checks,failures},point_4d:{pass:standardFailures.length===0,checks:standardChecks,failures:standardFailures},point_4e:{pass:loyaltyFailures.length===0,checks:loyaltyChecks,failures:loyaltyFailures},point_4f:{pass:blockFailures.length===0,checks:blockChecks,failures:blockFailures},debug_words:debugWords,debug_regions:{kuře_49_90:region(words,275,440,575,710),pilsner_99_90:region(words,275,445,95,230),price_28_83:region(words,275,445,0,130)},candidates:candidates.map(r=>({key:r.candidate_key,name:r.product_name,price:r.price_sale,standard:r.price_standard,loyalty:r.price_loyalty,without_loyalty:r.price_without_loyalty,loyalty_required:r.loyalty_required,pack:r.pack_text,pack_qty:r.pack_qty,pack_unit:r.pack_unit,pack_unit_qty:r.pack_unit_qty,unit_price:r.price_per_unit,unit_price_unit:r.price_per_unit_unit,status:r.status,reason:r.review_reason,source:r.source_text,bounds:r.extraction_payload?.block_bounds??null,name_candidates:r.extraction_payload?.name_candidates??[]}))});
}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}finally{if(doc)await doc.destroy();}}
