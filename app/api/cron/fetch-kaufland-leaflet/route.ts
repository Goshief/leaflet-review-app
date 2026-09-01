import { runLeafletConnectorWithOrigin } from "@/lib/leaflet-monitor/connector-with-origin";
import { getRetailerConfig } from "@/lib/leaflet-monitor/retailers";
import { getWatcherCronSchedule } from "@/lib/leaflet-monitor/watcher-config";

export const runtime = "nodejs";
export const maxDuration = 300;

const retailer = getRetailerConfig("kaufland");

export async function GET(req: Request) {
  return runLeafletConnectorWithOrigin(req, {
    retailer: retailer.id,
    sourcePage: retailer.fetch_url,
    cronSchedule: getWatcherCronSchedule("kaufland"),
    preferredLabels: [/Akční nabídka/i, /Akční leták/i, /leták/i, /leaflets\.kaufland\.com/i],
    autoProcess: true,
  });
}
