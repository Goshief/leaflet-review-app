import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("penny");

export async function GET(req: Request) {
  return runLeafletConnectorWithOrigin(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: "23 7 * * *",
    preferredLabels: [/Prohlédnout/i, /leták/i, /nabídka tohoto týdne/i],
    autoProcess: true,
  });
}
