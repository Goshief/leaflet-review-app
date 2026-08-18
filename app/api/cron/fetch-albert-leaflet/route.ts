import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: "albert",
    sourcePage: "https://www.albert.cz/aktualni-letaky",
    cronSchedule: "35 7 * * *",
    preferredLabels: [/Supermarket leták/i, /Akční leták/i, /aktuální leták/i],
  });
}
