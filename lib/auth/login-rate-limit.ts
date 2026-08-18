export const LOGIN_RATE_LIMIT_ERROR =
  "Příliš mnoho pokusů o přihlášení. Zkuste to znovu později.";
export const LOGIN_UNAVAILABLE_ERROR =
  "Přihlášení je dočasně nedostupné. Zkuste to prosím později.";

const EMAIL_LIMIT = 5;
const IP_LIMIT = 20;
const WINDOW_SECONDS = 15 * 60;
const BLOCK_SECONDS = 15 * 60;
const RPC_TIMEOUT_MS = 4000;

type RpcError = { message?: string } | null;

export type LoginRateLimitClient = {
  rpc: (
    functionName: string,
    params?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: RpcError }>;
};

type ConsumeResult =
  | { ok: true; emailKeyHash: string }
  | { ok: false; code: "rate_limited"; retryAfter: number }
  | { ok: false; code: "unavailable" };

function firstForwardedAddress(value: string | null): string | null {
  const address = value?.split(",", 1)[0]?.trim();
  return address || null;
}

export function getRequestAddress(headers: Pick<Headers, "get">): string {
  return (
    firstForwardedAddress(headers.get("cf-connecting-ip")) ??
    firstForwardedAddress(headers.get("x-forwarded-for")) ??
    firstForwardedAddress(headers.get("x-real-ip")) ??
    "unknown"
  );
}

export async function hashLoginRateLimitKey(kind: "email" | "ip", value: string) {
  const normalized = kind === "email" ? value.trim().toLowerCase() : value.trim();
  const bytes = new TextEncoder().encode(`login-rate-limit:v1:${kind}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readRpcRow(data: unknown): { allowed: boolean; retryAfter: number } | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;

  const candidate = row as Record<string, unknown>;
  if (typeof candidate.allowed !== "boolean") return null;

  const retryAfter = candidate.retry_after_seconds;
  if (typeof retryAfter !== "number" || !Number.isFinite(retryAfter)) return null;

  return {
    allowed: candidate.allowed,
    retryAfter: Math.max(0, Math.ceil(retryAfter)),
  };
}

async function withRpcTimeout<T>(operation: PromiseLike<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), RPC_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function consumeKey(
  client: LoginRateLimitClient,
  keyHash: string,
  limit: number
): Promise<{ ok: true } | { ok: false; retryAfter: number } | null> {
  const response = await withRpcTimeout(
    client.rpc("consume_login_rate_limit", {
      p_key_hash: keyHash,
      p_limit: limit,
      p_window_seconds: WINDOW_SECONDS,
      p_block_seconds: BLOCK_SECONDS,
    })
  );

  if (!response || response.error) return null;
  const result = readRpcRow(response.data);
  if (!result) return null;
  return result.allowed ? { ok: true } : { ok: false, retryAfter: result.retryAfter };
}

export async function consumeLoginRateLimit(
  client: LoginRateLimitClient | null,
  input: { email: unknown; headers: Pick<Headers, "get"> }
): Promise<ConsumeResult> {
  if (!client || typeof input.email !== "string" || input.email.trim().length === 0) {
    return { ok: false, code: "unavailable" };
  }

  const [emailKeyHash, ipKeyHash] = await Promise.all([
    hashLoginRateLimitKey("email", input.email),
    hashLoginRateLimitKey("ip", getRequestAddress(input.headers)),
  ]);

  const ipResult = await consumeKey(client, ipKeyHash, IP_LIMIT);
  if (!ipResult) return { ok: false, code: "unavailable" };
  if (!ipResult.ok) {
    return { ok: false, code: "rate_limited", retryAfter: ipResult.retryAfter };
  }

  const emailResult = await consumeKey(client, emailKeyHash, EMAIL_LIMIT);
  if (!emailResult) return { ok: false, code: "unavailable" };
  if (!emailResult.ok) {
    return { ok: false, code: "rate_limited", retryAfter: emailResult.retryAfter };
  }

  return { ok: true, emailKeyHash };
}

export async function clearSuccessfulLoginRateLimit(
  client: LoginRateLimitClient,
  emailKeyHash: string
): Promise<void> {
  // Cleanup must never delay a successful login response.
  void withRpcTimeout(
    client.rpc("clear_login_rate_limit", { p_key_hash: emailKeyHash })
  );
}
