import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("billa");

export async function GET(req: Request) {
  return runLeafletConnectorWithOrigin(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: "29 7 * * *",
    preferredLabels: [/Velký leták/i, /Stáhnout PDF/i, /aktuální leták/i],
    autoProcess: true,
  });
}
