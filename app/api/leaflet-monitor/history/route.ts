import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { historyItemFromDocument } from "@/lib/leaflet-monitor/history-item";

export const runtime="nodejs";
const ACTIVE=["billa","lidl","kaufland","penny"];

export async function GET(){
 const gate=await requireOperatorApi();if(!gate.ok)return gate.response;const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});
 const{data,error}=await s.from("leaflet_documents").select("*").in("retailer_id",ACTIVE).order("created_at",{ascending:false}).limit(200);if(error)return NextResponse.json({ok:false,error:error.message},{status:500});
 const items=(data||[]).map(historyItemFromDocument);
 return NextResponse.json({ok:true,items});
}
