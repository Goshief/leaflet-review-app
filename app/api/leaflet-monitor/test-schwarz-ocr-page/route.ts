import {NextRequest,NextResponse} from "next/server";
import {requireOperatorApi} from "@/lib/auth/guards";
import {extractWordsFromImageBuffer} from "@/lib/ocr";
import {extractLeafletCandidates} from "@/lib/leaflet-review/extractor";
import sharp from "sharp";
export const runtime="nodejs";export const maxDuration=180;
export async function GET(req:NextRequest){
  const g=await requireOperatorApi();if(!g.ok)return g.response;
  const id=req.nextUrl.searchParams.get("id")||"akcni-letak-od-ctvrtka-20-8-23-8-2026";
  const p=Math.max(1,Number(req.nextUrl.searchParams.get("page")||1));
  const height=Math.max(600,Math.min(2400,Number(req.nextUrl.searchParams.get("height")||1200)));
  const api=new URL("https://endpoints.leaflets.schwarz/v4/flyer");api.searchParams.set("flyer_identifier",id);
  const r=await fetch(api,{headers:{accept:"application/json"},cache:"no-store"});const j=await r.json();
  const pages=j?.flyer?.pages??[];const page=pages.find((x:any)=>Number(x.number)===p);
  if(!page?.image&&!page?.zoom)return NextResponse.json({ok:false,error:"page image missing"},{status:404});
  const imageUrl=String(height>1200?(page.zoom||page.image):(page.image||page.zoom));
  const ir=await fetch(imageUrl,{cache:"no-store"});if(!ir.ok)return NextResponse.json({ok:false,error:`image ${ir.status}`},{status:502});
  const original=Buffer.from(await ir.arrayBuffer());
  const buf=await sharp(original).resize({height,withoutEnlargement:true}).png().toBuffer();
  const started=Date.now();const words=await extractWordsFromImageBuffer(buf);
  const candidates=extractLeafletCandidates(words,{pageNo:p,validFrom:j?.flyer?.offerStartDate??null,validTo:j?.flyer?.offerEndDate??null});
  return NextResponse.json({ok:true,page:p,height,image_url:imageUrl,original_bytes:original.length,image_bytes:buf.length,ocr_ms:Date.now()-started,word_count:words.length,words:words.slice(0,120),candidate_count:candidates.length,candidates:candidates.slice(0,30).map(c=>({name:c.product_name,price:c.price_sale,pack:c.pack_text,status:c.status,confidence:c.confidence,source:c.source_text}))});
}
