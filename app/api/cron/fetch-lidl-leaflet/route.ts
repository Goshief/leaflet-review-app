import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("lidl");

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: "17 7 * * *",
    preferredLabels: [/Akční leták/i, /aktuální leták/i, /prolistovat brožuru/i],
    autoProcess: true,
  });
}
