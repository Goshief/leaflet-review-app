import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("lidl");

export async function GET(req: Request) {
  return runLeafletConnectorWithOrigin(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: "17 7 * * *",
    preferredLabels: [/Akční leták/i, /aktuální leták/i, /prolistovat brožuru/i],
    autoProcess: true,
  });
}
