export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function htmlToText(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<(?:br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(?:p|div|li|h1|h2|h3|h4|section|article|ul|ol)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/[\t\u00a0 ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function tagText(html: string, tagName: string) {
  const safeTag = tagName.replace(/[^a-z0-9]/gi, "");
  const pattern = new RegExp(`<${safeTag}\\b[^>]*>([\\s\\S]*?)<\\/${safeTag}>`, "i");
  const match = html.match(pattern);
  if (!match) return null;
  const value = htmlToText(match[1] || "").trim();
  return value || null;
}

export function metaContent(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const propertyFirst = new RegExp(`property=["']${escaped}["'][^>]*content=["']([^"']+)["']`, "i");
  const contentFirst = new RegExp(`content=["']([^"']+)["'][^>]*property=["']${escaped}["']`, "i");
  const hit = html.match(propertyFirst) || html.match(contentFirst);
  return hit?.[1] ? decodeHtmlEntities(hit[1]).trim() : null;
}
