import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export type RetailerConfig = {
  id: RetailerId;
  name: string;
  source_url: string;
  fetch_url: string;
  connector: "active" | "pending";
};

export const RETAILERS: readonly RetailerConfig[] = [
  { id: "albert", name: "Albert", source_url: "https://www.albert.cz/aktualni-letaky", fetch_url: "https://www.albert.cz/aktualni-letaky", connector: "active" },
  { id: "billa", name: "Billa", source_url: "https://www.billa.cz/letaky-billa/velky-letak", fetch_url: "https://www.billa.cz/letaky-billa/velky-letak", connector: "active" },
  { id: "dm", name: "dm drogerie", source_url: "https://www.dm.cz/", fetch_url: "https://www.dm.cz/", connector: "active" },
  { id: "globus", name: "Globus", source_url: "https://www.globus.cz/globus/letaky", fetch_url: "https://www.globus.cz/globus/letaky", connector: "active" },
  { id: "kaufland", name: "Kaufland", source_url: "https://www.kaufland.cz/", fetch_url: "https://prodejny.kaufland.cz/letak.html", connector: "active" },
  { id: "kosik", name: "Košík", source_url: "https://www.kosik.cz/", fetch_url: "https://www.kosik.cz/", connector: "active" },
  { id: "lidl", name: "Lidl", source_url: "https://www.lidl.cz/", fetch_url: "https://www.lidl.cz/", connector: "active" },
  { id: "penny", name: "Penny", source_url: "https://www.penny.cz/nabidky/letaky", fetch_url: "https://www.penny.cz/nabidky/letaky", connector: "active" },
  { id: "rohlik", name: "Rohlík", source_url: "https://www.rohlik.cz/", fetch_url: "https://www.rohlik.cz/", connector: "active" },
  { id: "rossmann", name: "Rossmann", source_url: "https://www.rossmann.cz/obsah/akce-a-letaky", fetch_url: "https://www.rossmann.cz/obsah/akce-a-letaky", connector: "active" },
  { id: "tesco", name: "Tesco", source_url: "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy", fetch_url: "https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy", connector: "active" },
  { id: "teta", name: "Teta", source_url: "https://www.tetadrogerie.cz/", fetch_url: "https://www.tetadrogerie.cz/", connector: "active" },
] as const;

export function getRetailerConfig(id: RetailerId): RetailerConfig {
  const config = RETAILERS.find((retailer) => retailer.id === id);
  if (!config) throw new Error(`Unknown retailer: ${id}`);
  return config;
}
