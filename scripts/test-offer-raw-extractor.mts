/**
 * Offer-raw pravidla: hlavní cena ≠ jednotková, název ≠ slogan/útržek.
 * Syntetická strana 1 BILLA (image OCR, y dolů) podle letáku 5.–11. 8. 2026.
 */
import assert from "node:assert/strict";
import type { OcrWord } from "../lib/ocr/types.ts";
import { runOcrPipeline } from "../lib/ocr/pipeline.ts";

function w(text: string, x: number, y: number, h = 12, width?: number): OcrWord {
  return { text, x, y, w: width ?? Math.max(24, text.length * 7), h };
}

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
    w(name, cx - 70, cy - 52, 15),
    w(price, cx - 18, cy, 36, 72),
  ];
  if (args.pack) out.push(w(args.pack, cx - 70, cy - 34, 11));
  if (args.standard) out.push(w(args.standard, cx - 24, cy + 44, 11, 80));
  if (args.unit) out.push(w(args.unit, cx - 70, cy + 60, 10, 110));
  for (const [t, dx, dy, h] of args.extra ?? []) out.push(w(t, cx + dx, cy + dy, h ?? 11));
  return out;
}

const words: OcrWord[] = [
  w("BILLA", 40, 20, 18),
  w("5. 8. – 11. 8. 2026", 200, 22, 11),
  ...offerBlock({
    cx: 120, cy: 180, name: "Maliny", price: "34,90", pack: "125 g",
    standard: "49,90/", unit: "100 g = 27,92",
  }),
  ...offerBlock({
    cx: 340, cy: 180, name: "Meloun vodní", price: "11,90",
    standard: "19,90/", unit: "cena za 1 kg", extra: [["cenazatkg", -70, 76, 10]],
  }),
  ...offerBlock({
    cx: 560, cy: 180, name: "Losos filet", price: "28,90",
    standard: "49,90/", unit: "cena za 100 g",
  }),
  ...offerBlock({
    cx: 780, cy: 180, name: "Vocílka Premium kuře", price: "89,90",
    standard: "159,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 120, cy: 430, name: "Vepřová panenka", price: "149,90",
    standard: "259,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 340, cy: 430, name: "Häagen-Dazs", price: "79,90", pack: "460 ml",
    standard: "194,90/", unit: "100 ml = 17,37",
  }),
  ...offerBlock({
    cx: 560, cy: 430, name: "Tullamore D.E.W.", price: "299,90", pack: "0.7 l",
    extra: [["NAŠE CENA", -20, -70, 10]],
  }),
  ...offerBlock({
    cx: 780, cy: 430, name: "Vepřová krkovice bez kosti", price: "79,90",
    standard: "198,90/", unit: "cena za 1 kg",
  }),
  ...offerBlock({
    cx: 120, cy: 680, name: "Vejce podestýlková M", price: "29,90", pack: "10 ks",
    extra: [
      ["BILLA klub", -70, -70, 12],
      ["běžná cena 49,90", -40, 44, 11],
    ],
  }),
  ...offerBlock({
    cx: 340, cy: 680, name: "Banán", price: "22,90", pack: "1 kg",
    standard: "39,90/",
  }),
  ...offerBlock({
    cx: 560, cy: 680, name: "Hovězí hamburger", price: "99,90",
    extra: [["Hamburgerové bulky", -70, -34, 12], ["cena za KOMBO", -20, 48, 10]],
  }),
  ...offerBlock({
    cx: 780, cy: 680, name: "Rajčata masitá", price: "49,90", pack: "1 kg",
    standard: "69,90/",
  }),
  ...offerBlock({
    cx: 120, cy: 930, name: "Pilsner Urquell", price: "25,90", pack: "0.5 l",
    unit: "1 l = 51,80", extra: [["NAŠE CENA", -20, -70, 10]],
  }),
  ...offerBlock({
    cx: 340, cy: 930, name: "Bohemia Sekt", price: "99,90", pack: "0.75 l",
    extra: [
      ["BILLA klub", -70, -70, 12],
      ["běžná cena 179,90", -40, 44, 11],
      ["PO ZBYTEK TÝDNE 109,90", -80, 62, 11],
    ],
  }),
  w("VÍCE VÍKENDOVÝCH SLEV UVNITŘ", 560, 1180, 12, 220),
  w("109,90", 800, 1182, 12, 50),
  w("běžná", 900, 400, 11),
  w("30,30", 900, 418, 11),
];

const { offers } = runOcrPipeline(words, 1, { store_id: "billa" });
const named = offers.filter((o) => o.extracted_name);
const names = named.map((o) => String(o.extracted_name));
const byPrice = (n: number) => named.filter((o) => Math.abs(Number(o.price_total) - n) < 0.02);

function hasName(rx: RegExp) {
  return names.some((n) => rx.test(n));
}

assert.ok(offers.every((o) => o.store_id === "billa"), "store_id z letáku");
assert.ok(offers.every((o) => o.category === null), "category se nedomýšlí");
assert.ok(
  !names.some((n) => /^(?:běžná|cenazatkg|víkendových|hamburgerové|urquell)$/i.test(n)),
  `názvy nesmí být útržky: ${names.join(" | ")}`
);
assert.equal(byPrice(17.37).length, 0, "17,37 je jednotková cena Häagen-Dazs, ne price_total");
assert.equal(byPrice(27.92).length, 0, "27,92 je 100 g = , ne hlavní cena");
assert.equal(byPrice(7.13).length, 0, "nesmí vzniknout smyšlená jednotková kotva");
assert.equal(byPrice(30.3).length, 0, "30,30 u běžná není produkt");
assert.equal(byPrice(109.9).length, 0, "109,90 je po zbytek týdne, ne produkt");

assert.ok(hasName(/Maliny/i), `chybí Maliny v ${names.join(" | ")}`);
assert.ok(hasName(/Meloun/i), "chybí Meloun");
assert.ok(hasName(/Losos/i), "chybí Losos");
assert.ok(hasName(/kuře|Kuře|Vocílka/i), "chybí kuře");
assert.ok(hasName(/panenka/i), "chybí panenka");
assert.ok(hasName(/H[äa]agen|Dazs/i), "chybí Häagen-Dazs");
assert.ok(hasName(/Tullamore/i), "chybí Tullamore");
assert.ok(hasName(/krkovice/i), "chybí krkovice");
assert.ok(hasName(/Vejce/i), "chybí vejce");
assert.ok(hasName(/Banán/i), "chybí banán");
assert.ok(hasName(/hamburger/i), "chybí hamburger");
assert.ok(hasName(/Rajčata/i), "chybí rajčata");
assert.ok(hasName(/Pilsner|Urquell/i) && !names.some((n) => /^Urquell$/i.test(n)), "Pilsner Urquell, ne samotné Urquell");
assert.ok(hasName(/Bohemia|Sekt/i), "chybí Bohemia Sekt");

const haagen = byPrice(79.9)[0];
assert.ok(haagen, "Häagen-Dazs hlavní cena 79,90");
assert.equal(haagen.typical_price_per_unit, 17.37);
assert.equal(haagen.price_standard, 194.9);

const maliny = byPrice(34.9)[0];
assert.ok(maliny, "Maliny 34,90");
assert.equal(maliny.pack_unit_qty, 125);
assert.equal(maliny.typical_price_per_unit, 27.92);

const urquell = byPrice(25.9)[0];
assert.ok(urquell, "Pilsner Urquell 25,90 (ne 19,90)");
assert.ok(/Pilsner|Urquell/i.test(String(urquell.extracted_name)));

const combo = byPrice(99.9).find((o) => /hamburger|Bohemia|Sekt/i.test(String(o.extracted_name)));
assert.ok(combo, "99,90 musí být hamburger kombo nebo Bohemia Sekt, ne 99,30");

assert.ok(
  named.length >= 10,
  `očekávám aspoň 10 pojmenovaných nabídek, mám ${named.length}: ${names.join(" | ")}`
);

console.log(`OK: offer-raw extractor — ${named.length} produktů: ${names.join("; ")}`);
