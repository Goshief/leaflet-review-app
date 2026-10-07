import { collectPublicCatalog, isCatalogRetailer, todayPrague, type CatalogResult } from "@/lib/leaflet-monitor/public-catalog";
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const cache = new Map<string,{expires:number;pending:Promise<CatalogResult>}>();
/** Public metadata only: this endpoint does not write to storage or invoke OCR. */
export async function GET(request: Request) {
  const retailer = new URL(request.url).searchParams.get("retailer") ?? "";
  if (!isCatalogRetailer(retailer)) return Response.json({ok:false,error:"unsupported_leaflet_source"},{status:400});
  const key = `${retailer}:${todayPrague()}`;
  let entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) {
    if(cache.size > 30) cache.clear();
    entry = {expires:Date.now()+300_000,pending:collectPublicCatalog(retailer)}; cache.set(key,entry);
  }
  const result = await entry.pending;
  if (result.status === "error") { cache.delete(key); return Response.json({ok:false,...result},{status:502,headers:{"Cache-Control":"no-store","Retry-After":"60"}}); }
  return Response.json({ok:true,...result},{headers:{"Cache-Control":"public, s-maxage=300, stale-while-revalidate=60"}});
}
