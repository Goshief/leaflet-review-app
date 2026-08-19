import { NextRequest, NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processLeafletPdf } from "@/lib/leaflet-review/processor";

export const runtime = "nodejs";
export const maxDuration = 300;
const DEFAULT_BUCKET = "leaflet-intake";

type ProcessBody = {
  bucket?: string;
  path?: string;
  retailer?: string;
  source_url?: string | null;
  page?: number | null;
  force?: boolean;
};

async function authorize(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.headers.get("authorization");
  if (secret && auth === `Bearer ${secret}`) return null;
  const gate = await requireOperatorApi();
  return gate.ok ? null : gate.response;
}

export async function POST(req: NextRequest) {
  const unauthorized = await authorize(req);
  if (unauthorized) return unauthorized;
  let body: ProcessBody;
  try { body = await req.json() as ProcessBody; }
  catch { return NextResponse.json({ ok:false,error:"Očekávám JSON body." },{status:400}); }
  const path=body.path?.trim();
  const retailer=body.retailer?.trim().toLowerCase();
  const bucket=body.bucket?.trim()||DEFAULT_BUCKET;
  if(!path||!retailer) return NextResponse.json({ok:false,error:"Chybí path nebo retailer."},{status:400});
  if(!path.toLowerCase().endsWith(".pdf")) return NextResponse.json({ok:false,error:"Zpracování přijímá celé PDF."},{status:400});
  if(retailer==="albert") return NextResponse.json({ok:false,error:"Albert je dočasně vyřazen z jednotného workflow a řeší se samostatně."},{status:409});
  const supabase=getSupabaseAdmin();
  if(!supabase) return NextResponse.json({ok:false,error:"Supabase admin není nakonfigurovaný."},{status:503});
  try {
    const result=await processLeafletPdf({supabase,bucket,path,retailer,sourceUrl:body.source_url??null,page:body.page??null,force:Boolean(body.force)});
    return NextResponse.json({ok:true,model:"local-pdf-text-layout-v2",...result});
  } catch(error) {
    console.error("[leaflet-staging] processing failed",error);
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});
  }
}
