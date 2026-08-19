import { createHash } from "node:crypto";
import type { OcrWord } from "@/lib/ocr/types";
import { extractLeafletCandidates } from "./extractor";

const EXTRACTOR_MODEL = "local-pdf-text-layout-v2";

function pad(n:number){return String(n).padStart(2,"0")}
function iso(y:number,m:number,d:number){return `${y}-${pad(m)}-${pad(d)}`}

function parseValidity(text:string, path:string): {from:string|null;to:string|null} {
  const file=path.match(/(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})-(\d{4})/);
  if(file) return {from:`${file[3]}-${file[2]}-${file[1]}`,to:`${file[6]}-${file[5]}-${file[4]}`};
  const explicit=text.match(/(?:nabídka\s+platí[^\d]{0,30})?(?:od\s+)?(\d{1,2})\.\s*(\d{1,2})\.?\s*(?:do|[-–—])\s*(?:\w+\s+)?(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})/i);
  if(explicit) return {from:iso(Number(explicit[5]),Number(explicit[2]),Number(explicit[1])),to:iso(Number(explicit[5]),Number(explicit[4]),Number(explicit[3]))};
  const range=text.match(/(\d{1,2})\.\s*(\d{1,2})\.?\s*[-–—]\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})?/);
  if(range){const y=Number(range[5]||new Date().getFullYear());return {from:iso(y,Number(range[2]),Number(range[1])),to:iso(y,Number(range[4]),Number(range[3]))}}
  return {from:null,to:null};
}

async function ensureImport(supabase:any,args:{bucket:string;path:string;retailer:string;sourceUrl:string|null}){
  const key=`leaflet-staging:${args.bucket}:${args.path}`;
  const {data:old,error:oe}=await supabase.from("imports").select("id").eq("import_batch_key",key).maybeSingle();
  if(oe) throw new Error(`imports lookup: ${oe.message}`);
  if(typeof old?.id==="string") return old.id;
  const {data,error}=await supabase.from("imports").insert({source_type:"leaflet",source_url:args.sourceUrl,note:`leaflet_staging | retailer:${args.retailer} | storage:${args.bucket}/${args.path}`,import_batch_key:key,import_contract_version:"leaflet-staging-v2",import_contract_snapshot:{retailer:args.retailer,bucket:args.bucket,path:args.path,model:EXTRACTOR_MODEL}}).select("id").single();
  if(error||typeof data?.id!=="string") throw new Error(error?.message||"Import nebyl vytvořen.");
  return data.id;
}

async function pageWords(doc:any,pageNo:number):Promise<{words:OcrWord[];text:string}> {
  const page=await doc.getPage(pageNo); const content=await page.getTextContent(); const words:OcrWord[]=[]; const parts:string[]=[];
  for(const raw of content.items){
    if(!("str" in raw)||typeof raw.str!=="string") continue; const text=raw.str.trim(); if(!text) continue;
    const t=Array.isArray(raw.transform)?raw.transform:[1,0,0,1,0,0];
    words.push({text,x:Number(t[4]??0),y:Number(t[5]??0),w:Math.max(1,Number(raw.width??text.length*5)),h:Math.max(1,Number(raw.height??Math.abs(Number(t[3]??10))))}); parts.push(text);
  }
  return {words,text:parts.join(" ")};
}

async function refreshCounts(supabase:any,leafletId:string,pageCount:number,processedPages:number,failed=false){
  const {data,error}=await supabase.from("leaflet_item_candidates").select("status").eq("leaflet_id",leafletId); if(error) throw new Error(error.message);
  const rows=data??[]; const count=(s:string)=>rows.filter((r:any)=>r.status===s).length;
  const unreviewed=count("unreviewed")+count("needs_reread"); const approved=count("approved"), rejected=count("rejected"), quarantine=count("quarantine");
  const reviewed=approved+rejected; const status=failed?"failed":processedPages<pageCount?"processing":unreviewed+quarantine>0?"ready_for_review":"completed";
  const {error:u}=await supabase.from("leaflet_documents").update({page_count:pageCount,processed_pages:processedPages,candidate_count:rows.length,unreviewed_count:unreviewed,approved_count:approved,rejected_count:rejected,quarantine_count:quarantine,processing_status:status,processing_completed_at:processedPages>=pageCount?new Date().toISOString():null,updated_at:new Date().toISOString()}).eq("id",leafletId); if(u) throw new Error(u.message);
  return {candidate_count:rows.length,unreviewed_count:unreviewed,approved_count:approved,rejected_count:rejected,quarantine_count:quarantine,processing_status:status,reviewed_count:reviewed};
}

async function queueNotification(supabase:any,leaflet:any,counts:any){
  const subject=`${String(leaflet.retailer_id).toUpperCase()} – nový leták ke kontrole`;
  const body=`Na ${String(leaflet.retailer_id).toUpperCase()} je nový leták. Zpracováno ${leaflet.page_count} stran, nalezeno ${counts.candidate_count} položek, ${counts.unreviewed_count+counts.quarantine_count} čeká na kontrolu.`;
  await supabase.from("leaflet_notification_outbox").upsert({leaflet_id:leaflet.id,subject,body_text:body,status:"pending"},{onConflict:"leaflet_id,channel"});
  await supabase.from("leaflet_documents").update({notification_status:"queued"}).eq("id",leaflet.id);
}

export async function processLeafletPdf(args:{supabase:any;bucket:string;path:string;retailer:string;sourceUrl:string|null;bytes?:Uint8Array;page?:number|null;force?:boolean}){
  const {supabase,bucket,path,retailer}=args;
  let bytes=args.bytes; if(!bytes){const {data,error}=await supabase.storage.from(bucket).download(path);if(error||!data)throw new Error(error?.message||"PDF nebylo nalezeno.");bytes=new Uint8Array(await data.arrayBuffer());}
  const pdfjs=await import("pdfjs-dist/legacy/build/pdf.mjs"); const task=pdfjs.getDocument({data:bytes}); const doc=await task.promise;
  try{
    const importId=await ensureImport(supabase,{bucket,path,retailer,sourceUrl:args.sourceUrl});
    let firstText=""; for(let p=1;p<=Math.min(2,doc.numPages);p++){firstText+=(await pageWords(doc,p)).text+" ";}
    const validity=parseValidity(firstText,path); const filename=path.split("/").pop()||path; const internalKey=`${retailer}:${createHash("sha1").update(`${bucket}/${path}`).digest("hex")}`;
    const base={retailer_id:retailer,storage_bucket:bucket,storage_path:path,filename,source_url:args.sourceUrl,source_leaflet_number:null,internal_leaflet_key:internalKey,valid_from:validity.from,valid_to:validity.to,page_count:doc.numPages,processing_status:"processing",import_id:importId,processing_error:null,updated_at:new Date().toISOString()};
    const {data:leaflet,error:le}=await supabase.from("leaflet_documents").upsert(base,{onConflict:"storage_bucket,storage_path"}).select("*").single(); if(le||!leaflet)throw new Error(le?.message||"Leaflet document nebyl uložen.");
    const pages=args.page?[args.page]:Array.from({length:doc.numPages},(_,i)=>i+1); let processed=0;
    for(const pageNo of pages){
      if(pageNo<1||pageNo>doc.numPages) throw new Error(`Stránka musí být 1 až ${doc.numPages}.`);
      const page=await pageWords(doc,pageNo);
      const extracted=extractLeafletCandidates(page.words,{pageNo,validFrom:validity.from,validTo:validity.to});
      const {data:existing}=await supabase.from("leaflet_item_candidates").select("candidate_key,status").eq("leaflet_id",leaflet.id).eq("page_no",pageNo);
      const locked=new Set((existing??[]).filter((x:any)=>["approved","rejected"].includes(x.status)).map((x:any)=>x.candidate_key));
      for(const c of extracted){
        if(locked.has(c.candidate_key)) continue;
        const row={leaflet_id:leaflet.id,...c,currency:"CZK",extractor_version:c.extraction_payload?"leaflet-evidence-v2":"leaflet-evidence-v2",updated_at:new Date().toISOString()};
        const {data:saved,error:se}=await supabase.from("leaflet_item_candidates").upsert(row,{onConflict:"leaflet_id,candidate_key"}).select("id").single(); if(se) throw new Error(`candidate: ${se.message}`);
        if(saved?.id) await supabase.from("leaflet_item_review_audit").insert({candidate_id:saved.id,action:"extracted",next_payload:row,note:"Automatická evidence-first extrakce; bez schválení."});
      }
      processed++;
    }
    const processedPages=args.page?Math.max(Number(leaflet.processed_pages||0),processed):doc.numPages;
    const counts=await refreshCounts(supabase,leaflet.id,doc.numPages,processedPages);
    const current={...leaflet,page_count:doc.numPages,processed_pages:processedPages,...counts,valid_from:validity.from,valid_to:validity.to};
    if(!args.page&&processedPages>=doc.numPages) await queueNotification(supabase,current,counts);
    const {data:candidates}=await supabase.from("leaflet_item_candidates").select("*").eq("leaflet_id",leaflet.id).order("page_no").limit(args.page?500:20);
    return {leaflet:current,candidates:candidates??[],validity};
  }catch(error){throw error;}finally{await doc.destroy();}
}
