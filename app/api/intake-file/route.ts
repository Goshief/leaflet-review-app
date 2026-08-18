import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "leaflet-intake";

export async function GET(req: Request) {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const intake_id = (url.searchParams.get("intake_id") ?? "").trim();
  if (!intake_id) {
    return NextResponse.json({ ok: false, error: "Chybí intake_id" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase Storage není nakonfigurovaný." },
      { status: 503 }
    );
  }

  const { data: files, error: listError } = await supabase.storage
    .from(BUCKET)
    .list("", { search: intake_id, limit: 10 });

  if (listError) {
    return NextResponse.json({ ok: false, error: listError.message }, { status: 502 });
  }

  const match = (files ?? []).find((file) => file.name.startsWith(`${intake_id}.`));
  if (!match) {
    return NextResponse.json(
      { ok: false, error: "intake_id nenalezen ve Storage." },
      { status: 404 }
    );
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(match.name, 600);
  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Nepodařilo se vytvořit odkaz na soubor." },
      { status: 502 }
    );
  }

  return NextResponse.redirect(data.signedUrl, 307);
}
