import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repo = resolve(process.cwd());
const sourcePath = join(repo, "lib/leaflet-review/extractor.ts");
const typesUrl = pathToFileURL(join(repo, "lib/ocr/types.ts")).href;
const anchorsUrl = pathToFileURL(join(repo, "lib/ocr/price-anchors.ts")).href;
const parseUrl = pathToFileURL(join(repo, "lib/ocr/price-parse.ts")).href;
const dir = await mkdtemp(join(tmpdir(), "leaflet-segmentation-"));

try {
  const source = (await readFile(sourcePath, "utf8"))
    .replace('"@/lib/ocr/types"', JSON.stringify(typesUrl))
    .replace('"@/lib/ocr/price-anchors"', JSON.stringify(anchorsUrl))
    .replace('"@/lib/ocr/price-parse"', JSON.stringify(parseUrl));
  const tempExtractor = join(dir, "extractor.mts");
  await writeFile(tempExtractor, source, "utf8");
  const { extractLeafletCandidates, EXTRACTOR_VERSION } = await import(pathToFileURL(tempExtractor).href);

  const word = (text: string, x: number, y: number, w: number, h: number) => ({ text, x, y, w, h });
  const words = [
    // Product A — Kuře 49,90
    word("Kuře", 55, 74, 34, 12),
    word("cena", 56, 91, 24, 8), word("za", 84, 91, 13, 8), word("1", 101, 91, 6, 8), word("kg", 111, 91, 13, 8),
    word("49,90", 82, 104, 49, 28),
    // Product B — Anglická slanina 39,90; intentionally close to A.
    word("Anglická", 163, 73, 53, 12), word("slanina", 220, 73, 43, 12),
    word("100", 165, 91, 19, 8), word("g", 188, 91, 7, 8),
    word("39,90", 185, 104, 49, 28),
    // Noise close enough that a broad block could accidentally absorb it.
    word("Jihočeský", 274, 76, 58, 11), word("Tvaroh", 336, 76, 39, 11),
  ];

  const rows = extractLeafletCandidates(words, { pageNo: 1, validFrom: "2026-08-19", validTo: "2026-08-25" });
  assert.equal(EXTRACTOR_VERSION, "leaflet-layout-v8", "regression must run against v8");
  assert.equal(rows.length, 2, "two main prices must produce exactly two product blocks");

  const byPrice = new Map(rows.map((r: any) => [r.price_sale, r]));
  const chicken = byPrice.get(49.9);
  const bacon = byPrice.get(39.9);
  assert.ok(chicken, "49.90 block must exist");
  assert.ok(bacon, "39.90 block must exist");

  const chickenText = String(chicken.source_text || "");
  const baconText = String(bacon.source_text || "");
  assert.match(chickenText, /Kuře/i, "Kuře must remain in its own block");
  assert.doesNotMatch(chickenText, /Anglická|slanina|Tvaroh/i, "Kuře block must not absorb neighboring product names");
  assert.match(baconText, /Anglická|slanina/i, "Anglická slanina must remain in its own block");
  assert.doesNotMatch(baconText, /Kuře|Tvaroh/i, "slanina block must not absorb neighboring product names");

  const intersection = new Set(
    String(chicken.source_text || "").split(" | ").filter(Boolean)
      .filter((x: string) => String(bacon.source_text || "").split(" | ").includes(x))
  );
  assert.equal(intersection.size, 0, "neighbor blocks must not share owned text lines");

  console.log(`PASS product block isolation ${EXTRACTOR_VERSION}: 2 adjacent products remain separated with no cross-owned lines`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
