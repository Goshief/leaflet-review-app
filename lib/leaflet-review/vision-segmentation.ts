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
    for (const part of content) if (typeof part?.text === "string") return part.text;
  }
  return null;
}
function extractGeminiText(payload: any): string | null {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts.map((p:any) => typeof p?.text === "string" ? p.text : "").join("").trim();
  return text || null;
}
function stripFence(raw: string) { return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim(); }
function parseVisionJson(raw:string){try{return JSON.parse(stripFence(raw));}catch{throw new Error(`Vision segmentation nevrátil validní JSON: ${raw.slice(0,1000)}`);}}

function validateSegmentation(value: unknown, pageNo: number, model: string): VisionPageSegmentation {
  if (!value || typeof value !== "object") throw new Error("Vision segmentation nevrátil objekt.");
  const obj = value as Record<string, unknown>;
  if (Number(obj.page_no) !== pageNo) throw new Error(`Vision vrátil jinou stránku (${String(obj.page_no)} místo ${pageNo}).`);
  if (!Array.isArray(obj.blocks)) throw new Error("Vision segmentation neobsahuje blocks[].");
  const blocks: VisionBlock[] = obj.blocks.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Block ${index + 1} není objekt.`);
    const b = raw as Record<string, any>; const bb = b.bbox as Record<string, unknown> | undefined;
    const x=Number(bb?.x),y=Number(bb?.y),width=Number(bb?.width),height=Number(bb?.height);
    if(![x,y,width,height].every(Number.isFinite)||x<0||y<0||width<=0||height<=0||x+width>1000.5||y+height>1000.5)throw new Error(`Block ${index+1} má neplatný bbox.`);
    const numberOrNull=(v:unknown)=>v==null?null:Number.isFinite(Number(v))?Number(v):null;
    const textOrNull=(v:unknown)=>typeof v==="string"&&v.trim()?v.trim():null;
    return{block_id:textOrNull(b.block_id)??`b${index+1}`,bbox:{x,y,width,height},product_name:textOrNull(b.product_name),brand:textOrNull(b.brand),price_sale:numberOrNull(b.price_sale),price_standard:numberOrNull(b.price_standard),price_loyalty:numberOrNull(b.price_loyalty),price_without_loyalty:numberOrNull(b.price_without_loyalty),pack_text:textOrNull(b.pack_text),evidence_text:textOrNull(b.evidence_text),confidence:Math.max(0,Math.min(1,Number.isFinite(Number(b.confidence))?Number(b.confidence):0))};
  });
  return { page_no: pageNo, coordinate_system: "normalized_0_1000_top_left", blocks, model };
}

function buildPrompt(pageNo:number){return[
  `Analyzuj VÝHRADNĚ stránku ${pageNo} přiloženého akčního letáku.`,
  "Nezačínej od cen. Nejprve podle vizuálního layoutu odděl jednotlivé produktové nabídky/karty/bloky.",
  "Jeden block smí reprezentovat právě jeden prodávaný produkt nebo jednu společnou nabídku, pokud je v grafice zjevně jedna karta.",
  "Nesměšuj text, cenu ani balení ze sousedního produktu. Pokud hranici nelze bezpečně určit, dej nižší confidence, ale blok nerozšiřuj přes sousední kartu.",
  "Bounding box vrať v souřadnicích 0..1000, počátek vlevo nahoře, vůči CELÉ JEDNÉ stránce (ne dvojstraně).",
  "U produktu vyplň pouze to, co je uvnitř jeho vizuálního bloku. Nic nedohaduj.",
  "Vrať pouze JSON bez markdownu přesně ve tvaru:",
  '{"page_no":1,"blocks":[{"block_id":"b1","bbox":{"x":0,"y":0,"width":100,"height":100},"product_name":null,"brand":null,"price_sale":null,"price_standard":null,"price_loyalty":null,"price_without_loyalty":null,"pack_text":null,"evidence_text":null,"confidence":0.0}]}',
  `V JSON musí být page_no=${pageNo}.`,
].join("\n");}

async function segmentWithGemini(args:{bytes:Uint8Array;pageNo:number;prompt:string}){
  const key=process.env.GEMINI_API_KEY?.trim();if(!key)throw new Error("Gemini fallback není nakonfigurovaný.");
  const model=process.env.GEMINI_MODEL?.trim()||"gemini-2.0-flash";
  const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body={contents:[{role:"user",parts:[{inline_data:{mime_type:"application/pdf",data:Buffer.from(args.bytes).toString("base64")}},{text:args.prompt}]}],generation_config:{temperature:0,max_output_tokens:12000,response_mime_type:"application/json"}};
  let res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});let raw=await res.text();
  if(res.status===429){await new Promise(r=>setTimeout(r,4000));res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});raw=await res.text();}
  if(!res.ok)throw new Error(`Gemini PDF segmentation HTTP ${res.status}: ${raw.slice(0,1200)}`);
  let envelope:any;try{envelope=JSON.parse(raw);}catch{throw new Error("Gemini PDF segmentation nevrátil JSON envelope.");}
  const text=extractGeminiText(envelope);if(!text)throw new Error("Gemini PDF segmentation nevrátil textový výstup.");
  return validateSegmentation(parseVisionJson(text),args.pageNo,`google/${model}`);
}

async function segmentWithOpenAi(args:{bytes:Uint8Array;filename:string;pageNo:number;prompt:string}){
  const apiKey=process.env.OPENAI_API_KEY?.trim();if(!apiKey)throw new Error("OpenAI není nakonfigurovaný.");
  const base=(process.env.OPENAI_BASE_URL?.trim()||"https://api.openai.com/v1").replace(/\/$/,"");const model=process.env.OPENAI_VISION_MODEL?.trim()||"gpt-4o-mini";
  const form=new FormData();form.set("purpose","user_data");form.set("file",new Blob([args.bytes.slice()],{type:"application/pdf"}),args.filename||"leaflet.pdf");
  const upload=await fetch(`${base}/files`,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`},body:form});const uploadText=await upload.text();if(!upload.ok)throw new Error(`OpenAI PDF upload HTTP ${upload.status}: ${uploadText.slice(0,800)}`);
  let fileId="";try{fileId=String(JSON.parse(uploadText)?.id||"");}catch{}if(!fileId)throw new Error("OpenAI PDF upload nevrátil file id.");
  try{
    const response=await fetch(`${base}/responses`,{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,temperature:0,max_output_tokens:12000,input:[{role:"user",content:[{type:"input_file",file_id:fileId},{type:"input_text",text:args.prompt}]}]})});
    const responseText=await response.text();if(!response.ok){const error=new Error(`OpenAI Responses HTTP ${response.status}: ${responseText.slice(0,1200)}`) as Error&{status?:number;body?:string};error.status=response.status;error.body=responseText;throw error;}
    let payload:any;try{payload=JSON.parse(responseText);}catch{throw new Error("OpenAI Responses nevrátil JSON envelope.");}const raw=extractResponseText(payload);if(!raw)throw new Error("OpenAI Responses nevrátil textový výstup.");return validateSegmentation(parseVisionJson(raw),args.pageNo,model);
  }finally{try{await fetch(`${base}/files/${encodeURIComponent(fileId)}`,{method:"DELETE",headers:{Authorization:`Bearer ${apiKey}`}});}catch{}}
}

export async function segmentPdfPageVisually(args:{bytes:Uint8Array;filename:string;pageNo:number}):Promise<VisionPageSegmentation>{
  const prompt=buildPrompt(args.pageNo);const hasOpenAi=!!process.env.OPENAI_API_KEY?.trim();const hasGemini=!!process.env.GEMINI_API_KEY?.trim();
  if(!hasOpenAi&&!hasGemini)throw new Error("Chybí OPENAI_API_KEY i GEMINI_API_KEY pro vizuální segmentaci.");
  if(hasOpenAi){try{return await segmentWithOpenAi({...args,prompt});}catch(error){const e=error as Error&{status?:number;body?:string};const quota=e.status===429||/insufficient_quota|rate.limit|quota|billing/i.test(e.body||e.message);if(!hasGemini||!quota)throw error;}}
  return segmentWithGemini({bytes:args.bytes,pageNo:args.pageNo,prompt});
}
