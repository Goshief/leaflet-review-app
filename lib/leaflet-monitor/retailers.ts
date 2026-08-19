import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export type RetailerConfig = {
  id: RetailerId;
  name: string;
  source_url: string;
  fetch_url: string;
  connector: "active" | "pending";
};

export const RETAILERS: readonly RetailerConfig[] = [
  {
    id: "lidl",
    name: "Lidl",
    source_url: "https://www.lidl.cz/",
    fetch_url: "https://www.lidl.cz/",
    connector: "active",
  },
  {
    id: "kaufland",
    name: "Kaufland",
    source_url: "https://www.kaufland.cz/",
    fetch_url: "https://prodejny.kaufland.cz/letak.html",
    connector: "active",
  },
  {
    id: "penny",
    name: "Penny",
    source_url: "https://www.penny.cz/nabidky/letaky",
    fetch_url: "https://www.penny.cz/nabidky/letaky",
    connector: "active",
  },
  {
    id: "billa",
    name: "Billa",
    source_url: "https://www.billa.cz/letaky-billa/velky-letak",
    fetch_url: "https://www.billa.cz/letaky-billa/velky-letak",
    connector: "active",
  },
  {
    id: "albert",
    name: "Albert",
    source_url: "https://www.albert.cz/aktualni-letaky",
    fetch_url: "https://www.albert.cz/aktualni-letaky",
    connector: "active",
  },
] as const;

export function getRetailerConfig(id: RetailerId): RetailerConfig {
  const config = RETAILERS.find((retailer) => retailer.id === id);
  if (!config) throw new Error(`Unknown retailer: ${id}`);
  return config;
}
