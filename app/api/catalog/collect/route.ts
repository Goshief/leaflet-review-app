import { NextRequest, NextResponse } from "next/server";
import { collectProductPage } from "@/lib/catalog/collector";
import { requireOperatorApi } from "@/lib/auth/guards";
import { requireSameOrigin } from "@/lib/auth/same-origin";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
const BUCKET = "leaflet-intake";

export async function POST(request: NextRequest) {
  const origin = requireSameOrigin(request);
  if (!origin.ok) return NextResponse.json({ ok: false, error: "Požadavek musí přijít ze stejné aplikace." }, { status: 403 });
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });
  let url = "";
  try { url = String((await request.json() as { url?: unknown }).url ?? "").trim(); }
  catch { return NextResponse.json({ ok: false, error: "Očekávám JSON s polem url." }, { status: 400 }); }
  if (!url) return NextResponse.json({ ok: false, error: "URL je povinná." }, { status: 400 });

  try {
    const collected = await collectProductPage(url);
    const prefix = `_catalog/${collected.snapshot.id}/${Date.now()}`;
    const htmlPath = `${prefix}/source.html`;
    const htmlUpload = await supabase.storage.from(BUCKET).upload(htmlPath, collected.html, { contentType: "text/html; charset=utf-8", upsert: false });
    if (htmlUpload.error) throw new Error(`Uložení HTML: ${htmlUpload.error.message}`);
    collected.snapshot.source_html_path = `${BUCKET}/${htmlPath}`;

    if (collected.image) {
      const imagePath = `${prefix}/product.${collected.image.extension}`;
      const imageUpload = await supabase.storage.from(BUCKET).upload(imagePath, collected.image.bytes, { contentType: collected.image.mime, upsert: false });
      if (imageUpload.error) throw new Error(`Uložení obrázku: ${imageUpload.error.message}`);
      collected.snapshot.product.image_storage_path = `${BUCKET}/${imagePath}`;
    }

    const manifestPath = `${prefix}/manifest.json`;
    collected.snapshot.manifest_path = `${BUCKET}/${manifestPath}`;
    const manifest = new TextEncoder().encode(JSON.stringify(collected.snapshot, null, 2));
    const manifestUpload = await supabase.storage.from(BUCKET).upload(manifestPath, manifest, { contentType: "application/json", upsert: false });
    if (manifestUpload.error) throw new Error(`Uložení manifestu: ${manifestUpload.error.message}`);
    return NextResponse.json({ ok: true, snapshot: collected.snapshot });
  } catch (cause) {
    const message = cause instanceof Error && cause.name === "AbortError" ? "Zdroj neodpověděl do 15 sekund." : cause instanceof Error ? cause.message : "Sběr produktu selhal.";
    return NextResponse.json({ ok: false, error: message }, { status: 422 });
  }
}
