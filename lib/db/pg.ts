import { Pool, type PoolClient } from "pg";

let cachedPool: Pool | undefined;
let loggedEnabled = false;

function shouldRejectUnauthorized(): boolean {
  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  // Strict TLS in production to prevent MITM / spoofed DB host
  return nodeEnv === "production";
}

export function getDbUrl(): string | null {
  const u = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  const url = u.trim();
  return url ? url : null;
}

export function getPgPool(): Pool {
  if (cachedPool) return cachedPool;
  const url = getDbUrl();
  if (!url) throw new Error("Chybí SUPABASE_DB_URL (nebo DATABASE_URL) pro transakční import.");

  if (!loggedEnabled) {
    loggedEnabled = true;
    console.info("[db] Transactional import enabled");
  }
  cachedPool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: shouldRejectUnauthorized() },
  });
  return cachedPool;
}

export async function withPgClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

