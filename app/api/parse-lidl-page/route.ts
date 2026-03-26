import {
  buildUserPromptForLidlPage,
  getSystemPromptLidlCzStrict,
  parseLidlPageOffersJson,
} from "@/lib/lidl-parser";
import { resolveVisionProvider } from "@/lib/extraction/provider";
import { geminiVisionExtractText } from "@/lib/gemini/vision-extract";
import {
  getMockLidlPageOffers,
  isMockExtractionEnabled,
  MOCK_EXTRACTION_MODEL_LABEL,
} from "@/lib/lidl-parser/mock-extraction";
import { NextRequest, NextResponse } from "next/server";
import { makeRequestId, safeErrorJson } from "@/lib/api/safe-error";

export const runtime = "nodejs";
export const maxDuration = 120;

const ALLOWED_IMAGE = /^image\/(jpeg|png|webp|gif)$/i;

/**
 * Překlad běžných chyb OpenAI do čitelné zprávy (kvóta, klíč, rate limit).
 */
function friendlyOpenAiHttpError(status: number, body: string): string {
  let code = "";
  let message = "";
  try {
    const j = JSON.parse(body) as {
      error?: { message?: string; code?: string; type?: string };
    };
    code = j.error?.code ?? "";
    message = (j.error?.message ?? "").trim();
  } catch {
    return `OpenAI odpovědělo chybou (HTTP ${status}). Zkontrolujte síť a klíč API.`;
  }

  const lower = message.toLowerCase();
  if (
    status === 429 ||
    code === "rate_limit_exceeded" ||
    lower.includes("rate limit")
  ) {
    return "OpenAI: příliš mnoho požadavků (rate limit). Zkus za minutu znovu, nebo přepni na Gemini: GEMINI_API_KEY z aistudio.google.com a EXTRACTION_PROVIDER=gemini v .env.local.";
  }
  if (
    code === "insufficient_quota" ||
    lower.includes("exceeded your current quota") ||
    lower.includes("billing")
  ) {
    return "OpenAI: vyčerpaná kvóta nebo chybí platba. Na platform.openai.com → Billing doplňte kredit nebo platební údaje.";
  }
  if (
    status === 401 ||
    code === "invalid_api_key" ||
    lower.includes("invalid api key")
  ) {
    return "OpenAI: neplatný nebo odvolaný API klíč. Zkontrolujte OPENAI_API_KEY v .env.local.";
  }
  if (message) {
    return `OpenAI: ${message}`;
  }
  return `OpenAI odpovědělo HTTP ${status}.`;
}

/** Po Gemini 429 zkusit OpenAI (aby se nepřepínalo tam a zpět). */
function geminiFailureAllowsOpenAiFallback(status?: number): boolean {
  return status === 429;
}

/** Při 429 / kvótě zkusit Gemini, pokud je klíč k dispozici. */
function openAiFailureAllowsGeminiFallback(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  try {
    const j = JSON.parse(bodyText) as {
      error?: { message?: string; code?: string };
    };
    const code = j.error?.code ?? "";
    const message = (j.error?.message ?? "").toLowerCase();
    if (code === "rate_limit_exceeded" || code === "insufficient_quota")
      return true;
    if (message.includes("rate limit")) return true;
    if (message.includes("quota") || message.includes("billing")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

type VisionExtractParams = {
  system: string;
  userText: string;
  base64: string;
  mime: string;
  page_no: number | null;
  source_url: string | null;
};

async function extractWithOpenAiVision(
  params: VisionExtractParams & { noGeminiFallback?: boolean }
): Promise<NextResponse> {
  const openaiKey = process.env.OPENAI_API_KEY!.trim();
  const dataUrl = `data:${params.mime};base64,${params.base64}`;

  const openaiModel =
    process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";

  const openaiBase =
    (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/$/,
      ""
    );
  const chatUrl = `${openaiBase}/chat/completions`;

  const openAiBody = JSON.stringify({
    model: openaiModel,
    temperature: 0,
    max_tokens: 16384,
    messages: [
      { role: "system", content: params.system },
      {
        role: "user",
        content: [
          { type: "text", text: params.userText },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const openAiHeaders = {
    Authorization: `Bearer ${openaiKey}`,
    "Content-Type": "application/json",
  };

  let openaiRes = await fetch(chatUrl, {
    method: "POST",
    headers: openAiHeaders,
    body: openAiBody,
  });
  if (openaiRes.status === 429) {
    await new Promise((r) => setTimeout(r, 3000));
    openaiRes = await fetch(chatUrl, {
      method: "POST",
      headers: openAiHeaders,
      body: openAiBody,
    });
  }

  if (!openaiRes.ok) {
    const detail = await openaiRes.text();
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (
      !params.noGeminiFallback &&
      geminiKey &&
      openAiFailureAllowsGeminiFallback(openaiRes.status, detail)
    ) {
      return extractWithGeminiVision(params);
    }
    const friendly = friendlyOpenAiHttpError(openaiRes.status, detail);
    return NextResponse.json(
      {
        error: friendly,
        status: openaiRes.status,
        detail: detail.slice(0, 2000),
      },
      { status: 502 }
    );
  }

  const openaiData = (await openaiRes.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const raw = openaiData.choices?.[0]?.message?.content;
  if (typeof raw !== "string") {
    return NextResponse.json(
      { error: "Neočekávaná odpověď modelu (chybí text)" },
      { status: 502 }
    );
  }

  const parsed = parseLidlPageOffersJson(raw, { fillMissingNullKeys: true });
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "Validace JSON selhala",
        validation_errors: parsed.errors,
        raw_model_output: raw,
        model: openaiModel,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ok: true,
    offers: parsed.offers,
    model: openaiModel,
    page_no: params.page_no,
    source_url: params.source_url,
  });
}

async function extractWithGeminiVision(
  params: VisionExtractParams
): Promise<NextResponse> {
  const geminiKey = process.env.GEMINI_API_KEY!.trim();
  const geminiModel =
    process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash";

  const gem = await geminiVisionExtractText({
    apiKey: geminiKey,
    model: geminiModel,
    systemPrompt: params.system,
    userText: params.userText,
    imageBase64: params.base64,
    mimeType: params.mime,
  });

  if (!gem.ok) {
    const openaiKey = process.env.OPENAI_API_KEY?.trim();
    if (openaiKey && geminiFailureAllowsOpenAiFallback(gem.status)) {
      return extractWithOpenAiVision({ ...params, noGeminiFallback: true });
    }
    return NextResponse.json(
      { error: gem.error, status: gem.status },
      { status: 502 }
    );
  }

  const parsed = parseLidlPageOffersJson(gem.text, {
    fillMissingNullKeys: true,
  });
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "Validace JSON selhala",
        validation_errors: parsed.errors,
        raw_model_output: gem.text,
        model: `google/${geminiModel}`,
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    ok: true,
    offers: parsed.offers,
    model: `google/${geminiModel}`,
    page_no: params.page_no,
    source_url: params.source_url,
  });
}

export async function POST(req: NextRequest) {
  const requestId = makeRequestId();
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Očekávám multipart/form-data" },
        { status: 400 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Pole 'file' musí být obrázek jedné stránky letáku (JPEG, PNG, WebP, GIF)" },
        { status: 400 }
      );
    }

    const mime = file.type || "application/octet-stream";
    if (!ALLOWED_IMAGE.test(mime)) {
      return NextResponse.json(
        {
          error:
            "Nepodporovaný typ souboru. Pošli obrázek (image/jpeg, image/png, image/webp, image/gif). PDF nejdřív převeď na obrázek stránky.",
        },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Soubor je větší než 20 MB" },
        { status: 400 }
      );
    }

    const pageNoRaw = form.get("page_no");
    let page_no: number | null = null;
    if (typeof pageNoRaw === "string" && pageNoRaw.trim()) {
      const n = Number(pageNoRaw);
      if (!Number.isFinite(n) || n < 1) {
        return NextResponse.json(
          { error: "page_no musí být kladné celé číslo" },
          { status: 400 }
        );
      }
      page_no = Math.floor(n);
    }

    const su = form.get("source_url");
    const source_url =
      typeof su === "string" && su.trim() ? su.trim() : null;

    if (isMockExtractionEnabled()) {
      return NextResponse.json({
        ok: true,
        offers: getMockLidlPageOffers(page_no),
        model: MOCK_EXTRACTION_MODEL_LABEL,
        page_no,
        source_url,
      });
    }

    const provider = resolveVisionProvider();
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "Chybí OPENAI_API_KEY nebo GEMINI_API_KEY (Gemini: zdarma/levně na aistudio.google.com). Nebo nech výchozí ukázku bez klíčů.",
        },
        { status: 503 }
      );
    }

    const system = getSystemPromptLidlCzStrict();
    const userText = buildUserPromptForLidlPage({
      page_no,
      source_url: source_url ?? undefined,
    });

    const base64 = buf.toString("base64");

    const visionParams: VisionExtractParams = {
      system,
      userText,
      base64,
      mime,
      page_no,
      source_url,
    };

    if (provider === "gemini") {
      return extractWithGeminiVision(visionParams);
    }

    return extractWithOpenAiVision(visionParams);
  } catch (e) {
    return safeErrorJson({
      status: 500,
      code: "UPSTREAM_ERROR",
      message: "Zpracování stránky selhalo.",
      requestId,
      cause: e,
      logContext: { route: "/api/parse-lidl-page" },
    });
  }
}
