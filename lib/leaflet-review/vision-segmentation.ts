type VisionBlock = {
  block_id: string;
  bbox: { x: number; y: number; width: number; height: number };
  product_name: string | null;
  brand: string | null;
  price_sale: number | null;
  price_standard: number | null;
  price_loyalty: number | null;
  price_without_loyalty: number | null;
  pack_text: string | null;
  evidence_text: string | null;
  confidence: number;
};

export type VisionPageSegmentation = {
  page_no: number;
  coordinate_system: "normalized_0_1000_top_left";
  blocks: VisionBlock[];
  model: string;
};

function extractResponseText(payload: any): string | null {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") return part.text;
    }
  }
  return null;
}

function stripFence(raw: string) {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function validateSegmentation(value: unknown, pageNo: number, model: string): VisionPageSegmentation {
  if (!value || typeof value !== "object") throw new Error("Vision segmentation nevrátil objekt.");
  const obj = value as Record<string, unknown>;
  if (Number(obj.page_no) !== pageNo) throw new Error(`Vision vrátil jinou stránku (${String(obj.page_no)} místo ${pageNo}).`);
  if (!Array.isArray(obj.blocks)) throw new Error("Vision segmentation neobsahuje blocks[].");
  const blocks: VisionBlock[] = obj.blocks.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Block ${index + 1} není objekt.`);
    const b = raw as Record<string, any>;
    const bb = b.bbox as Record<string, unknown> | undefined;
    const x = Number(bb?.x), y = Number(bb?.y), width = Number(bb?.width), height = Number(bb?.height);
    if (![x,y,width,height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1000.5 || y + height > 1000.5) {
      throw new Error(`Block ${index + 1} má neplatný bbox.`);
    }
    const numberOrNull = (v: unknown) => v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null;
    const textOrNull = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
    return {
      block_id: textOrNull(b.block_id) ?? `b${index + 1}`,
      bbox: { x, y, width, height },
      product_name: textOrNull(b.product_name),
      brand: textOrNull(b.brand),
      price_sale: numberOrNull(b.price_sale),
      price_standard: numberOrNull(b.price_standard),
      price_loyalty: numberOrNull(b.price_loyalty),
      price_without_loyalty: numberOrNull(b.price_without_loyalty),
      pack_text: textOrNull(b.pack_text),
      evidence_text: textOrNull(b.evidence_text),
      confidence: Math.max(0, Math.min(1, Number.isFinite(Number(b.confidence)) ? Number(b.confidence) : 0)),
    };
  });
  return { page_no: pageNo, coordinate_system: "normalized_0_1000_top_left", blocks, model };
}

export async function segmentPdfPageVisually(args: { bytes: Uint8Array; filename: string; pageNo: number }): Promise<VisionPageSegmentation> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí OPENAI_API_KEY pro vizuální segmentaci.");
  const base = (process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.OPENAI_VISION_MODEL?.trim() || "gpt-4o-mini";

  const form = new FormData();
  form.set("purpose", "user_data");
  form.set("file", new Blob([args.bytes.slice()], { type: "application/pdf" }), args.filename || "leaflet.pdf");
  const upload = await fetch(`${base}/files`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form });
  const uploadText = await upload.text();
  if (!upload.ok) throw new Error(`OpenAI PDF upload HTTP ${upload.status}: ${uploadText.slice(0,800)}`);
  let fileId = "";
  try { fileId = String(JSON.parse(uploadText)?.id || ""); } catch {}
  if (!fileId) throw new Error("OpenAI PDF upload nevrátil file id.");

  try {
    const prompt = [
      `Analyzuj VÝHRADNĚ stránku ${args.pageNo} přiloženého akčního letáku.`,
      "Nezačínej od cen. Nejprve podle vizuálního layoutu odděl jednotlivé produktové nabídky/karty/bloky.",
      "Jeden block smí reprezentovat právě jeden prodávaný produkt nebo jednu společnou nabídku, pokud je v grafice zjevně jedna karta.",
      "Nesměšuj text, cenu ani balení ze sousedního produktu. Pokud hranici nelze bezpečně určit, dej nižší confidence, ale blok nerozšiřuj přes sousední kartu.",
      "Bounding box vrať v souřadnicích 0..1000, počátek vlevo nahoře, vůči CELÉ JEDNÉ stránce (ne dvojstraně).",
      "U produktu vyplň pouze to, co je uvnitř jeho vizuálního bloku. Nic nedohaduj.",
      "Vrať pouze JSON bez markdownu přesně ve tvaru:",
      '{"page_no":1,"blocks":[{"block_id":"b1","bbox":{"x":0,"y":0,"width":100,"height":100},"product_name":null,"brand":null,"price_sale":null,"price_standard":null,"price_loyalty":null,"price_without_loyalty":null,"pack_text":null,"evidence_text":null,"confidence":0.0}]}',
      `V JSON musí být page_no=${args.pageNo}.`,
    ].join("\n");

    const body = {
      model,
      temperature: 0,
      max_output_tokens: 12000,
      input: [{
        role: "user",
        content: [
          { type: "input_file", file_id: fileId },
          { type: "input_text", text: prompt },
        ],
      }],
    };
    const response = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`OpenAI Responses HTTP ${response.status}: ${responseText.slice(0,1200)}`);
    let payload: any;
    try { payload = JSON.parse(responseText); } catch { throw new Error("OpenAI Responses nevrátil JSON envelope."); }
    const raw = extractResponseText(payload);
    if (!raw) throw new Error("OpenAI Responses nevrátil textový výstup.");
    let parsed: unknown;
    try { parsed = JSON.parse(stripFence(raw)); } catch { throw new Error(`Vision segmentation nevrátil validní JSON: ${raw.slice(0,1000)}`); }
    return validateSegmentation(parsed, args.pageNo, model);
  } finally {
    try { await fetch(`${base}/files/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }); } catch {}
  }
}
