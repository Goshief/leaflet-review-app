import { createHash } from "node:crypto";
import type { CatalogProduct, CatalogRunStats } from "./types.ts";

export const RETAILER_PRODUCT_COLUMNS = [
  "id",
  "retailer_id",
  "external_id",
  "source_url",
  "name",
  "brand",
  "sku",
  "gtin",
  "quantity_value",
  "quantity_unit",
  "image_url",
  "category",
  "country_of_origin",
  "metadata",
  "first_seen_at",
  "last_seen_at",
  "created_at",
  "updated_at",
] as const;

export const RETAILER_OFFER_COLUMNS = [
  "retailer_product_id",
  "retailer_id",
  "price",
  "regular_price",
  "loyalty_price",
  "unit_price",
  "unit_basis",
  "currency",
  "available",
  "source_url",
  "offer_fingerprint",
  "observed_at",
  "updated_at",
] as const;

export const PRICE_OBSERVATION_COLUMNS = [
  "id",
  "retailer_product_id",
  "retailer_id",
  "observed_on",
  "observed_at",
  "price",
  "regular_price",
  "loyalty_price",
  "unit_price",
  "unit_basis",
  "currency",
  "available",
  "source_url",
  "offer_fingerprint",
] as const;

type Cell = string | number | boolean | null | undefined;
type TableSheet = { name: string; headers: readonly string[]; rows: Cell[][] };

function stableUuid(seed: string) {
  const hash = createHash("sha1").update(seed).digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function pragueDate(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function offerFingerprint(product: CatalogProduct) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        price: product.offer.price,
        regular_price: product.offer.regularPrice,
        loyalty_price: product.offer.loyaltyPrice,
        unit_price: product.offer.unitPrice,
        unit_basis: product.offer.unitBasis,
        currency: product.offer.currency || "CZK",
        available: Boolean(product.offer.available),
      })
    )
    .digest("hex");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cell(value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return "<c/>";
  if (typeof value === "number" && Number.isFinite(value)) return `<c><v>${value}</v></c>`;
  if (typeof value === "boolean") return `<c t="b"><v>${value ? 1 : 0}</v></c>`;
  return `<c t="inlineStr"><is><t>${xmlEscape(String(value)).slice(0, 32000)}</t></is></c>`;
}

function sheetXml(name: string, headers: string[], rows: Array<Array<string | number | boolean | null | undefined>>) {
  const header = `<row r="1">${headers.map((h) => cell(h)).join("")}</row>`;
  const body = rows
    .map((row, index) => `<row r="${index + 2}">${row.map((value) => cell(value)).join("")}</row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${header}${body}</sheetData></worksheet>`;
}

function u16(n: number) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(n);
  return buf;
}

function u32(n: number) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(n);
  return buf;
}

function zipStore(files: Array<{ name: string; data: Buffer }>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.data);
    const local = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.data.length),
      u32(file.data.length),
      u16(name.length),
      u16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(
      Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x01, 0x02]),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(file.data.length),
        u32(file.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ])
    );
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, central, eocd]);
}

export function catalogImportTables(products: CatalogProduct[], collectedAt: string) {
  const retailerProducts: Cell[][] = [];
  const offers: Cell[][] = [];
  const observations: Cell[][] = [];

  for (const product of products) {
    const name = product.name.trim();
    const externalId = product.externalId.trim();
    const sourceUrl = product.sourceUrl.trim();
    if (!name || !externalId || !sourceUrl) continue;

    const productId = stableUuid(`retailer_products:${product.retailerId}:${externalId}`);
    const observationId = stableUuid(`retailer_price_observations:${product.retailerId}:${externalId}:${pragueDate(collectedAt)}`);
    const fingerprint = offerFingerprint(product);
    const currency = product.offer.currency?.trim() || "CZK";
    const available = Boolean(product.offer.available);
    const metadata = JSON.stringify(product.metadata ?? {});

    retailerProducts.push([
      productId,
      product.retailerId,
      externalId,
      sourceUrl,
      name,
      product.brand,
      product.sku,
      product.gtin,
      product.quantityValue,
      product.quantityUnit,
      product.imageUrl,
      product.category,
      product.countryOfOrigin,
      metadata,
      collectedAt,
      collectedAt,
      collectedAt,
      collectedAt,
    ]);
    offers.push([
      productId,
      product.retailerId,
      product.offer.price,
      product.offer.regularPrice,
      product.offer.loyaltyPrice,
      product.offer.unitPrice,
      product.offer.unitBasis,
      currency,
      available,
      sourceUrl,
      fingerprint,
      collectedAt,
      collectedAt,
    ]);
    observations.push([
      observationId,
      productId,
      product.retailerId,
      pragueDate(collectedAt),
      collectedAt,
      product.offer.price,
      product.offer.regularPrice,
      product.offer.loyaltyPrice,
      product.offer.unitPrice,
      product.offer.unitBasis,
      currency,
      available,
      sourceUrl,
      fingerprint,
    ]);
  }

  return {
    retailer_products: { headers: RETAILER_PRODUCT_COLUMNS, rows: retailerProducts },
    retailer_offers_current: { headers: RETAILER_OFFER_COLUMNS, rows: offers },
    retailer_price_observations: { headers: PRICE_OBSERVATION_COLUMNS, rows: observations },
  };
}

function csvFromTable(headers: readonly string[], rows: Cell[][]) {
  const lines = [
    headers.join(";"),
    ...rows.map((row) =>
      row
        .map((value) => {
          if (value == null) return "";
          const text = String(value);
          return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(";")
    ),
  ];
  return `\uFEFF${lines.join("\n")}`;
}

export function catalogProductsToCsvFiles(products: CatalogProduct[], collectedAt: string) {
  const tables = catalogImportTables(products, collectedAt);
  return {
    "retailer_products.csv": csvFromTable(tables.retailer_products.headers, tables.retailer_products.rows),
    "retailer_offers_current.csv": csvFromTable(tables.retailer_offers_current.headers, tables.retailer_offers_current.rows),
    "retailer_price_observations.csv": csvFromTable(tables.retailer_price_observations.headers, tables.retailer_price_observations.rows),
  };
}

function workbookFromSheets(sheets: TableSheet[]) {
  const sheetFiles = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: Buffer.from(sheetXml(sheet.name, [...sheet.headers], sheet.rows)),
  }));
  const overrides = sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join("");
  const workbookSheets = sheets
    .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  const rels = sheets
    .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
    .join("");

  return zipStore([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
    },
    ...sheetFiles,
  ]);
}

function runRow(stats: CatalogRunStats): Cell[] {
  return [
    stats.retailer,
    stats.failed > 0 && stats.saved === 0 ? "failed" : "completed",
    stats.discovered,
    stats.attempted,
    stats.saved,
    stats.failed,
    stats.startedAt,
    stats.finishedAt,
  ];
}

export function catalogProductsToXlsx(args: {
  products: CatalogProduct[];
  stats: CatalogRunStats;
  collectedAt: string;
  runs?: CatalogRunStats[];
}) {
  const tables = catalogImportTables(args.products, args.collectedAt);
  const runs = args.runs?.length ? args.runs : [args.stats];
  return workbookFromSheets([
    { name: "retailer_products", headers: tables.retailer_products.headers, rows: tables.retailer_products.rows },
    { name: "retailer_offers_current", headers: tables.retailer_offers_current.headers, rows: tables.retailer_offers_current.rows },
    { name: "retailer_price_observations", headers: tables.retailer_price_observations.headers, rows: tables.retailer_price_observations.rows },
    {
      name: "catalog_collector_runs",
      headers: ["retailer_id", "status", "discovered_count", "attempted_count", "saved_count", "failed_count", "started_at", "finished_at"],
      rows: runs.map(runRow),
    },
  ]);
}
