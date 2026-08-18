import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: "billa",
    sourcePage: "https://www.billa.cz/letaky-billa/velky-letak",
    cronSchedule: "29 7 * * *",
    preferredLabels: [/Velký leták/i, /Stáhnout PDF/i, /aktuální leták/i],
  });
}
