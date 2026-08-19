import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";

async function cleanup(s:any,leafletId:string|null,importId:string|null){
  if(!leafletId)return;
  const{data:candidates}=await s.from("leaflet_item_candidates").select("id").eq("leaflet_id",leafletId);
  const ids=(candidates??[]).map((x:any)=>x.id).filter(Boolean);
  if(ids.length)await s.from("leaflet_item_review_audit").delete().in("candidate_id",ids);
  await s.from("leaflet_notification_outbox").delete().eq("leaflet_id",leafletId);
  await s.from("leaflet_item_candidates").delete().eq("leaflet_id",leafletId);
  await s.from("leaflet_page_processing").delete().eq("leaflet_id",leafletId);
  await s.from("leaflet_documents").delete().eq("id",leafletId);
  if(importId)await s.from("imports").delete().eq("id",importId);
}

export async function GET(){
  const gate=await requireOperatorApi();if(!gate.ok)return gate.response;
  const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});
  const testPath=`_tests/billa-segmentation-${Date.now()}.pdf`;let leafletId:string|null=null;let importId:string|null=null;
  try{
    const{data:source,error:de}=await s.storage.from(BUCKET).download(SOURCE_PATH);if(de||!source)throw new Error(de?.message||"BILLA PDF chybí.");
    const bytes=new Uint8Array(await source.arrayBuffer());
    const result=await processLeafletPdf({supabase:s,bucket:BUCKET,path:testPath,retailer:"billa",sourceUrl:"test://segmentation/billa",bytes,page:1,force:true});
    leafletId=String(result.leaflet.id);importId=typeof result.leaflet.import_id==="string"?result.leaflet.import_id:null;
    const{data:rows,error}=await s.from("leaflet_item_candidates").select("candidate_key,product_name,price_sale,price_standard,price_loyalty,price_without_loyalty,pack_text,status,review_reason,source_text,source_bbox,extraction_payload,extractor_version").eq("leaflet_id",leafletId).eq("page_no",1).order("candidate_key");
    if(error)throw new Error(error.message);const candidates=rows??[];
    const mixed=candidates.filter((r:any)=>{const text=String(r.source_text||"");const names=(r.extraction_payload?.name_candidates??[]) as unknown[];return names.length>=4||text.split(" | ").length>=13;});
    const named=candidates.filter((r:any)=>typeof r.product_name==="string"&&r.product_name.trim());
    const quarantine=candidates.filter((r:any)=>r.status==="quarantine");
    return NextResponse.json({ok:true,extractor_version:candidates[0]?.extractor_version??null,total:candidates.length,named:named.length,quarantine:quarantine.length,suspiciously_mixed:mixed.length,candidates:candidates.map((r:any)=>({key:r.candidate_key,name:r.product_name,price:r.price_sale,standard:r.price_standard,loyalty:r.price_loyalty,without_loyalty:r.price_without_loyalty,pack:r.pack_text,status:r.status,reason:r.review_reason,source:r.source_text,bounds:r.extraction_payload?.block_bounds??null,name_candidates:r.extraction_payload?.name_candidates??[]}))});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
  finally{try{await cleanup(s,leafletId,importId);}catch(error){console.error("segmentation test cleanup failed",error);}}
}
