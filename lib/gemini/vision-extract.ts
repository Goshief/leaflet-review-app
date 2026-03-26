/**
 * Google Gemini Vision — REST v1beta generateContent.
 * Klíč: https://aistudio.google.com/apikey
 *
 * Free tier má limity (orientačně řádově nízké RPM a denní strop — mění se podle modelu;
 * při 429 počkej nebo zvyš plán v Google AI).
 */

export type GeminiVisionResult =
  | { ok: true; text: string }
  | { ok: false; error: string; status?: number };

const GEMINI_429_RETRY_DELAYS_MS = [4000, 8000];

function gemini429Message(): string {
  return "Gemini: limit free tieru (často ~řádově nízké požadavky za minutu / den). Zkus za chvíli nebo jiný model; detaily v Google AI Studio → usage.";
}

async function fetchGeminiOnce(
  url: string,
  body: Record<string, unknown>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function geminiVisionExtractText(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageBase64: string;
  mimeType: string;
}): Promise<GeminiVisionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    params.model
  )}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

  const requestBody = {
    system_instruction: { parts: [{ text: params.systemPrompt }] },
    contents: [
      {
        role: "user",
        parts: [
          { text: params.userText },
          {
            inline_data: {
              mime_type: params.mimeType,
              data: params.imageBase64,
            },
          },
        ],
      },
    ],
    generation_config: {
      temperature: 0,
      max_output_tokens: 8192,
    },
  };

  let res: Response | null = null;
  let rawText = "";

  for (let attempt = 0; attempt < 1 + GEMINI_429_RETRY_DELAYS_MS.length; attempt++) {
    res = await fetchGeminiOnce(url, requestBody);
    rawText = await res.text();
    if (res.ok) break;
    if (res.status === 429 && attempt < GEMINI_429_RETRY_DELAYS_MS.length) {
      await new Promise((r) =>
        setTimeout(r, GEMINI_429_RETRY_DELAYS_MS[attempt]!)
      );
      continue;
    }
    break;
  }

  if (!res || !res.ok) {
    const st = res?.status ?? 0;
    let msg = rawText.slice(0, 800);
    try {
      const j = JSON.parse(rawText) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error:
        st === 429
          ? gemini429Message()
          : st === 400
            ? `Gemini: ${msg}`
            : `Gemini (HTTP ${st}): ${msg}`,
      status: st || undefined,
    };
  }

  let data: {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message?: string };
  };
  try {
    data = JSON.parse(rawText) as typeof data;
  } catch {
    return { ok: false, error: "Gemini: neplatná JSON odpověď" };
  }

  if (data.error?.message) {
    return { ok: false, error: `Gemini: ${data.error.message}` };
  }

  const cand = data.candidates?.[0];
  const reason = cand?.finishReason;
  if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
    return {
      ok: false,
      error: `Gemini: odpověď zastavena (${reason}).`,
    };
  }

  const text =
    cand?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? "";

  if (!text) {
    return { ok: false, error: "Gemini: prázdný text (zkontroluj model a obrázek)." };
  }

  return { ok: true, text };
}
