/**
 * Který vision provider použít (OpenAI vs Gemini).
 */
export type VisionProvider = "openai" | "gemini";

export function resolveVisionProvider(): VisionProvider | null {
  const prefer = process.env.EXTRACTION_PROVIDER?.trim().toLowerCase();
  const hasOpenai = !!process.env.OPENAI_API_KEY?.trim();
  const hasGemini = !!process.env.GEMINI_API_KEY?.trim();

  if (prefer === "gemini") {
    return hasGemini ? "gemini" : null;
  }
  if (prefer === "openai") {
    return hasOpenai ? "openai" : null;
  }
  /** Bez explicitní preference: preferuj OpenAI (ChatGPT API), Gemini až jako fallback. */
  if (hasOpenai) return "openai";
  if (hasGemini) return "gemini";
  return null;
}
