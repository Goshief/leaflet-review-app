import { runGenericLeafletConnector } from "@/lib/leaflet-monitor/generic-fetcher";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: Request) {
  return runGenericLeafletConnector(req, {
    retailer: "penny",
    sourcePage: "https://www.penny.cz/nabidky/letaky",
    cronSchedule: "23 7 * * *",
    preferredLabels: [/Prohlédnout/i, /leták/i, /nabídka tohoto týdne/i],
    autoProcess: true,
  });
}
