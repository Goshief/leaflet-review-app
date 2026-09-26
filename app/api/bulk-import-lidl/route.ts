import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_BYTES = 25 * 1024 * 1024;
const ID_NAMESPACE = "setrik-lidl-bulk-v1";

type SourceRow = {
  product_id: string; nazev: string; znacka?: string; baleni?: string;
  cena: unknown; bezna_cena?: unknown; klubova_cena?: unknown;
  kategorie?: string; podkategorie?: string; strana?: unknown; poradi?: unknown;
  platnost_od: string; platnost_do: string; typ_nabidky?: string;
  podminky?: string; pdf_sha256?: string; raw_json?: unknown;
};

// RFC-4180-style parser: quoted commas, semicolons, newlines and doubled quotes.
function parseCsv(text: string): SourceRow[] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === delimiter) {
      row.push(value); value = "";
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error("CSV má neuzavřené uvozovky.");
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  const [header, ...body] = rows;
  if (!header) throw new Error("CSV je prázdné.");
  const names = header.map((name) => name.trim().replace(/^\uFEFF/, ""));
  for (const required of ["product_id", "nazev", "cena", "platnost_od", "platnost_do"]) {
    if (!names.includes(required)) throw new Error("CSV postrádá sloupec: " + required);
  }
  return body.map((cells) =>
    Object.fromEntries(names.map((name, index) => [name, cells[index] ?? ""])) as SourceRow
  );
}

async function parseSqlite(bytes: Uint8Array): Promise<SourceRow[]> {
  // Node.js SQLite is used server-side; never run untrusted SQL from an uploaded file.
  const sqliteModule = "node:" + "sqlite";
  const { DatabaseSync } = await import(sqliteModule);
  const dir = await mkdtemp(join(tmpdir(), "setrik-lidl-"));
  const file = join(dir, "upload.sqlite3");
  try {
    await writeFile(file, bytes);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const sql = `SELECT n.produkt_id, p.nazev, p.znacka, p.baleni,
        p.cena, p.bezna_cena, p.klubova_cena, p.kategorie, p.podkategorie,
        n.strana, n.poradi, n.platnost_od, n.platnost_do, n.typ_nabidky,
        n.podminky, n.pdf_sha256, n.raw_json
        FROM letak_nabidky n
        JOIN letaky l ON l.id = n.letak_id
        JOIN produkty p ON p.id = n.produkt_id
        WHERE lower(l.obchod) = 'lidl' AND n.schvaleno IS NOT NULL
        ORDER BY n.platnost_od, n.letak_id, n.strana, n.poradi`;
      return db.prepare(sql).all() as SourceRow[];
    } finally { db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function price(input: unknown, mandatory = false): number | null {
  if (input === null || input === undefined || String(input).trim() === "") {
    if (mandatory) throw new Error("Chybí akční cena.");
    return null;
  }
  const number = Number(String(input).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) throw new Error("Neplatná cena: " + String(input));
  return number;
}

function date(value: unknown): string {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + "T00:00:00Z")))
    throw new Error("Neplatné datum: " + text);
  return text;
}

function canonicalKey(row: SourceRow) {
  return [row.nazev.trim(), date(row.platnost_od), date(row.platnost_do), price(row.cena, true)].join("\u0000");
}
function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), "5" + hex.slice(13, 16),
    "8" + hex.slice(17, 20), hex.slice(20, 32)].join("-");
}

export async function POST(req: NextRequest) {
  const token = process.env.BULK_IMPORT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "Nastavte BULK_IMPORT_TOKEN v serverovém prostředí." }, { status: 503 });
  const supplied = req.headers.get("x-bulk-import-token") || "";
  const expected = createHash("sha256").update(token).digest();
  const actual = createHash("sha256").update(supplied).digest();
  const { timingSafeEqual } = await import("node:crypto");
  if (!supplied || !timingSafeEqual(expected, actual))
    return NextResponse.json({ ok: false, error: "Neplatný importní klíč." }, { status: 403 });
  const client = getSupabaseAdmin();
  if (!client) return NextResponse.json({ ok: false, error: "Supabase admin není nakonfigurovaný." }, { status: 503 });

  let rows: SourceRow[];
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Vyberte CSV nebo SQLite soubor.");
    if (file.size > MAX_BYTES) throw new Error("Soubor je větší než 25 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isSqlite = new TextDecoder().decode(bytes.slice(0, 16)) === "SQLite format 3\u0000";
    if (!isSqlite && !/\.csv$/i.test(file.name)) throw new Error("Podporujeme soubory .csv a .sqlite3.");
    rows = isSqlite ? await parseSqlite(bytes) : parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!rows.length) throw new Error("Soubor neobsahuje schválené nabídky Lidlu.");
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Nelze načíst soubor." }, { status: 400 });
  }

  // All rows are validated before any database write.
  let unique: SourceRow[], discarded = 0, invalid = 0;
  try {
    const seen = new Set<string>();
    unique = [];
    for (const row of rows) {
      if (!row.product_id?.startsWith("letak:lidl:")) { invalid++; continue; }
      if (!row.nazev?.trim()) { invalid++; continue; }
      const p = price(row.cena, true);
      if (p === null || !row.platnost_od || !row.platnost_do || date(row.platnost_od) > date(row.platnost_do)) {
        invalid++; continue;
      }
      price(row.bezna_cena);
      price(row.klubova_cena);
      const key = canonicalKey(row);
      if (seen.has(key)) { discarded++; continue; }
      seen.add(key);
      unique.push(row);
    }
    if (!unique.length || invalid) throw new Error(`Neplatné nebo nelidlovské položky: ${invalid}. Import nebyl spuštěn.`);
    const hashes = [...new Set(unique.map((r) => r.pdf_sha256).filter(Boolean))].sort();
    const identity = hashes.length === 1
      ? hashes[0]!
      : createHash("sha256").update(unique.map((r) => r.product_id).sort().join("|")).digest("hex");
    const importId = stableUuid(ID_NAMESPACE + ":" + identity);

    const { error: importError } = await client.from("imports").upsert(
      { id: importId, source_type: "leaflet", note: `Lidl one-click | ${identity}`,
        import_contract_snapshot: { source: "one_click", retailer: "lidl", source_count: rows.length } },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (importError) throw new Error("Nelze vytvořit import: " + importError.message);

    const { data: previous, error: selectError } = await client.from("offers_raw")
      .select("source_external_id").eq("import_id", importId).eq("store_id", "lidl").limit(1000);
    if (selectError) throw new Error("Nelze ověřit duplicity: " + selectError.message);
    const existing = new Set((previous || []).map((r) => r.source_external_id));
    const pending = unique.filter((r) => !existing.has(r.product_id));
    let inserted = 0, skipped = discarded + unique.length - pending.length;
    for (let i = 0; i < pending.length; i += 40) {
      const batch = pending.slice(i, i + 40).map((r) => {
        const raw = typeof r.raw_json === "string" && r.raw_json ? JSON.parse(r.raw_json) : (r.raw_json || {});
        const standard = price(r.bezna_cena);
        const loyalty = price(r.klubova_cena);
        const sale = price(r.cena, true)!;
        return {
          import_id: importId, store_id: "lidl", source_type: "leaflet",
          ingestion_source_type: "sqlite_lidl_etak", source_external_id: r.product_id,
          valid_from: date(r.platnost_od), valid_to: date(r.platnost_do),
          extracted_name: r.nazev.trim(), price_total: sale, currency: "CZK",
          price_standard: standard, price_after_sale: sale,
          price_with_loyalty_card: loyalty, has_loyalty_card_price: loyalty !== null,
          brand: r.znacka || null, category: r.kategorie || null, subcategory: r.podkategorie || null,
          promo_type: loyalty !== null ? "loyalty_card" : "flyer", price_total_type: "sale",
          notes: r.podminky || null,
          review_status: String(raw.kontrola || "").toUpperCase().includes("KE KONTROLE") ? "review" : "ok",
          review_reason: raw.kontrola || null, moderation_status: "pending",
          pipeline_version: "one_click_lidl_v1",
          publish_lineage: {
            source: "sqlite_or_csv_upload", sqlite_product_id: r.product_id,
            pdf_sha256: r.pdf_sha256 || null, page_no: Number(r.strana) || null,
            page_position: Number(r.poradi) || null, offer_type: r.typ_nabidky || null,
            original_raw: raw, pack_text: r.baleni || null,
          },
        };
      });
      // Database identity index may detect a conflict missed by source-ID checks.
      // ignoreDuplicates is intentional: no updates to previously reviewed offers.
      const { data, error } = await client.from("offers_raw").upsert(batch, {
        onConflict: "import_id,store_id,product_family_key,comparable_group_key,normalized_name,extracted_name,valid_from,valid_to,price_total",
        ignoreDuplicates: true,
      }).select("id");
      if (error) {
        // A nonstandard/partial unique index is not a valid ON CONFLICT target:
        // fall back to isolated inserts and only skip PostgreSQL unique violations.
        for (const item of batch) {
          const result = await client.from("offers_raw").insert(item).select("id").maybeSingle();
          if (result.error?.code === "23505") { skipped++; continue; }
          if (result.error) throw new Error("Zápis nabídky selhal: " + result.error.message);
          inserted += result.data ? 1 : 0;
        }
      } else inserted += data?.length || 0;
    }
    return NextResponse.json({ ok: true, import_id: importId, source_count: rows.length,
      inserted, skipped, invalid: 0, link: "/batches/" + importId });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Import selhal." }, { status: 500 });
  }
}
