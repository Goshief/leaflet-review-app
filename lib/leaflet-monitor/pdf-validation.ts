import { createHash } from "node:crypto";

export type PdfValidation = {
  ok: boolean;
  reason: "ok" | "too_small" | "bad_signature" | "sha256_mismatch";
  sha256: string | null;
};

export function validatePdfBytes(bytes: Uint8Array, expectedSha256?: string | null): PdfValidation {
  if (bytes.byteLength < 512) return { ok: false, reason: "too_small", sha256: null };
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") return { ok: false, reason: "bad_signature", sha256: null };

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 && sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    return { ok: false, reason: "sha256_mismatch", sha256 };
  }
  return { ok: true, reason: "ok", sha256 };
}
