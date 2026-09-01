import { z } from "zod";
import {
  emptyAiChecks,
  mergeVerifiedField,
  pipelineFieldCheck,
  productFromPasses,
  VERIFIED_PRODUCT_KEYS,
  type AiChecks,
  type Pass3FieldDecision,
} from "./ai-checks.ts";
import {
  extractLeafletVision,
  type LeafletPageExtractRequest,
  type LeafletVisionRequest,
} from "./extract-page-vision.ts";
import { LEAFLET_PRODUCT_KEYS, leafletProductSchema, parseLeafletProductsJson, type LeafletProduct } from "./leaflet-product.ts";
import { stripJsonArrayFromModelOutput } from "../lidl-parser/lidl-page-offer.ts";
import { getMockLidlPageOffers, isMockExtractionEnabled } from "../lidl-parser/mock-extraction.ts";
import { cropEnlargedProductPng, normalizeProductBBox, type ProductBBox } from "./product-bbox.ts";
import { identifyProductOnPage, type ProductHint } from "./product-identify.ts";
import { buildLeafletPageParserUserPrompt } from "./retailer-adapter.ts";

export type DiscoveryProduct = LeafletProduct & { bbox: ProductBBox | null };

export type ThreePassProductResult = {
  product: LeafletProduct;
  ai_checks: AiChecks;
  review_status: "pending" | "needs_review";
  bbox: ProductBBox | null;
  crop: Uint8Array;
};

export type ThreePassPageResult = {
  products: ThreePassProductResult[];
  pass1_raw: string;
  pass1_model: string;
};

export type Pass2Input = {
  request: LeafletPageExtractRequest;
  index: number;
  bbox: ProductBBox | null;
  pageImage: Uint8Array;
  crop: Uint8Array;
};

export type Pass3Input = Pass2Input & {
  pass1: LeafletProduct;
  pass2: LeafletProduct | null;
};

export type ThreePassHooks = {
  pass1?: (req: LeafletPageExtractRequest) => Promise<{ raw: string; model: string }>;
  pass2?: (input: Pass2Input) => Promise<LeafletProduct | null>;
  pass3?: (input: Pass3Input) => Promise<Partial<Record<string, Pass3FieldDecision>> | null>;
};

const pass3FieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  seen: z.boolean(),
});

export function parseDiscoveryProductsJson(
  text: string,
  options?: { fillMissingNullKeys?: boolean },
): { ok: true; products: DiscoveryProduct[] } | { ok: false; errors: string[] } {
  let items: unknown;
  try {
    items = JSON.parse(stripJsonArrayFromModelOutput(text));
  } catch {
    return { ok: false, errors: ["Neplatný JSON"] };
  }
  if (!Array.isArray(items)) return { ok: false, errors: ["Kořen musí být JSON pole objektů"] };

  const bboxes = items.map((item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? normalizeProductBBox((item as Record<string, unknown>).bbox)
      : null,
  );
  const cleaned = items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const { bbox: _bbox, block_id: _block, crop: _crop, ...rest } = item as Record<string, unknown>;
    return rest;
  });
  const parsed = parseLeafletProductsJson(JSON.stringify(cleaned), options);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    products: parsed.products.map((product, index) => ({ ...product, bbox: bboxes[index] ?? null })),
  };
}

export function parseLeafletProductObject(text: string): LeafletProduct | null {
  const asArray = parseLeafletProductsJson(wrapAsArray(text), { fillMissingNullKeys: true });
  if (asArray.ok && asArray.products[0]) return asArray.products[0]!;
  return null;
}

function wrapAsArray(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return trimmed;
  if (trimmed.startsWith("{")) return `[${trimmed}]`;
  return trimmed;
}

export function applyThreePassMerge(
  pass1: LeafletProduct,
  pass2: LeafletProduct | null,
  pass3: Partial<Record<string, Pass3FieldDecision>> | null,
  bbox: ProductBBox | null,
): Omit<ThreePassProductResult, "crop"> {
  const checks = emptyAiChecks(bbox);
  const merged: Partial<Record<string, unknown>> = {};
  let unresolved = 0;
  const pass1Product = pickLeafletProduct(pass1);

  for (const key of VERIFIED_PRODUCT_KEYS) {
    const decision = pass3?.[key];
    const { value, check } = mergeVerifiedField(pass1Product[key], pass2?.[key], decision);
    checks[key] = check;
    merged[key] = value;
    if (check.status === "unresolved") unresolved += 1;
  }
  for (const key of ["store_id", "source_type", "page_no", "currency"] as const) {
    checks[key] = pipelineFieldCheck();
  }

  const product = productFromPasses(pass1Product, merged);
  const parsed = leafletProductSchema.safeParse(product);
  if (!parsed.success) {
    return {
      product: pass1Product,
      ai_checks: checks,
      review_status: "needs_review",
      bbox,
    };
  }
  return {
    product: parsed.data,
    ai_checks: checks,
    review_status: unresolved > 0 ? "needs_review" : "pending",
    bbox,
  };
}

function pickLeafletProduct(row: LeafletProduct): LeafletProduct {
  return Object.fromEntries(LEAFLET_PRODUCT_KEYS.map((key) => [key, row[key]])) as LeafletProduct;
}

export async function runThreePassVerification(
  request: LeafletPageExtractRequest,
  pageImage: Uint8Array,
  hooks: ThreePassHooks = {},
): Promise<ThreePassPageResult> {
  if (!pageImage.byteLength) throw new Error("Re-read musí začít z originálního obrázku stránky.");
  const pass1Fn = hooks.pass1 ?? defaultPass1;
  const pass1Result = await pass1Fn(request);
  const discovered = parseDiscoveryProductsJson(pass1Result.raw, { fillMissingNullKeys: true });
  if (!discovered.ok) {
    throw Object.assign(new Error(discovered.errors.join("; ")), {
      validation_errors: discovered.errors,
      raw: pass1Result.raw,
      model: pass1Result.model,
    });
  }

  const products: ThreePassProductResult[] = [];
  for (let index = 0; index < discovered.products.length; index++) {
    products.push(await runThreePassOnDiscoveredProduct(request, pageImage, discovered.products[index]!, index, hooks));
  }

  return { products, pass1_raw: pass1Result.raw, pass1_model: pass1Result.model };
}

export async function runThreePassOnDiscoveredProduct(
  request: LeafletPageExtractRequest,
  pageImage: Uint8Array,
  pass1: DiscoveryProduct,
  index: number,
  hooks: ThreePassHooks = {},
): Promise<ThreePassProductResult> {
  if (!pageImage.byteLength) throw new Error("Re-read musí začít z originálního obrázku stránky.");
  const bbox = pass1.bbox;
  const crop = await cropEnlargedProductPng(pageImage, bbox);
  const pass2Input: Pass2Input = { request, index, bbox, pageImage, crop };
  const pass2 = hooks.pass2 ? await hooks.pass2(pass2Input) : await defaultPass2(pass2Input);
  const pass3Input: Pass3Input = { ...pass2Input, pass1, pass2 };
  const pass3 = hooks.pass3 ? await hooks.pass3(pass3Input) : await defaultPass3(pass3Input);
  const merged = applyThreePassMerge(pass1, pass2, pass3, bbox);
  return { ...merged, crop };
}

export type ThreePassProductRereadResult = {
  product: ThreePassProductResult;
  pass1_raw: string;
  pass1_model: string;
  identified_from_page: boolean;
  discovered_count: number;
};

export async function runThreePassProductFromImage(
  request: LeafletPageExtractRequest,
  pageImage: Uint8Array,
  target: ProductHint,
  hooks: ThreePassHooks = {},
): Promise<ThreePassProductRereadResult> {
  if (!pageImage.byteLength) throw new Error("Re-read musí začít z originálního obrázku stránky.");
  const identified_from_page = !target.bbox;
  const pass1Fn = hooks.pass1 ?? defaultPass1;
  const pass1Result = await pass1Fn(request);
  const discovered = parseDiscoveryProductsJson(pass1Result.raw, { fillMissingNullKeys: true });
  if (!discovered.ok) {
    throw Object.assign(new Error(discovered.errors.join("; ")), {
      validation_errors: discovered.errors,
      raw: pass1Result.raw,
      model: pass1Result.model,
    });
  }
  const match = identifyProductOnPage(discovered.products, target);
  if (!match) {
    throw Object.assign(new Error("Produkt se na stránce nepodařilo identifikovat."), {
      validation_errors: ["Produkt se na stránce nepodařilo identifikovat."],
      raw: pass1Result.raw,
      model: pass1Result.model,
    });
  }
  const product = await runThreePassOnDiscoveredProduct(
    request,
    pageImage,
    match.product as DiscoveryProduct,
    match.index,
    hooks,
  );
  return {
    product,
    pass1_raw: pass1Result.raw,
    pass1_model: pass1Result.model,
    identified_from_page,
    discovered_count: discovered.products.length,
  };
}

async function defaultPass1(req: LeafletPageExtractRequest) {
  return extractLeafletVision(discoveryVisionRequest(req));
}

async function defaultPass2(input: Pass2Input): Promise<LeafletProduct | null> {
  if (isMockExtractionEnabled()) {
    const mocks = getMockLidlPageOffers(input.request.page_no);
    const row = mocks[input.index] ?? mocks[0];
    if (!row) return null;
    return {
      ...row,
      store_id: input.request.store_id,
      page_no: input.request.page_no,
    };
  }
  const raw = await extractLeafletVision(pass2VisionRequest(input));
  return parseLeafletProductObject(raw.raw);
}

async function defaultPass3(input: Pass3Input): Promise<Partial<Record<string, Pass3FieldDecision>> | null> {
  if (isMockExtractionEnabled()) {
    const source = input.pass2 ?? input.pass1;
    return Object.fromEntries(
      VERIFIED_PRODUCT_KEYS.map((key) => [key, { value: source[key], seen: true }]),
    );
  }
  const raw = await extractLeafletVision(pass3VisionRequest(input));
  return parsePass3Decisions(raw.raw);
}

export function parsePass3Decisions(text: string): Partial<Record<string, Pass3FieldDecision>> | null {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    const out: Partial<Record<string, Pass3FieldDecision>> = {};
    for (const key of VERIFIED_PRODUCT_KEYS) {
      const field = parsed[key];
      if (field && typeof field === "object" && !Array.isArray(field)) {
        const result = pass3FieldSchema.safeParse(field);
        if (result.success) out[key] = result.data;
        continue;
      }
      if (key in parsed) {
        out[key] = { value: parsed[key] ?? null, seen: parsed[key] != null };
      }
    }
    return out;
  } catch {
    return null;
  }
}

function discoveryVisionRequest(req: LeafletPageExtractRequest): LeafletVisionRequest {
  return {
    ...req,
    images: [{ bytes: req.image, mime: req.mime || "image/png", label: "original_page" }],
    userText: [
      buildLeafletPageParserUserPrompt(req),
      "PASS 1 DISCOVERY: najdi každý viditelný produkt na celé originální stránce.",
      "Ke každému objektu smíš přidat volitelné pole bbox {x,y,width,height} v 0–1 vůči celé stránce (jen lokalizace cropu, není to 22. datové pole).",
      "21polový LeafletProduct kontrakt jinak dodrž.",
    ].join("\n"),
    systemAddendum: "PASS 1 = discovery celé stránky. Jedna stránka, JSON pole objektů.",
  };
}

function pass2VisionRequest(input: Pass2Input): LeafletVisionRequest {
  const req = input.request;
  return {
    ...req,
    images: [
      { bytes: input.pageImage, mime: "image/png", label: "original_page" },
      { bytes: input.crop, mime: "image/png", label: "enlarged_product_crop" },
    ],
    userText: [
      `PASS 2 INDEPENDENT RE-READ jednoho produktu na stránce ${req.page_no} (index ${input.index}).`,
      `batch_id=${req.batch_id} page_id=${req.page_id} store_id=${req.store_id} adapter=${req.adapter.id}`,
      input.bbox
        ? `Crop bbox (0–1): ${JSON.stringify(input.bbox)}. Druhý obrázek je zvětšený crop této dlaždice.`
        : "Crop bbox chybí — druhý obrázek je zvětšený výřez stránky. Čti jen jeden produkt.",
      "NESMÍŠ převzít PASS 1. Znovu přečti z obrazu: název, ceny, balení, loyalty, datum.",
      "Vrať jeden JSON objekt LeafletProduct (ne pole, ne Markdown).",
    ].join("\n"),
    systemAddendum: "PASS 2 = nezávislé čtení. Nepřebírej předchozí výstup. Rozhoduj podle obrazu.",
  };
}

function pass3VisionRequest(input: Pass3Input): LeafletVisionRequest {
  const req = input.request;
  return {
    ...req,
    images: [
      { bytes: input.pageImage, mime: "image/png", label: "original_page" },
      { bytes: input.crop, mime: "image/png", label: "enlarged_product_crop" },
    ],
    userText: [
      `PASS 3 VERIFIER. batch_id=${req.batch_id} page_id=${req.page_id} page_no=${req.page_no} store_id=${req.store_id}`,
      "Máš originální stránku, product crop, PASS 1 a PASS 2. Porovnej field-by-field.",
      "Při konfliktu rozhodni PODLE OBRAZU. Nic nedopočítávej, žádný průměr, žádný odhad.",
      "Pokud pole na obrazu nevidíš bezpečně, seen=false a value=null.",
      "Vrať JSON objekt polí: {\"extracted_name\":{\"value\":\"...\",\"seen\":true}, ...} pro 21polová datová pole.",
      `PASS 1: ${JSON.stringify(input.pass1)}`,
      `PASS 2: ${JSON.stringify(input.pass2)}`,
    ].join("\n"),
    systemAddendum: "PASS 3 = verifier. Rozhoduj jen podle viditelného textu/cen na obrázku.",
  };
}
