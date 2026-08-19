import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: "kaufland",
    sourcePage: "https://prodejny.kaufland.cz/letak.html",
    cronSchedule: "13 7 * * *",
    preferredLabels: [/Akční nabídka/i, /Akční leták/i, /leták/i, /leaflets\.kaufland\.com/i],
    autoProcess: true,
  });
}
