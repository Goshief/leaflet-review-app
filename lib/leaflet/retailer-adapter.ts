import { ADAPTER_VERSION } from "./parser-versions.ts";

export { ADAPTER_VERSION };

export type RetailerAdapter = {
  id: string;
  name: string;
  promptLabel: string;
  loyaltyLabel: string;
  version: string;
};

const ADAPTERS: Record<string, RetailerAdapter> = {
  billa: { id: "billa", name: "BILLA", promptLabel: "BILLA CZ", loyaltyLabel: "BILLA klub", version: ADAPTER_VERSION },
  lidl: { id: "lidl", name: "Lidl", promptLabel: "Lidl CZ", loyaltyLabel: "Lidl Plus", version: ADAPTER_VERSION },
  kaufland: { id: "kaufland", name: "Kaufland", promptLabel: "Kaufland CZ", loyaltyLabel: "Kaufland Card", version: ADAPTER_VERSION },
  penny: { id: "penny", name: "Penny", promptLabel: "Penny CZ", loyaltyLabel: "PENNY karta", version: ADAPTER_VERSION },
  albert: { id: "albert", name: "Albert", promptLabel: "Albert CZ", loyaltyLabel: "Albert Extra", version: ADAPTER_VERSION },
};

export function getRetailerAdapter(storeId: string): RetailerAdapter {
  const known = ADAPTERS[storeId];
  if (known) return known;
  return { id: storeId, name: storeId, promptLabel: storeId, loyaltyLabel: "Věrnostní karta", version: ADAPTER_VERSION };
}

export function loyaltyProgramLabel(storeId: string | null | undefined): string {
  return getRetailerAdapter(storeId || "other").loyaltyLabel;
}

export function buildLeafletPageParserUserPrompt(input: {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  adapter: RetailerAdapter;
}): string {
  return [
    `Vstup: originální obrázek JEDNÉ stránky letáku (${input.adapter.promptLabel}).`,
    `Obchod: ${input.adapter.promptLabel}.`,
    "Povinná identita tohoto requestu (neměň ji, neslučuj s jinou stranou):",
    `batch_id = ${input.batch_id}`,
    `page_id = ${input.page_id}`,
    `page_no = ${input.page_no}`,
    `store_id = ${input.store_id}`,
    `retailer adapter = ${input.adapter.id}`,
    "Zpracuj výhradně tuto jednu stránku. Nikdy neposílej ani nespojuj více stran.",
    `V poli store_id vrať přesně "${input.store_id}". V poli page_no vrať ${input.page_no}.`,
    "Vrať pouze JSON pole objektů s přesně 21 poli LeafletProduct.",
    "Žádné Markdown tabulky. Žádná poziční pole. Žádný prozaický text.",
  ].join("\n");
}
