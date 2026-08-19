import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: "lidl",
    sourcePage: "https://www.lidl.cz/",
    cronSchedule: "17 7 * * *",
    preferredLabels: [/Akční leták/i, /aktuální leták/i, /prolistovat brožuru/i],
    autoProcess: true,
  });
}
