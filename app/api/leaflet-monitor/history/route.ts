import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime="nodejs";
const ACTIVE=["billa","lidl","kaufland","penny"];

export async function GET(){
 const gate=await requireOperatorApi();if(!gate.ok)return gate.response;const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});
 const{data,error}=await s.from("leaflet_documents").select("*").in("retailer_id",ACTIVE).order("created_at",{ascending:false}).limit(200);if(error)return NextResponse.json({ok:false,error:error.message},{status:500});
 const items=(data||[]).map((d:any)=>({id:d.id,retailer:d.retailer_id,pdf:d.filename,created_at:d.created_at,updated_at:d.updated_at,status:d.processing_status,page_count:d.page_count,processed_pages:d.processed_pages,approved_count:d.approved_count,rejected_count:d.rejected_count,quarantine_count:d.quarantine_count,unreviewed_count:d.unreviewed_count,candidate_count:d.candidate_count,valid_from:d.valid_from,valid_to:d.valid_to,notification_status:d.notification_status}));
 return NextResponse.json({ok:true,items});
}
