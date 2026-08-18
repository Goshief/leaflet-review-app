import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  recordObservation,
  shouldVisitRetailer,
  type RetailerLearningState,
} from "@/lib/leaflet-monitor/learning";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "leaflet-intake";
const RETAILER = "kaufland" as const;
const SOURCE_PAGE = "https://prodejny.kaufland.cz/letak.html";
const CRON_SCHEDULE = "13 7 * * *";
const LEARNING_PATH = `_learning/${RETAILER}.json`;
const USER_AGENT =
  "Mozilla/5.0 (compatible; LeafletReviewApp/1.0; +https://leaflet-review-app.vercel.app)";

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/");
}

function sanitize(value: string): string {
  return value
    .replace(/^https?:\/\//i, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
}

function extractKauflandFlyerUrl(html: string): string | null {
  const anchors = Array.from(
    html.matchAll(/<a\b[^>]*href=["']([^"']*leaflets\.kaufland\.com[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)
  );

  const candidates = anchors.map((match) => {
    const href = decodeHtml(match[1] ?? "");
    const text = (match[2] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return { href, text };
  });

  const main = candidates.find((x) => /Akční\s+nabídka/i.test(x.text));
  return main?.href || candidates[0]?.href || null;
}

function extractPdfCandidates(html: string, baseUrl: string): string[] {
  const found = new Set<string>();

  const add = (raw: string) => {
    let value = decodeHtml(raw.trim()).replace(/\\u0026/gi, "&");
    value = value.replace(/["'<>]+$/g, "");
    try {
      const absolute = new URL(value, baseUrl).toString();
      if (/\.pdf(?:$|[?#])/i.test(absolute)) found.add(absolute);
    } catch {
      // ignore malformed candidates
    }
  };

  for (const match of html.matchAll(/https?:\\?\/?\\?\/?[^"'<>\s]+?\.pdf(?:\?[^"'<>\s]*)?/gi)) add(match[0] ?? "");
  for (const match of html.matchAll(/(?:href|src|downloadUrl|pdfUrl|pdf_url)["']?\s*[:=]\s*["']([^"']+)["']/gi)) add(match[1] ?? "");
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = (match[2] ?? "").replace(/<[^>]+>/g, " ");
    if (/pdf|download|stáhn/i.test(label)) add(match[1] ?? "");
  }

  return [...found];
}

async function fetchWithTimeout(url: string, timeoutMs = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: "follow",
      cache: "no-store",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/pdf;q=0.9,*/*;q=0.8",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function resolvePdf(flyerUrl: string): Promise<{ url: string; bytes: Uint8Array }> {
  const viewer = await fetchWithTimeout(flyerUrl);
  if (!viewer.ok) throw new Error(`Kaufland viewer HTTP ${viewer.status}`);

  const viewerType = viewer.headers.get("content-type") ?? "";
  const viewerBytes = new Uint8Array(await viewer.arrayBuffer());
  if (viewerType.includes("application/pdf") || new TextDecoder().decode(viewerBytes.slice(0, 5)) === "%PDF-") {
    return { url: viewer.url || flyerUrl, bytes: viewerBytes };
  }

  const html = new TextDecoder().decode(viewerBytes);
  const candidates = extractPdfCandidates(html, viewer.url || flyerUrl);
  for (const candidate of candidates.slice(0, 8)) {
    try {
      const pdf = await fetchWithTimeout(candidate);
      if (!pdf.ok) continue;
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      const contentType = pdf.headers.get("content-type") ?? "";
      const signature = new TextDecoder().decode(bytes.slice(0, 5));
      if (contentType.includes("application/pdf") || signature === "%PDF-") return { url: pdf.url || candidate, bytes };
    } catch {
      // Try the next PDF candidate.
    }
  }
  throw new Error("Na stránce letáku se nepodařilo najít PDF ke stažení.");
}

function todayPrague(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readLearningState(supabase: any): Promise<RetailerLearningState | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(LEARNING_PATH);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as RetailerLearningState;
  } catch {
    return null;
  }
}

async function writeLearningState(supabase: any, state: RetailerLearningState) {
  const { error } = await supabase.storage.from(BUCKET).upload(
    LEARNING_PATH,
    new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }),
    { contentType: "application/json", upsert: true },
  );
  if (error) console.warn("[kaufland-leaflet-cron] learning state write failed", error.message);
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization") ?? "";
  const schedule = req.headers.get("x-vercel-cron-schedule") ?? "";

  if (cronSecret) {
    if (auth !== `Bearer ${cronSecret}`) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  } else if (schedule !== CRON_SCHEDULE) {
    return NextResponse.json({ ok: false, error: "Cron only" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const learning = await readLearningState(supabase);
  const decision = shouldVisitRetailer(learning);
  if (!decision.due) {
    return NextResponse.json({
      ok: true,
      status: "adaptive_skip",
      retailer: RETAILER,
      reason: decision.reason,
      checks_this_week: decision.checks_this_week,
      next_check_at: learning?.next_check_at ?? null,
      confidence: learning?.confidence ?? 0,
    });
  }

  const checkDate = todayPrague();
  const checkMarker = `_checks/${RETAILER}-${checkDate}.json`;
  const { data: existingMarker } = await supabase.storage.from(BUCKET).list("_checks", {
    search: `${RETAILER}-${checkDate}.json`,
    limit: 1,
  });
  if ((existingMarker ?? []).some((x) => x.name === `${RETAILER}-${checkDate}.json`)) {
    return NextResponse.json({ ok: true, status: "already_checked_today", retailer: RETAILER });
  }

  const checkedAt = new Date().toISOString();

  try {
    const page = await fetchWithTimeout(SOURCE_PAGE);
    if (!page.ok) throw new Error(`Kaufland source HTTP ${page.status}`);
    const html = await page.text();
    const flyerUrl = extractKauflandFlyerUrl(html);
    if (!flyerUrl) throw new Error("Na Kaufland stránce nebyl nalezen odkaz na leták.");

    const flyerKey = sanitize(new URL(flyerUrl).pathname) || createHash("sha256").update(flyerUrl).digest("hex").slice(0, 24);
    const folder = `${RETAILER}`;
    const { data: existing } = await supabase.storage.from(BUCKET).list(folder, { search: flyerKey, limit: 20 });
    const alreadyStored = (existing ?? []).some((x) => x.name.startsWith(`${flyerKey}__`));

    if (alreadyStored) {
      await supabase.storage.from(BUCKET).upload(
        checkMarker,
        new Blob([JSON.stringify({ checked_at: checkedAt, retailer: RETAILER, flyer_url: flyerUrl, status: "unchanged" })], { type: "application/json" }),
        { contentType: "application/json", upsert: true },
      );
      const nextLearning = recordObservation(learning, RETAILER, "unchanged", checkedAt);
      await writeLearningState(supabase, nextLearning);
      return NextResponse.json({ ok: true, status: "unchanged", retailer: RETAILER, flyer_url: flyerUrl, learning: nextLearning });
    }

    const pdf = await resolvePdf(flyerUrl);
    const sha256 = createHash("sha256").update(pdf.bytes).digest("hex");
    const filename = `${flyerKey}__${sha256.slice(0, 16)}.pdf`;
    const storagePath = `${folder}/${filename}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, pdf.bytes, {
      contentType: "application/pdf",
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadError) throw new Error(`Storage upload: ${uploadError.message}`);

    await supabase.storage.from(BUCKET).upload(
      checkMarker,
      new Blob([JSON.stringify({
        checked_at: checkedAt,
        retailer: RETAILER,
        status: "downloaded",
        source_page: SOURCE_PAGE,
        flyer_url: flyerUrl,
        pdf_url: pdf.url,
        sha256,
        bytes: pdf.bytes.byteLength,
        storage_path: storagePath,
      })], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );

    const nextLearning = recordObservation(learning, RETAILER, "downloaded", checkedAt);
    await writeLearningState(supabase, nextLearning);

    return NextResponse.json({
      ok: true,
      status: "downloaded",
      retailer: RETAILER,
      bytes: pdf.bytes.byteLength,
      storage_path: storagePath,
      flyer_url: flyerUrl,
      learning: nextLearning,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.storage.from(BUCKET).upload(
      checkMarker,
      new Blob([JSON.stringify({ checked_at: checkedAt, retailer: RETAILER, status: "error", error: message })], { type: "application/json" }),
      { contentType: "application/json", upsert: true },
    );
    const nextLearning = recordObservation(learning, RETAILER, "error", checkedAt);
    await writeLearningState(supabase, nextLearning);
    console.error("[kaufland-leaflet-cron]", message);
    return NextResponse.json({ ok: false, retailer: RETAILER, error: message, learning: nextLearning }, { status: 502 });
  }
}
