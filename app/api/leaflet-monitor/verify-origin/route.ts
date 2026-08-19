import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetailerId } from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "leaflet-intake";
const SUPPORTED = new Set<RetailerId>(["billa", "lidl", "kaufland", "penny"]);

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const retailer = url.searchParams.get("retailer") as RetailerId | null;
  const path = url.searchParams.get("path") || "";
  if (!retailer || !SUPPORTED.has(retailer) || !path.startsWith(`${retailer}/`)) {
    return NextResponse.json({ ok: false, error: "Invalid retailer/path" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) {
    return NextResponse.json({ ok: false, retailer, path, error: error?.message || "Object not found" }, { status: 404 });
  }

  const stored = new Uint8Array(await data.arrayBuffer());
  if (path.endsWith(".origin.json")) {
    try {
      const envelope = JSON.parse(new TextDecoder().decode(stored)) as {
        version?: number;
        retailer?: string;
        asset_url?: string;
        final_url?: string;
        origin_content_type?: string;
        origin_sha256?: string;
        origin_bytes?: number;
        encoding?: string;
        payload?: string;
      };
      if (envelope.encoding !== "base64" || typeof envelope.payload !== "string") throw new Error("Invalid origin envelope encoding");
      const raw = Uint8Array.from(Buffer.from(envelope.payload, "base64"));
      const sha256 = createHash("sha256").update(raw).digest("hex");
      const valid = envelope.retailer === retailer
        && envelope.origin_sha256 === sha256
        && envelope.origin_bytes === raw.byteLength;
      return NextResponse.json({
        ok: valid,
        retailer,
        path,
        kind: "html_snapshot",
        stored_bytes: stored.byteLength,
        restored_bytes: raw.byteLength,
        sha256,
        expected_sha256: envelope.origin_sha256 || null,
        content_type: envelope.origin_content_type || null,
        asset_url: envelope.asset_url || null,
        final_url: envelope.final_url || null,
      }, { status: valid ? 200 : 422 });
    } catch (parseError) {
      return NextResponse.json({ ok: false, retailer, path, error: parseError instanceof Error ? parseError.message : String(parseError) }, { status: 422 });
    }
  }

  const signature = new TextDecoder().decode(stored.slice(0, 5));
  const sha256 = createHash("sha256").update(stored).digest("hex");
  const valid = signature === "%PDF-";
  return NextResponse.json({
    ok: valid,
    retailer,
    path,
    kind: "pdf",
    stored_bytes: stored.byteLength,
    sha256,
    pdf_signature: signature,
  }, { status: valid ? 200 : 422 });
}
