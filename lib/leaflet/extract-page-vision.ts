import { resolveVisionProvider } from "../extraction/provider.ts";
import { geminiVisionExtractText } from "../gemini/vision-extract.ts";
import { getSystemPromptLidlCzStrict } from "../lidl-parser/load-system-prompt.ts";
import {
  getMockLidlPageOffers,
  isMockExtractionEnabled,
  MOCK_EXTRACTION_MODEL_LABEL,
} from "../lidl-parser/mock-extraction.ts";
import {
  buildLeafletPageParserUserPrompt,
  type RetailerAdapter,
} from "./retailer-adapter.ts";

export type LeafletPageExtractRequest = {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  adapter: RetailerAdapter;
  image: Uint8Array;
  mime: string;
};

export type VisionImage = {
  bytes: Uint8Array;
  mime: string;
  label?: string;
};

export type LeafletVisionRequest = {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  adapter: RetailerAdapter;
  images: VisionImage[];
  userText: string;
  systemAddendum?: string;
};

export type LeafletPageExtractResponse = {
  raw: string;
  model: string;
};

function systemPromptForPage(req: { store_id: string; adapter: RetailerAdapter; systemAddendum?: string }): string {
  return [
    getSystemPromptLidlCzStrict(),
    "",
    "## AUTOMATICKÝ PAGE REQUEST",
    "Tento request zpracovává přesně jednu stránku. Výstup jen JSON objektů s 21 poli LeafletProduct.",
    `store_id musí být "${req.store_id}" (adapter ${req.adapter.id}).`,
    "Žádné Markdown tabulky. Žádná poziční pole.",
    req.systemAddendum ?? "",
  ].filter(Boolean).join("\n");
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

async function extractWithOpenAi(req: LeafletVisionRequest, noGeminiFallback = false): Promise<LeafletPageExtractResponse> {
  const openaiKey = process.env.OPENAI_API_KEY!.trim();
  const openaiModel = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";
  const openaiBase = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const imageContent = req.images.map((image) => ({
    type: "image_url" as const,
    image_url: {
      url: `data:${image.mime || "image/png"};base64,${toBase64(image.bytes)}`,
      detail: "high" as const,
    },
  }));
  const body = JSON.stringify({
    model: openaiModel,
    temperature: 0,
    max_tokens: 16384,
    messages: [
      { role: "system", content: systemPromptForPage(req) },
      {
        role: "user",
        content: [{ type: "text", text: req.userText }, ...imageContent],
      },
    ],
  });

  let response = await fetch(`${openaiBase}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 3000));
    response = await fetch(`${openaiBase}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
  }

  if (!response.ok) {
    const detail = await response.text();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (!noGeminiFallback && geminiKey && (response.status === 429 || /quota|rate limit|billing/i.test(detail))) {
      return extractWithGemini(req);
    }
    throw new Error(`OpenAI HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw !== "string") throw new Error("Neočekávaná odpověď modelu (chybí text)");
  return { raw, model: openaiModel };
}

async function extractWithGemini(req: LeafletVisionRequest): Promise<LeafletPageExtractResponse> {
  const geminiKey = process.env.GEMINI_API_KEY!.trim();
  const geminiModel = process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";
  const primary = req.images[0];
  if (!primary) throw new Error("Vision request musí obsahovat aspoň jeden obrázek.");
  const gem = await geminiVisionExtractText({
    apiKey: geminiKey,
    model: geminiModel,
    systemPrompt: systemPromptForPage(req),
    userText: req.userText,
    imageBase64: toBase64(primary.bytes),
    mimeType: primary.mime || "image/png",
    extraImages: req.images.slice(1).map((image) => ({
      base64: toBase64(image.bytes),
      mimeType: image.mime || "image/png",
    })),
  });
  if (!gem.ok) {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiKey && gem.status === 429) return extractWithOpenAi(req, true);
    throw new Error(gem.error);
  }
  return { raw: gem.text, model: `google/${geminiModel}` };
}

function assertPageIdentity(req: { batch_id: string; page_id: string; page_no: number; store_id: string; adapter: RetailerAdapter }) {
  if (!req.batch_id || !req.page_id || !req.store_id || !req.adapter) {
    throw new Error("Parser request musí obsahovat batch_id, page_id, store_id a retailer adapter.");
  }
  if (!Number.isFinite(req.page_no) || req.page_no < 1) {
    throw new Error("Parser request musí obsahovat page_no >= 1.");
  }
}

/**
 * One or more images of the SAME page (original + optional crop). Never a list of pages.
 */
export async function extractLeafletVision(req: LeafletVisionRequest): Promise<LeafletPageExtractResponse> {
  assertPageIdentity(req);
  if (!req.images.length || req.images.some((image) => !image.bytes?.byteLength)) {
    throw new Error("Parser request musí obsahovat originální obrázek stránky.");
  }

  if (isMockExtractionEnabled()) {
    const products = getMockLidlPageOffers(req.page_no).map((row) => ({
      ...row,
      store_id: req.store_id,
      page_no: req.page_no,
    }));
    return { raw: JSON.stringify(products), model: MOCK_EXTRACTION_MODEL_LABEL };
  }

  const provider = resolveVisionProvider();
  if (!provider) {
    throw new Error("Chybí OPENAI_API_KEY nebo GEMINI_API_KEY pro AI parser.");
  }
  return provider === "gemini" ? extractWithGemini(req) : extractWithOpenAi(req);
}

/**
 * One parser request = one page image. Never accepts a list of pages.
 */
export async function extractLeafletPage(req: LeafletPageExtractRequest): Promise<LeafletPageExtractResponse> {
  return extractLeafletVision({
    ...req,
    images: [{ bytes: req.image, mime: req.mime || "image/png", label: "original_page" }],
    userText: buildLeafletPageParserUserPrompt(req),
  });
}
