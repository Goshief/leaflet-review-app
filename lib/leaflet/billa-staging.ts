import type { LidlPageOffer } from "../lidl-parser/lidl-page-offer.ts";
import type { LidlOfferWithOcrCrop } from "../ocr/to-lidl-offer.ts";
import type { OcrWord } from "../ocr/types.ts";

export type LeafletDateMeta = {
  valid_from: string | null;
  valid_to: string | null;
  valid_from_text: string | null;
  valid_to_text: string | null;
  year: number | null;
};

export type BillaStagingContext = {
  store_id: string;
  page_no: number | null;
  pageText: string;
  dates?: LeafletDateMeta;
  words?: OcrWord[];
  layoutBoxes?: Array<{ x: number; y: number; width: number; height: number } | null>;
};

const WEEKDAY =
  "pondělí|úterý|středy|čtvrtka|pátku|soboty|neděle|středu|čtvrtek|pátek";
const MONEY_RE = /\b(\d{1,4}[,.]\d{2})\b/g;
const UNIT_EQ_RE =
  /(\d+\s*(?:g|ml|kg|l|ks))\s*=\s*(\d{1,4}[,.]\d{1,2})(?:\s*Kč)?(\s*s\s+Klubem)?/gi;
const BRAND_PREFIXES = [
  "Häagen-Dazs",
  "Vocílka Premium",
  "Tullamore D.E.W.",
  "Pilsner Urquell",
  "Srdce domova",
  "Bohemia Sekt",
].sort((a, b) => b.length - a.length);

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function iso(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}
function num(raw: string): number {
  return Number(raw.replace(",", "."));
}

export function flattenRaw(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseLeafletHeaderDates(pageText: string): LeafletDateMeta {
  const t = flattenRaw(pageText);
  const fromPhrase = t.match(
    new RegExp(`\\bod\\s+(?:${WEEKDAY})\\s+\\d{1,2}\\.\\s*\\d{1,2}\\.?`, "i")
  );
  const toPhrase = t.match(
    new RegExp(
      `\\bdo\\s+(?:${WEEKDAY})\\s+\\d{1,2}\\.\\s*\\d{1,2}\\.?(?:\\s*\\d{4})?\\.?`,
      "i"
    )
  );
  const range = t.match(
    /(\d{1,2})\.\s*(\d{1,2})\.?\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*(\d{4})/
  );
  const explicit = t.match(
    new RegExp(
      `od(?:\\s+(?:${WEEKDAY}))?\\s+(\\d{1,2})\\.\\s*(\\d{1,2})\\.?\\s+do(?:\\s+(?:${WEEKDAY}))?\\s+(\\d{1,2})\\.\\s*(\\d{1,2})\\.?\\s*(\\d{4})`,
      "i"
    )
  );
  let year: number | null = range ? Number(range[5]) : explicit ? Number(explicit[5]) : null;
  if (year != null && !Number.isFinite(year)) year = null;
  let valid_from: string | null = null;
  let valid_to: string | null = null;
  if (year != null && range) {
    valid_from = iso(year, Number(range[2]), Number(range[1]));
    valid_to = iso(year, Number(range[4]), Number(range[3]));
  } else if (year != null && explicit) {
    valid_from = iso(year, Number(explicit[2]), Number(explicit[1]));
    valid_to = iso(year, Number(explicit[4]), Number(explicit[3]));
  }
  return {
    valid_from,
    valid_to,
    valid_from_text: fromPhrase ? fromPhrase[0] : range ? `${range[1]}. ${range[2]}.` : null,
    valid_to_text: toPhrase
      ? toPhrase[0]
      : range
        ? `${range[3]}. ${range[4]}. ${range[5]}.`
        : null,
    year,
  };
}

export function parseScopedDates(
  raw: string,
  year: number | null
): Pick<LeafletDateMeta, "valid_from" | "valid_to" | "valid_from_text" | "valid_to_text"> | null {
  const t = flattenRaw(raw);
  const y = year;
  const asIso = (month: string, day: string) =>
    y != null ? iso(y, Number(month), Number(day)) : null;
  const superSt = t.match(
    /SUPER\s+STŘEDA\s+A\s+ČTVRTEK\s+(\d{1,2})\.\s*(\d{1,2})\.?\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})\.?/i
  );
  if (superSt) {
    return {
      valid_from: asIso(superSt[2]!, superSt[1]!),
      valid_to: asIso(superSt[4]!, superSt[3]!),
      valid_from_text: `${superSt[1]}. ${superSt[2]}.`,
      valid_to_text: `${superSt[3]}. ${superSt[4]}.`,
    };
  }
  const superPa = t.match(/SUPER\s+PÁTEK\s+(\d{1,2})\.\s*(\d{1,2})\.?/i);
  if (superPa) {
    const text = `${superPa[1]}. ${superPa[2]}.`;
    return {
      valid_from: asIso(superPa[2]!, superPa[1]!),
      valid_to: asIso(superPa[2]!, superPa[1]!),
      valid_from_text: text,
      valid_to_text: text,
    };
  }
  const odDo = t.match(
    /\bOD\s+(\d{1,2})\.\s*(\d{1,2})\.?\s+DO\s+(\d{1,2})\.\s*(\d{1,2})\.?/i
  );
  if (odDo) {
    return {
      valid_from: asIso(odDo[2]!, odDo[1]!),
      valid_to: asIso(odDo[4]!, odDo[3]!),
      valid_from_text: `OD ${odDo[1]}. ${odDo[2]}.`,
      valid_to_text: `DO ${odDo[3]}. ${odDo[4]}.`,
    };
  }
  const od = t.match(
    /\bod\s+(?:\p{L}+\s+)?(\d{1,2})\.\s*(\d{1,2})\.?\s+do\s+(?:\p{L}+\s+)?(\d{1,2})\.\s*(\d{1,2})\.?/iu
  );
  if (od) {
    return {
      valid_from: asIso(od[2]!, od[1]!),
      valid_to: asIso(od[4]!, od[3]!),
      valid_from_text: `od ${od[1]}. ${od[2]}.`,
      valid_to_text: `do ${od[3]}. ${od[4]}.`,
    };
  }
  return null;
}

function brandFromName(name: string | null): string | null {
  if (!name) return null;
  const lower = name.toLocaleLowerCase("cs-CZ");
  for (const brand of BRAND_PREFIXES) {
    if (lower.startsWith(brand.toLocaleLowerCase("cs-CZ"))) return brand;
  }
  return null;
}

function titleFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toLocaleUpperCase("cs-CZ") + t.slice(1);
}

function stripDateBanners(raw: string): string {
  return flattenRaw(raw)
    .replace(
      /SUPER\s+STŘEDA\s+A\s+ČTVRTEK\s+\d{1,2}\.\s*\d{1,2}\.?\s*[–-]\s*\d{1,2}\.\s*\d{1,2}\.?/gi,
      " "
    )
    .replace(/SUPER\s+PÁTEK\s+\d{1,2}\.\s*\d{1,2}\.?/gi, " ")
    .replace(/\bOD\s+\d{1,2}\.\s*\d{1,2}\.?\s+DO\s+\d{1,2}\.\s*\d{1,2}\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function nameFromPipedRaw(raw: string): string | null {
  if (!raw.includes("|")) return null;
  const acc: string[] = [];
  for (const part of raw.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean)) {
    if (/^-?\d+\s*%$/.test(part)) break;
    if (UNIT_EQ_RE.test(part) || /100\s*g\s*=/i.test(part)) break;
    if (/^(?:běžná|NAŠE|CENA)(?:\s+cena)?$/i.test(part)) break;
    if (/billa\s*klub/i.test(part) && !/[A-Za-zÁ-ž]{6,}/.test(part.replace(/billa\s*klub/gi, ""))) continue;
    if (/^\d{1,3}[,.]\d{2}\/?$/.test(part)) break;
    if (/^balení,/i.test(part)) break;
    const stripped = part
      .replace(/\bbilla\s*klub\b/gi, " ")
      .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks)\b/gi, " ")
      .replace(/\bbalení,?\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!stripped) break;
    acc.push(stripped);
  }
  UNIT_EQ_RE.lastIndex = 0;
  const n = acc.join(" ").replace(/\s+/g, " ").trim();
  return n.length >= 3 ? titleFirst(n) : null;
}

function nameFromRaw(raw: string): string | null {
  let s = stripDateBanners(raw);
  s = s.replace(/^v nabídce také\s+/i, "");
  s = s.replace(/\bbilla\s*klub\b/gi, " ");
  s = s.replace(/\bs\s+klubem\b/gi, " ");
  s = s.replace(/\s*\+\s*záloha\b.*$/i, "");
  s = s.replace(/\s*voln[ýéáa]\w*,?/gi, " ");
  s = s.replace(/\s+cena za\b.*$/i, "");
  s = s.replace(/\s+\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks)\b.*$/i, "");
  s = s.replace(/\s+[-–]?\d+\s*%.*$/i, "");
  s = s.replace(/\s+\d{1,4}[,.]\d{2}.*$/i, "");
  s = s.replace(/\s*,\s*\d+\s*druhy.*$/i, "");
  s = s.replace(/\s*,\s*více druhů.*$/i, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 3) return null;
  return titleFirst(s);
}

type PackFields = Pick<LidlPageOffer, "pack_qty" | "pack_unit" | "pack_unit_qty">;

function parsePackFields(raw: string): PackFields {
  const t = flattenRaw(raw);
  const withoutUnitEq = t.replace(
    /\d+\s*(?:g|ml|kg|l|ks)\s*=\s*\d{1,4}[,.]\d{1,2}/gi,
    " "
  );
  const ksPack = withoutUnitEq.match(/\b(\d+)\s*ks(?:\s+v\s+balení)?\b/i);
  if (ksPack && Number(ksPack[1]) >= 2) {
    return { pack_qty: Number(ksPack[1]), pack_unit: "ks", pack_unit_qty: 1 };
  }
  const vol = withoutUnitEq.match(/\b(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i);
  if (vol) {
    const qty = num(vol[1]!);
    const unit = vol[2]!.toLowerCase();
    const isCenaZa100 = /cena za\s+100\s*g/i.test(t) && unit === "g" && qty === 100;
    const hasOtherPack = /\b(?!100\b)(\d+(?:[.,]\d+)?)\s*(g|ml|l)\b/i.test(
      withoutUnitEq.replace(/cena za\s+\d+\s*(?:g|kg|ml|l)/gi, " ")
    );
    if (!isCenaZa100 || !hasOtherPack) {
      return { pack_qty: 1, pack_unit: unit, pack_unit_qty: qty };
    }
  }
  const cenaZa = t.match(/cena za\s+(\d+(?:[.,]\d+)?)\s*(g|kg|ml|l)\b/i);
  if (cenaZa) {
    return { pack_qty: 1, pack_unit: cenaZa[2]!.toLowerCase(), pack_unit_qty: num(cenaZa[1]!) };
  }
  if (/1\s*kg\b/i.test(t) && /voln|cena za\s+1\s*kg/i.test(t)) {
    return { pack_qty: 1, pack_unit: "kg", pack_unit_qty: 1 };
  }
  return { pack_qty: null, pack_unit: null, pack_unit_qty: null };
}

type MoneyRoles = {
  sale: number | null;
  standard: number | null;
  typical: number | null;
  loyalty: number | null;
};

function parseMoneyRoles(raw: string): MoneyRoles {
  const t = flattenRaw(raw);
  const unitHits = [...t.matchAll(UNIT_EQ_RE)];
  const klubUnit = unitHits.find((m) => m[3]);
  const typicalRaw = (klubUnit ?? unitHits[0])?.[2];
  const typical = typicalRaw ? num(typicalRaw) : null;

  const klubPrice = t.match(/BILLA\s*klub\s+(\d{1,3}[,.]\d{2})/i);
  const standardLabeled = t.match(/běžná\s+cena\s+(\d{1,3}[,.]\d{2})/i);
  const nase = t.match(/NAŠE\s+CENA\s+(\d{1,3}[,.]\d{2})/i);
  const alsoZa = t.match(/\bza\s+(\d{1,3}[,.]\d{2})\s*Kč/i);
  const restWeek = t.match(/PO\s+ZBYTEK\s+TÝDNE\s+(\d{1,3}[,.]\d{2})/i);
  const bezKlubu = t.match(/(\d{1,4}[,.]\d{2})\s*Kč\s*bez\s+Klubu/i);

  const skip = new Set<number>();
  if (typical != null) skip.add(typical);
  if (bezKlubu) skip.add(num(bezKlubu[1]!));
  if (restWeek) skip.add(num(restWeek[1]!));

  if (klubPrice) {
    const loyalty = num(klubPrice[1]!);
    return {
      sale: loyalty,
      standard: standardLabeled ? num(standardLabeled[1]!) : null,
      typical,
      loyalty,
    };
  }
  if (nase) {
    return { sale: num(nase[1]!), standard: null, typical, loyalty: null };
  }
  if (/^v nabídce také/i.test(t) && alsoZa) {
    return { sale: num(alsoZa[1]!), standard: null, typical, loyalty: null };
  }

  const leftover: number[] = [];
  for (const m of t.matchAll(MONEY_RE)) {
    const v = num(m[1]!);
    if (skip.has(v)) continue;
    leftover.push(v);
  }
  const sale = leftover[0] ?? null;
  const standard =
    leftover[1] != null && leftover[0] != null && leftover[1] > leftover[0]
      ? leftover[1]
      : null;
  return { sale, standard, typical, loyalty: null };
}

function hasClub(raw: string): boolean {
  return /billa\s*klub|\bs\s+klubem\b/i.test(raw);
}

function variantNamesFromRaw(raw: string): string[] | null {
  const t = flattenRaw(raw);
  if (!/\d+\s*druhy/i.test(t) || /více\s+druhů/i.test(t)) return null;
  const beforePack = (stripDateBanners(t).split(/\d+(?:[.,]\d+)?\s*(?:ml|g|l|kg)\b/i)[0] ?? "")
    .replace(/,\s*\d+\s*druhy.*$/i, "")
    .trim();
  const parts = beforePack
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const brand = brandFromName(parts[0]!);
  if (!brand) return parts.map(titleFirst);
  return parts.map((part, i) => {
    if (i === 0) return titleFirst(part);
    if (part.toLocaleLowerCase("cs-CZ").startsWith(brand.toLocaleLowerCase("cs-CZ"))) {
      return titleFirst(part);
    }
    return `${brand} ${part}`.replace(/\s+/g, " ").trim();
  });
}

function emptyOffer(ctx: BillaStagingContext, raw: string): LidlOfferWithOcrCrop {
  return {
    store_id: ctx.store_id,
    source_type: "leaflet",
    page_no: ctx.page_no,
    valid_from: null,
    valid_to: null,
    valid_from_text: null,
    valid_to_text: null,
    extracted_name: null,
    price_total: null,
    currency: "CZK",
    pack_qty: null,
    pack_unit: null,
    pack_unit_qty: null,
    price_standard: null,
    typical_price_per_unit: null,
    price_with_loyalty_card: null,
    has_loyalty_card_price: false,
    notes: null,
    brand: null,
    category: null,
    raw_text_block: raw,
    ocr_crop_bbox: null,
  };
}

function applyDates(
  offer: LidlOfferWithOcrCrop,
  scoped: ReturnType<typeof parseScopedDates>,
  leaflet: LeafletDateMeta
): LidlOfferWithOcrCrop {
  return {
    ...offer,
    valid_from: scoped?.valid_from ?? offer.valid_from ?? leaflet.valid_from,
    valid_to: scoped?.valid_to ?? offer.valid_to ?? leaflet.valid_to,
    valid_from_text: scoped?.valid_from_text ?? offer.valid_from_text ?? leaflet.valid_from_text,
    valid_to_text: scoped?.valid_to_text ?? offer.valid_to_text ?? leaflet.valid_to_text,
  };
}

function matchScopedFromLayout(
  ctx: BillaStagingContext,
  box: { x: number; y: number; width: number; height: number } | null | undefined,
  year: number | null
): ReturnType<typeof parseScopedDates> {
  if (!box || !ctx.words?.length) return null;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const buckets = new Map<number, OcrWord[]>();
  for (const w of ctx.words) {
    const key = Math.round((w.y + w.h / 2) / 10);
    const arr = buckets.get(key);
    if (arr) arr.push(w);
    else buckets.set(key, [w]);
  }
  const regions: Array<{
    scoped: NonNullable<ReturnType<typeof parseScopedDates>>;
    y: number;
    x0: number;
    x1: number;
  }> = [];
  for (const group of buckets.values()) {
    const ws = group.slice().sort((a, b) => a.x - b.x);
    const text = ws.map((w) => w.text).join(" ");
    const scoped = parseScopedDates(text, year);
    if (!scoped) continue;
    regions.push({
      scoped,
      y: ws.reduce((s, w) => s + w.y + w.h / 2, 0) / ws.length,
      x0: Math.min(...ws.map((w) => w.x)),
      x1: Math.max(...ws.map((w) => w.x + w.w)),
    });
  }
  const above = regions
    .filter((r) => r.y > cy - 4 && r.x1 >= cx - 90 && r.x0 <= cx + 90)
    .sort((a, b) => a.y - cy - (b.y - cy));
  const nearest = above.sort((a, b) => Math.abs(a.y - cy) - Math.abs(b.y - cy))[0];
  return nearest?.scoped ?? null;
}

function refineBillaOffer(
  offer: LidlOfferWithOcrCrop,
  leaflet: LeafletDateMeta,
  ctx: BillaStagingContext,
  box?: { x: number; y: number; width: number; height: number } | null
): LidlOfferWithOcrCrop {
  const raw = flattenRaw(offer.raw_text_block);
  const scoped =
    parseScopedDates(raw, leaflet.year) ?? matchScopedFromLayout(ctx, box, leaflet.year);
  const money = parseMoneyRoles(raw);
  const pack = parsePackFields(raw);
  const club = hasClub(raw);
  const piped = nameFromPipedRaw(raw);
  const fromRaw = nameFromRaw(raw);
  const existing = offer.extracted_name?.trim() || null;
  const name =
    piped && (!existing || piped.length > existing.length + 2)
      ? piped
      : existing || fromRaw || piped;
  const brand = offer.brand ?? brandFromName(name);
  const notes = /po\s+zbytek\s+týdne/i.test(raw)
    ? "alternate period price not mapped"
    : offer.notes && !/unclear_name|ambiguous title/i.test(offer.notes)
      ? offer.notes
      : null;
  const packQty = pack.pack_qty ?? offer.pack_qty;
  const packUnit = pack.pack_unit ?? offer.pack_unit;
  const packUnitQty = pack.pack_unit_qty ?? offer.pack_unit_qty;
  const typical =
    money.typical ??
    (UNIT_EQ_RE.test(raw) ? offer.typical_price_per_unit : null);
  UNIT_EQ_RE.lastIndex = 0;
  const dated = applyDates(
    {
      ...offer,
      store_id: ctx.store_id,
      page_no: offer.page_no ?? ctx.page_no,
      extracted_name: name,
      price_total: club && money.sale != null ? money.sale : (offer.price_total ?? money.sale),
      pack_qty: packQty,
      pack_unit: packUnit,
      pack_unit_qty: packUnitQty,
      price_standard: money.standard ?? offer.price_standard,
      typical_price_per_unit: typical,
      price_with_loyalty_card: club ? (money.loyalty ?? money.sale ?? offer.price_total) : null,
      has_loyalty_card_price: club,
      notes,
      brand,
      category: null,
      raw_text_block: raw || offer.raw_text_block,
    },
    scoped,
    leaflet
  );
  return dated;
}

function expandTaké(
  offer: LidlOfferWithOcrCrop,
  leaflet: LeafletDateMeta,
  ctx: BillaStagingContext,
  box?: { x: number; y: number; width: number; height: number } | null
): LidlOfferWithOcrCrop[] | null {
  const raw = flattenRaw(offer.raw_text_block);
  const m = raw.match(
    /v nabídce také\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\s+za\s+(\d{1,3}[,.]\d{2})/i
  );
  if (!m) return null;
  const also: LidlOfferWithOcrCrop = applyDates(
    {
      ...emptyOffer(ctx, raw),
      ocr_crop_bbox: offer.ocr_crop_bbox ?? null,
      extracted_name: titleFirst(m[1]!.trim()),
      price_total: num(m[4]!),
      pack_qty: 1,
      pack_unit: m[3]!.toLowerCase(),
      pack_unit_qty: num(m[2]!),
      has_loyalty_card_price: false,
    },
    parseScopedDates(raw, leaflet.year) ?? matchScopedFromLayout(ctx, box, leaflet.year),
    leaflet
  );
  if (/^v nabídce také/i.test(raw)) return [also];
  const mainRaw = raw.replace(/\s*v nabídce také\s+.+$/i, "").trim();
  const main = refineBillaOffer({ ...offer, raw_text_block: mainRaw }, leaflet, ctx, box);
  main.raw_text_block = raw;
  return [main, also];
}

function expandCombo(
  offer: LidlOfferWithOcrCrop,
  leaflet: LeafletDateMeta,
  ctx: BillaStagingContext,
  box?: { x: number; y: number; width: number; height: number } | null
): LidlOfferWithOcrCrop[] | null {
  const raw = flattenRaw(offer.raw_text_block);
  if (!/cena za\s+KOMBO|\bKOMBO\b/i.test(raw)) return null;
  const chunks = raw.split(/\s*\+\s+/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length < 2) {
    const one = refineBillaOffer(offer, leaflet, ctx, box);
    return [
      {
        ...one,
        price_total: null,
        price_standard: null,
        notes: "shared combo price",
      },
    ];
  }
  const scoped =
    parseScopedDates(raw, leaflet.year) ?? matchScopedFromLayout(ctx, box, leaflet.year);
  return chunks.map((chunk, i) => {
    const piece =
      i === chunks.length - 1
        ? chunk.replace(/\s*cena za\s+KOMBO\s+\d{1,3}[,.]\d{2}.*$/i, "").trim()
        : chunk.trim();
    const name = nameFromRaw(piece.replace(/^\d+\s*ks\s+/i, ""));
    const pack = parsePackFields(piece);
    const money = parseMoneyRoles(piece);
    return applyDates(
      {
        ...emptyOffer(ctx, raw),
        ocr_crop_bbox: offer.ocr_crop_bbox ?? null,
        extracted_name: name,
        price_total: null,
        pack_qty: pack.pack_qty,
        pack_unit: pack.pack_unit,
        pack_unit_qty: pack.pack_unit_qty,
        typical_price_per_unit: money.typical,
        has_loyalty_card_price: false,
        notes: "shared combo price",
        brand: brandFromName(name),
      },
      scoped,
      leaflet
    );
  });
}

function expandDruhy(
  offer: LidlOfferWithOcrCrop,
  leaflet: LeafletDateMeta,
  ctx: BillaStagingContext,
  box?: { x: number; y: number; width: number; height: number } | null
): LidlOfferWithOcrCrop[] | null {
  const raw = flattenRaw(offer.raw_text_block);
  const names = variantNamesFromRaw(raw);
  if (!names || names.length < 2) return null;
  const base = refineBillaOffer(offer, leaflet, ctx, box);
  return names.map((extracted_name) => ({
    ...base,
    extracted_name,
    brand: brandFromName(extracted_name) ?? base.brand,
  }));
}

export function parseBillaRawBlock(
  raw: string,
  ctx: BillaStagingContext
): LidlOfferWithOcrCrop[] {
  const leaflet = ctx.dates ?? parseLeafletHeaderDates(ctx.pageText);
  const offer = emptyOffer(ctx, flattenRaw(raw));
  return expandBillaOffer(offer, leaflet, ctx);
}

function expandBillaOffer(
  offer: LidlOfferWithOcrCrop,
  leaflet: LeafletDateMeta,
  ctx: BillaStagingContext,
  box?: { x: number; y: number; width: number; height: number } | null
): LidlOfferWithOcrCrop[] {
  return (
    expandCombo(offer, leaflet, ctx, box) ??
    expandTaké(offer, leaflet, ctx, box) ??
    expandDruhy(offer, leaflet, ctx, box) ?? [refineBillaOffer(offer, leaflet, ctx, box)]
  );
}

export function applyBillaStaging(
  offers: LidlOfferWithOcrCrop[],
  ctx: BillaStagingContext
): LidlOfferWithOcrCrop[] {
  const leaflet = ctx.dates ?? parseLeafletHeaderDates(ctx.pageText);
  if (ctx.store_id !== "billa") {
    return offers.map((o) =>
      applyDates(
        { ...o, store_id: ctx.store_id, page_no: o.page_no ?? ctx.page_no },
        null,
        leaflet
      )
    );
  }
  const out: LidlOfferWithOcrCrop[] = [];
  offers.forEach((offer, i) => {
    const box = ctx.layoutBoxes?.[i] ?? null;
    out.push(...expandBillaOffer(offer, leaflet, ctx, box));
  });
  return out;
}
