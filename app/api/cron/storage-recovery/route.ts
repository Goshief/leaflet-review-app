import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PDF_INTAKE_BUCKET } from "@/lib/leaflet-monitor/pdf-intake";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIST_LIMIT = 1000;
const DELETE_BATCH = 100;
const MAX_DELETE = 5000;
const MAX_DEPTH = 7;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isGeneratedPage(path: string): boolean {
  const match = path.match(/\/pages\/(\d{3})\.png$/i);
  if (!match) return false;
  return Number(match[1]) > 1;
}

async function collectGeneratedPages(storage: any) {
  const found: string[] = [];
  const stack: Array<{ prefix: string; depth: number }> = [{ prefix: "leaflets", depth: 0 }];

  while (stack.length && found.length < MAX_DELETE) {
    const current = stack.pop()!;
    if (current.depth > MAX_DEPTH) continue;

    for (let offset = 0; found.length < MAX_DELETE; offset += LIST_LIMIT) {
      const { data, error } = await storage.list(current.prefix, {
        limit: LIST_LIMIT,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`storage list ${current.prefix}: ${error.message}`);
      const rows = data ?? [];
      for (const item of rows) {
        const path = `${current.prefix}/${item.name}`;
        if (item.id) {
          if (isGeneratedPage(path)) found.push(path);
        } else if (current.depth < MAX_DEPTH) {
          stack.push({ prefix: path, depth: current.depth + 1 });
        }
        if (found.length >= MAX_DELETE) break;
      }
      if (rows.length < LIST_LIMIT) break;
    }
  }
  return found;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || (req.headers.get("authorization") || "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin is not configured" }, { status: 503 });
  }

  console.info("[storage-recovery] scan start");
  try {
    const paths = await collectGeneratedPages(supabase.storage.from(PDF_INTAKE_BUCKET));
    let deleted = 0;
    const errors: string[] = [];

    for (const batch of chunks(paths, DELETE_BATCH)) {
      const { error } = await supabase.storage.from(PDF_INTAKE_BUCKET).remove(batch);
      if (error) {
        errors.push(error.message);
        continue;
      }
      deleted += batch.length;
    }

    const result = { ok: errors.length === 0, found: paths.length, deleted, errors };
    console.info("[storage-recovery] complete", result);
    return NextResponse.json(result, { status: errors.length ? 207 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[storage-recovery] failed", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
