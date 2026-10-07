import { collectPublicCatalog, isCatalogRetailer } from "@/lib/leaflet-monitor/public-catalog";
import { publishPublicCatalog } from "@/lib/leaflet-monitor/publish-catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request, {params}: {params:Promise<{retailer:string}>}) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ok:false,error:"cron_secret_missing"},{status:503});
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ok:false,error:"unauthorized"},{status:401});
  const {retailer} = await params;
  if (!isCatalogRetailer(retailer)) return Response.json({ok:false,error:"unsupported_leaflet_source"},{status:404});
  const client = getSupabaseAdmin();
  if (!client) return Response.json({ok:false,error:"supabase_missing"},{status:503});
  try {
    const result = await collectPublicCatalog(retailer);
    const publication = await publishPublicCatalog(client,result);
    const ok = result.status !== "error" && publication.published === result.leaflets.length && publication.errors.length === 0;
    return Response.json({ok,...result,publication},{status:ok?200:502});
  } catch { return Response.json({ok:false,retailer,error:"catalog_sync_failed"},{status:502}); }
}
