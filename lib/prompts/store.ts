import fs from "node:fs/promises";
import path from "node:path";

export type ParserPromptRecord = {
  store_id: string;
  title: string;
  subtitle: string;
  prompt: string;
  // store-level config (defaults for review / extraction)
  config?: {
    default_extract?: "ocr" | "vision" | "local";
    enabled?: boolean;
    notes?: string;
  };
  updated_at: string;
  updated_by?: string | null;
  version?: number;
  history?: Array<{
    version: number;
    title: string;
    subtitle: string;
    prompt: string;
    config?: ParserPromptRecord["config"];
    updated_at: string;
    updated_by?: string | null;
  }>;
};

export type ParserPromptsDb = {
  version: 2;
  prompts: ParserPromptRecord[];
};

function promptsPath(): string {
  return (
    process.env.LEAFLET_PROMPTS_PATH?.trim() ||
    path.join(process.cwd(), "data", "parser-prompts.json")
  );
}

async function readDb(): Promise<ParserPromptsDb> {
  const p = promptsPath();
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const raw = await fs.readFile(p, "utf8").catch(() => "");
  if (!raw.trim()) {
    return { version: 2, prompts: [] };
  }
  try {
    const parsed = JSON.parse(raw) as any;
    if (!parsed || !Array.isArray(parsed.prompts)) {
      return { version: 2, prompts: [] };
    }
    // migrate v1 -> v2
    if (parsed.version === 1) {
      const migrated: ParserPromptsDb = {
        version: 2,
        prompts: (parsed.prompts as any[]).map((p: any) => ({
          store_id: String(p.store_id ?? "").toLowerCase(),
          title: String(p.title ?? ""),
          subtitle: String(p.subtitle ?? ""),
          prompt: String(p.prompt ?? ""),
          updated_at: String(p.updated_at ?? new Date().toISOString()),
          updated_by: null,
          version: 1,
          history: [],
        })),
      };
      return migrated;
    }
    if (parsed.version !== 2) return { version: 2, prompts: [] };
    return parsed as ParserPromptsDb;
  } catch {
    return { version: 2, prompts: [] };
  }
}

async function writeDb(db: ParserPromptsDb): Promise<void> {
  const p = promptsPath();
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(p, JSON.stringify(db, null, 2), "utf8");
}

export async function listPrompts(): Promise<ParserPromptRecord[]> {
  const db = await readDb();
  return db.prompts.slice().sort((a, b) => a.store_id.localeCompare(b.store_id));
}

export async function getPrompt(storeId: string): Promise<ParserPromptRecord | null> {
  const s = storeId.trim().toLowerCase();
  if (!s) return null;
  const db = await readDb();
  return db.prompts.find((p) => p.store_id.toLowerCase() === s) ?? null;
}

export async function upsertPrompt(input: {
  store_id: string;
  title: string;
  subtitle: string;
  prompt: string;
  updated_by?: string | null;
  config?: ParserPromptRecord["config"];
}): Promise<ParserPromptRecord> {
  const store_id = input.store_id.trim().toLowerCase();
  if (!store_id) throw new Error("store_id je povinné");
  const title = input.title.trim();
  const subtitle = input.subtitle.trim();
  const prompt = input.prompt ?? "";
  if (!title) throw new Error("title je povinné");
  if (!prompt.trim()) throw new Error("prompt nesmí být prázdný");

  const db = await readDb();
  const now = new Date().toISOString();
  const idx = db.prompts.findIndex((p) => p.store_id.toLowerCase() === store_id);
  const prev = idx >= 0 ? db.prompts[idx] : null;

  const nextVersion = Math.max(1, Number(prev?.version ?? 1) + (prev ? 1 : 0));
  const history = Array.isArray(prev?.history) ? prev!.history!.slice() : [];
  if (prev) {
    history.unshift({
      version: Number(prev.version ?? 1),
      title: prev.title,
      subtitle: prev.subtitle,
      prompt: prev.prompt,
      config: prev.config,
      updated_at: prev.updated_at,
      updated_by: prev.updated_by ?? null,
    });
  }

  const rec: ParserPromptRecord = {
    store_id,
    title,
    subtitle,
    prompt,
    config: input.config ?? prev?.config,
    updated_at: now,
    updated_by: (input.updated_by ?? null) || prev?.updated_by || null,
    version: nextVersion,
    history: history.slice(0, 20),
  };

  if (idx >= 0) db.prompts[idx] = rec;
  else db.prompts.push(rec);
  await writeDb(db);
  return rec;
}

