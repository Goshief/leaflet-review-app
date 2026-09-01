import { NextResponse } from "next/server";
import { listCatalogSnapshots } from "@/lib/catalog-collector/snapshot";
import { requireOperatorApi } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const files = await listCatalogSnapshots();
  return NextResponse.json({ ok: true, files });
}
