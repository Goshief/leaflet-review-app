import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendLeafletNotification } from "@/lib/leaflet-review/notify";

export const runtime="nodejs";
export const maxDuration=60;

export async function GET(req:Request){
 const secret=process.env.CRON_SECRET?.trim();const auth=req.headers.get("authorization")||"";const manual=new URL(req.url).searchParams.get("manual")==="1";
 if(!manual&&secret&&auth!==`Bearer ${secret}`)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});
 const s=getSupabaseAdmin();if(!s)return NextResponse.json({ok:false,error:"Supabase není nakonfigurovaný."},{status:503});
 const{data,error}=await s.from("leaflet_notification_outbox").select("leaflet_id,status").in("status",["pending","failed"]).order("created_at").limit(20);if(error)return NextResponse.json({ok:false,error:error.message},{status:500});
 const results=[];for(const row of data||[])results.push({leaflet_id:row.leaflet_id,...await sendLeafletNotification(s,row.leaflet_id)});
 return NextResponse.json({ok:true,results});
}
