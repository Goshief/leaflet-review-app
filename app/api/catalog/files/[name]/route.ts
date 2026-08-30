import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { catalogSnapshotDir, isSafeSnapshotName } from "@/lib/catalog-collector/snapshot";
import { requireOperatorApi } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ name: string }> }) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const { name } = await context.params;
  if (!isSafeSnapshotName(name)) {
    return NextResponse.json({ ok: false, error: "Neplatný název souboru." }, { status: 400 });
  }

  try {
    const bytes = await readFile(path.join(catalogSnapshotDir(), name));
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Soubor zatím neexistuje." }, { status: 404 });
  }
}
