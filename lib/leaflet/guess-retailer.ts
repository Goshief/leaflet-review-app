export type RetailerId = "lidl" | "kaufland" | "billa" | "albert" | "penny" | "other";

const LABELS: Record<RetailerId, string> = {
  billa: "BILLA",
  lidl: "Lidl CZ",
  kaufland: "Kaufland",
  penny: "Penny",
  albert: "Albert",
  other: "Obchod",
};

const HINTS: Array<[RegExp, RetailerId]> = [
  [/billa/i, "billa"],
  [/lidl/i, "lidl"],
  [/kaufland/i, "kaufland"],
  [/penny/i, "penny"],
  [/albert/i, "albert"],
];

export function guessRetailerFromFilename(name: string): RetailerId | null {
  for (const [re, id] of HINTS) {
    if (re.test(name)) return id;
  }
  return null;
}

export function retailerLabel(id: string): string {
  return LABELS[id as RetailerId] ?? id;
}
