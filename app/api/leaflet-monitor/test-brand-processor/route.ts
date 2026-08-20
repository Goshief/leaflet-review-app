import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 180;
const BUCKET = "leaflet-intake";
const SOURCE_PATH = "billa/billa-2026-08-19__a7a0e1fef9b45d3b.pdf";

async function cleanup(s:any, leafletId:string|null, importId:string|null){
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
const eq=(a:unknown,b:number)=>Math.abs(Number(a)-b)<0.001;

export async function GET(){
  const gate=await requireOperatorApi();if(!gate.ok)return gate.response;
  const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});
  const testPath=`_tests/billa-brand-${Date.now()}.pdf`;let leafletId:string|null=null;let importId:string|null=null;
  try{
    const{data:source,error}=await s.storage.from(BUCKET).download(SOURCE_PATH);if(error||!source)throw new Error(error?.message||"BILLA PDF chybí.");
    const bytes=new Uint8Array(await source.arrayBuffer());
    await processLeafletPdf({supabase:s,bucket:BUCKET,path:testPath,retailer:"billa",sourceUrl:"test://brand-processor/billa",bytes,page:1,force:true});
    const{data:doc,error:de}=await s.from("leaflet_documents").select("id,import_id").eq("storage_bucket",BUCKET).eq("storage_path",testPath).single();if(de||!doc?.id)throw new Error(de?.message||"Testovací dokument nevznikl.");
    leafletId=String(doc.id);importId=typeof doc.import_id==="string"?doc.import_id:null;
    const{data:rows,error:re}=await s.from("leaflet_item_candidates").select("price_sale,product_name,brand,field_evidence").eq("leaflet_id",leafletId).eq("page_no",1);if(re)throw new Error(re.message);
    const at=(price:number)=>(rows??[]).find((x:any)=>eq(x.price_sale,price));
    const checks=[
      {id:"db_milka",value:at(24.9)?.brand??null,ok:at(24.9)?.brand==="Milka"},
      {id:"db_linteo",value:at(99.9)?.brand??null,ok:at(99.9)?.brand==="Linteo"},
      {id:"db_toffifee",value:at(29.9)?.brand??null,ok:at(29.9)?.brand==="Toffifee"},
      {id:"db_kure_no_guess",value:at(49.9)?.brand??null,ok:at(49.9)?.brand==null},
      {id:"brand_evidence",value:at(24.9)?.field_evidence?.brand?.source??null,ok:at(24.9)?.field_evidence?.brand?.source==="brand_aliases"},
    ];
    const failures=checks.filter(x=>!x.ok).map(x=>x.id);
    return NextResponse.json({ok:failures.length===0,point_5b_processor:{pass:failures.length===0,checks,failures}});
  }catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}
  finally{try{await cleanup(s,leafletId,importId);}catch(error){console.error("test-brand-processor cleanup failed",error);}}
}
