import type { ExtractedCandidate } from "./extractor";

export type BrandAlias = { alias: string; canonical_brand: string };

function normalized(value: string | null | undefined) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase("cs-CZ").replace(/\s+/g, " ").trim();
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveCandidateBrand(candidate: ExtractedCandidate, aliases: BrandAlias[]) {
  const name = normalized(candidate.product_name);
  if (!name) return null;
  const ordered = aliases
    .filter((x) => x.alias?.trim() && x.canonical_brand?.trim())
    .slice()
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of ordered) {
    const alias = normalized(entry.alias);
    if (!alias) continue;
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped(alias)}(?:$|[^\\p{L}\\p{N}])`, "iu");
    if (re.test(name)) return entry.canonical_brand.trim();
  }
  return null;
}

export function applyBrandAliases(candidate: ExtractedCandidate, aliases: BrandAlias[]): ExtractedCandidate {
  const brand = resolveCandidateBrand(candidate, aliases);
  if (!brand) return candidate;
  return {
    ...candidate,
    brand,
    field_evidence: {
      ...candidate.field_evidence,
      brand: { raw_text: brand, source: "brand_aliases" },
    },
    extraction_payload: {
      ...candidate.extraction_payload,
      brand_resolution: { source: "brand_aliases", brand },
    },
  };
}

export async function loadBrandAliases(supabase: any): Promise<BrandAlias[]> {
  const { data, error } = await supabase.from("brand_aliases").select("alias,canonical_brand");
  if (error) throw new Error(`brand_aliases: ${error.message}`);
  return (data ?? []).filter((x: any) => typeof x.alias === "string" && typeof x.canonical_brand === "string");
}
