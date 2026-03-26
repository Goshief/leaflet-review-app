import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "pdf") return "application/pdf";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "gif") return "image/gif";
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const intake_id = (url.searchParams.get("intake_id") ?? "").trim();
  if (!intake_id) {
    return NextResponse.json({ ok: false, error: "Chybí intake_id" }, { status: 400 });
  }

  const baseDir =
    process.env.LEAFLET_INTAKE_DIR?.trim() || path.join(os.tmpdir(), "leaflet-intake");
  const entries = await fs.readdir(baseDir).catch(() => []);
  const match = entries.find((n) => n.startsWith(`${intake_id}.`));
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "intake_id nenalezen (soubor už může být smazaný)." },
      { status: 404 }
    );
  }

  const stored_path = path.join(baseDir, match);
  const buf = await fs.readFile(stored_path);
  const ext = match.toLowerCase().split(".").pop() || "";
  const mime = mimeFromExt(ext);

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
    },
  });
}

