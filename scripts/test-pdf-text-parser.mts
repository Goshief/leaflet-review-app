/**
 * PDF text layer (y nahoru) → stejný extraktor jako dávky.
 * Häagen-Dazs musí být 79,90, ne jednotková 17,37.
 */
import assert from "node:assert/strict";
import type { OcrWord } from "../lib/ocr/types.ts";
import { parseLeafletPageFromPdfText } from "../lib/leaflet-review/parse-page.ts";

function w(text: string, x: number, y: number, h = 12, width?: number): OcrWord {
  return { text, x, y, w: width ?? Math.max(24, text.length * 7), h };
}

/** cy = baseline velké ceny; název má vyšší y (nad cenou v PDF). */
function offerBlock(args: {
  cx: number;
  cy: number;
  name: string;
  price: string;
  pack?: string;
  standard?: string;
  unit?: string;
  extra?: Array<[string, number, number, number?]>;
}): OcrWord[] {
  const { cx, cy, name, price } = args;
  const out: OcrWord[] = [
    w(name, cx - 70, cy + 52, 15),
    w(price, cx - 18, cy, 36, 72),
  ];
  if (args.pack) out.push(w(args.pack, cx - 70, cy + 34, 11));
  if (args.standard) out.push(w(args.standard, cx - 24, cy - 44, 11, 80));
  if (args.unit) out.push(w(args.unit, cx - 70, cy - 60, 10, 110));
  for (const [t, dx, dy, h] of args.extra ?? []) out.push(w(t, cx + dx, cy + dy, h ?? 11));
  return out;
}

const words: OcrWord[] = [
  w("BILLA", 40, 900, 18),
  w("5. 8. – 11. 8. 2026", 200, 900, 11),
  ...offerBlock({
    cx: 120, cy: 720, name: "Maliny", price: "34,90", pack: "125 g",
    standard: "49,90/", unit: "100 g = 27,92",
  }),
  ...offerBlock({
    cx: 340, cy: 720, name: "Meloun vodní", price: "11,90",
    standard: "19,90/", unit: "cena za 1 kg", extra: [["cenazatkg", -70, -76, 10]],
  }),
  ...offerBlock({
    cx: 560, cy: 720, name: "Losos filet", price: "28,90",
    standard: "49,90/", unit: "cena za 100 g",
  }),
  ...offerBlock({
    cx: 780, cy: 720, name: "Vocílka Premium kuře", price: "89,90",
    standard: "159,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 120, cy: 470, name: "Vepřová panenka", price: "149,90",
    standard: "259,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 340, cy: 470, name: "Häagen-Dazs", price: "79,90", pack: "460 ml",
    standard: "194,90/", unit: "100 ml = 17,37",
  }),
  ...offerBlock({
    cx: 560, cy: 470, name: "Tullamore D.E.W.", price: "299,90", pack: "0.7 l",
    extra: [["NAŠE CENA", -20, 70, 10]],
  }),
  ...offerBlock({
    cx: 780, cy: 470, name: "Vepřová krkovice bez kosti", price: "79,90",
    standard: "198,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 120, cy: 220, name: "Vejce podestýlková M", price: "29,90", pack: "10 ks",
    extra: [
      ["BILLA klub", -70, 70, 12],
      ["běžná cena 49,90", -40, -44, 11],
    ],
  }),
  ...offerBlock({
    cx: 340, cy: 220, name: "Banán", price: "22,90", pack: "1 kg",
    standard: "39,90/",
  }),
  ...offerBlock({
    cx: 560, cy: 220, name: "Hovězí hamburger", price: "99,90",
    extra: [["Hamburgerové bulky", -70, 34, 12], ["cena za KOMBO", -20, -48, 10]],
  }),
  ...offerBlock({
    cx: 780, cy: 220, name: "Rajčata masitá", price: "49,90", pack: "1 kg",
    standard: "69,90/",
  }),
  ...offerBlock({
    cx: 120, cy: 80, name: "Pilsner Urquell", price: "25,90", pack: "0.5 l",
    unit: "1 l = 51,80", extra: [["NAŠE CENA", -20, 70, 10]],
  }),
  ...offerBlock({
    cx: 340, cy: 80, name: "Bohemia Sekt", price: "99,90", pack: "0.75 l",
    extra: [
      ["BILLA klub", -70, 70, 12],
      ["běžná cena 179,90", -40, -44, 11],
      ["PO ZBYTEK TÝDNE 109,90", -80, -62, 11],
    ],
  }),
  w("VÍCE VÍKENDOVÝCH SLEV UVNITŘ", 560, 20, 12, 220),
  w("109,90", 800, 18, 12, 50),
  w("běžná", 900, 400, 11),
  w("30,30", 900, 382, 11),
];

const parsed = parseLeafletPageFromPdfText(words, 1, "billa");
const named = parsed.offers.filter((o) => o.extracted_name);
const names = named.map((o) => String(o.extracted_name));
const byPrice = (n: number) => named.filter((o) => Math.abs(Number(o.price_total) - n) < 0.02);

assert.ok(parsed.offers.every((o) => o.store_id === "billa"));
assert.equal(byPrice(17.37).length, 0, "17,37 nesmí být price_total");
assert.equal(byPrice(109.9).length, 0, "109,90 po zbytek týdne není produkt");
assert.equal(byPrice(30.3).length, 0);
assert.ok(!names.some((n) => /^(?:běžná|cenazatkg|víkendových)$/i.test(n)), names.join(" | "));

const haagen = byPrice(79.9)[0];
assert.ok(haagen && /H[äa]agen|Dazs/i.test(String(haagen.extracted_name)), `Häagen-Dazs 79,90, mám ${names.join("; ")}`);
assert.equal(haagen.typical_price_per_unit, 17.37);

const maliny = byPrice(34.9)[0];
assert.ok(maliny && /Maliny/i.test(String(maliny.extracted_name)));

const urquell = byPrice(25.9)[0];
assert.ok(urquell && /Pilsner|Urquell/i.test(String(urquell.extracted_name)));

assert.ok(named.length >= 10, `málo produktů: ${named.length} ${names.join("; ")}`);

console.log(`OK: pdf-text parser — ${named.length} produktů: ${names.join("; ")}`);
