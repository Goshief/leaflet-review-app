import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const maxDuration = 60;

const PAGE1 = "https://view.publitas.com/64069/2709538/pages/bad62f4b-9443-432c-839d-ee06ac3240c8-at1000.jpg";

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  try {
    const res = await fetch(PAGE1, { cache: "no-store" });
    if (!res.ok) throw new Error(`page image HTTP ${res.status}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    const sharpMod = await import("sharp");
    const sharp = sharpMod.default;
    const image = sharp(bytes).greyscale();
    const meta = await image.metadata();
    const stats = await image.stats();
    const small = await image.resize({ width: 128 }).raw().toBuffer({ resolveWithObject: true });
    let min = 255, max = 0, sum = 0;
    for (const v of small.data) { if (v < min) min = v; if (v > max) max = v; sum += v; }
    return NextResponse.json({
      ok: true,
      source_url: PAGE1,
      source_bytes: bytes.length,
      metadata: { width: meta.width, height: meta.height, format: meta.format, channels: meta.channels },
      stats: stats.channels.map((c) => ({ min: c.min, max: c.max, mean: c.mean, stdev: c.stdev })),
      resized: { width: small.info.width, height: small.info.height, channels: small.info.channels, min, max, mean: small.data.length ? sum / small.data.length : null },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
