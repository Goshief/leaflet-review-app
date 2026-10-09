import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { todayPrague } from "@/lib/leaflet-monitor/public-catalog";
import { currentGlobusSource, relayGlobusPdf } from "@/lib/leaflet-monitor/globus-delivery";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  const {id} = await params;
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) return Response.json({error:"invalid_document_id"},{status:400});
  try {
    const admin = getSupabaseAdmin();
    if (!admin) throw new Error("catalog_unavailable");
    const {data,error} = await admin.from("leaflet_documents").select("retailer_id,source_url,valid_from,valid_to").eq("id",id).maybeSingle();
    if (error) throw new Error("catalog_unavailable");
    const source = data ? currentGlobusSource(data,todayPrague()) : null;
    if (!source) return Response.json({error:"document_not_found"},{status:404});
    return await relayGlobusPdf(source);
  } catch {
    return Response.json({error:"leaflet_file_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
