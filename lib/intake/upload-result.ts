export type IntakeUploadSuccess = {
  ok: true;
  intake_id: string;
  original_name: string | null;
  mime: string;
};

export type IntakeUploadFailure = {
  ok: false;
  error: string;
};

export type IntakeUploadResult = IntakeUploadSuccess | IntakeUploadFailure;

function errorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }

  return null;
}

function isVercelLoginPage(body: string): boolean {
  return /(?:Log in to Vercel|Continue with Email|\/sso-api\?)/i.test(body);
}

export async function readIntakeUploadResult(
  response: Response
): Promise<IntakeUploadResult> {
  const body = await response.text();

  if (!body.trim()) {
    return {
      ok: false,
      error: `Server nevrátil odpověď (HTTP ${response.status}).`,
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return {
      ok: false,
      error: isVercelLoginPage(body)
        ? "Přihlášení ke stagingu vypršelo. Obnov stránku a přihlas se znovu."
        : `Server vrátil neplatnou odpověď (HTTP ${response.status}).`,
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: errorMessage(payload) ?? `Upload selhal (HTTP ${response.status}).`,
    };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "Server vrátil neúplnou odpověď." };
  }

  const data = payload as Record<string, unknown>;
  if (data.ok !== true) {
    return {
      ok: false,
      error: errorMessage(data) ?? "Upload se nepodařilo uložit.",
    };
  }

  if (typeof data.intake_id !== "string" || typeof data.mime !== "string") {
    return { ok: false, error: "Server vrátil neúplnou odpověď." };
  }

  return {
    ok: true,
    intake_id: data.intake_id,
    original_name:
      typeof data.original_name === "string" ? data.original_name : null,
    mime: data.mime,
  };
}
