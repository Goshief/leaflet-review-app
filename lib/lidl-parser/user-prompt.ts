export type LidlPageVisionMetadata = {
  page_no?: number | null;
  source_url?: string | null;
  locale?: "cs-CZ";
};

export function buildUserPromptForLidlPage(
  meta: LidlPageVisionMetadata
): string {
  const parts: string[] = [
    "Vstup: jedna stránka letáku Lidl Česká republika (obrázek níže).",
    "Obchod: Lidl CZ.",
  ];
  if (meta.page_no != null && meta.page_no !== undefined) {
    parts.push(`Metadata: page_no = ${meta.page_no}.`);
  } else {
    parts.push("Metadata: page_no není zadáno (v JSON vrať page_no: null).");
  }
  if (meta.source_url) {
    parts.push(`Metadata: source_url = ${meta.source_url}.`);
  }
  parts.push(
    "Postupuj podle systémových pravidel. Vrať pouze JSON pole — zahrň každý viditelný samostatný produktový blok na stránce (jeden objekt na jeden blok)."
  );
  return parts.join("\n");
}
