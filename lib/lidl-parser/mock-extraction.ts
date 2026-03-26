import type { LidlPageOffer } from "./lidl-page-offer";

export const MOCK_EXTRACTION_MODEL_LABEL = "ukázková data (bez API)";

function mockRow(
  page_no: number | null,
  i: number,
  name: string,
  price: number
): LidlPageOffer {
  return {
    store_id: "lidl",
    source_type: "leaflet",
    page_no,
    valid_from: null,
    valid_to: null,
    valid_from_text: null,
    valid_to_text: null,
    extracted_name: name,
    price_total: price,
    currency: "CZK",
    pack_qty: 1,
    pack_unit: "ks",
    pack_unit_qty: 1,
    price_standard: null,
    typical_price_per_unit: null,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: i === 1 ? "Ukázkový řádek — není z reálného letáku." : null,
    brand: null,
    category: null,
    raw_text_block: `mock řádek ${i}`,
  };
}

/**
 * Osm ukázkových řádků pro rozhraní / test pipeline — neodpovídají reálnému letáku.
 */
export function getMockLidlPageOffers(page_no: number | null): LidlPageOffer[] {
  const samples: [string, number][] = [
    ["Ukázkový jogurt bílý (mock)", 12.9],
    ["Ukázkový sýr plátky (mock)", 39.9],
    ["Ukázková šunka (mock)", 49.9],
    ["Ukázkové mléko (mock)", 24.9],
    ["Ukázkový chléb (mock)", 18.9],
    ["Ukázkové máslo (mock)", 32.9],
    ["Ukázková čokoláda (mock)", 29.9],
    ["Ukázkové vejce 10 ks (mock)", 42.9],
  ];
  return samples.map(([name, price], idx) =>
    mockRow(page_no, idx + 1, name, price)
  );
}

/**
 * Výchozí: bez OPENAI ani GEMINI klíče → ukázková data.
 * Vynutit mock i s klíčem: LEAFLET_PARSE_MOCK=true.
 */
export function isMockExtractionEnabled(): boolean {
  const mock = process.env.LEAFLET_PARSE_MOCK?.trim().toLowerCase();
  if (mock === "true" || mock === "1" || mock === "yes") return true;
  if (mock === "false" || mock === "0" || mock === "no") return false;
  const hasOpenai = !!process.env.OPENAI_API_KEY?.trim();
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();
  if (hasOpenai || hasGemini) return false;
  return true;
}
