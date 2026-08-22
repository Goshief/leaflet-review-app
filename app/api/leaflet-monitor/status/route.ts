import { NextResponse } from "next/server";
import { requireOperatorApi } from "@/lib/auth/guards";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { emptyLearningState, type RetailerLearningState } from "@/lib/leaflet-monitor/learning";
import { RETAILERS } from "@/lib/leaflet-monitor/retailers";

export const runtime = "nodejs";

const BUCKET = "leaflet-intake";
const MS_DAY = 86_400_000;
const DEFAULT_DAYS=[1,4];

async function readJson<T>(supabase: any, path: string): Promise<T | null> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  try { return JSON.parse(await data.text()) as T; } catch { return null; }
}

function weekdayPrague(date: Date): number {
  const text = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Prague", weekday: "short" }).format(date);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(text);
}

function nextFutureCheck(now: Date, weekdays: number[]): Date {
  const wanted = weekdays.length ? weekdays : DEFAULT_DAYS;
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(now.getTime() + offset * MS_DAY);
    candidate.setUTCHours(7, 13, 0, 0);
    if (candidate.getTime() <= now.getTime()) continue;
    if (wanted.includes(weekdayPrague(candidate))) return candidate;
  }
  return new Date(now.getTime() + MS_DAY);
}

async function writeLearning(supabase:any,state:RetailerLearningState){
  await supabase.storage.from(BUCKET).upload(
    `_learning/${state.retailer}.json`,
    new Blob([JSON.stringify(state,null,2)],{type:"application/json"}),
    {contentType:"application/json",upsert:true},
  );
}

function pdfHash(name:string){
  return name.match(/__([a-f0-9]{16})\.pdf$/i)?.[1]?.toLowerCase()
    ?? name.match(/remote-([a-f0-9]{16})\.pdf$/i)?.[1]?.toLowerCase()
    ?? null;
}

function repairedLearningFromDocuments(state:RetailerLearningState,docs:any[]):RetailerLearningState{
  const firstByHash=new Map<string,Date>();
  for(const d of docs){
    const hash=pdfHash(String(d?.filename??""));
    if(!hash||firstByHash.has(hash))continue;
    const created=new Date(String(d?.created_at??""));
    if(Number.isFinite(created.getTime()))firstByHash.set(hash,created);
  }
  const hits=[0,0,0,0,0,0,0];
  const dates=[...firstByHash.values()].sort((a,b)=>a.getTime()-b.getTime());
  for(const date of dates){const day=weekdayPrague(date);if(day>=0)hits[day]=(hits[day]??0)+1;}
  const total=hits.reduce((a,b)=>a+b,0);
  const ranked=hits.map((score,day)=>({score,day})).sort((a,b)=>b.score-a.score||a.day-b.day);
  const preferred=total>=2?ranked.filter(x=>x.score>0).slice(0,2).map(x=>x.day):DEFAULT_DAYS;
  const best=ranked[0]?.score??0;
  const confidence=total===0?0:Math.min(1,best/Math.max(2,total));
  const lastDownloaded=dates.length?dates[dates.length-1]!.toISOString():null;
  return {
    ...state,
    weekday_download_hits:hits,
    preferred_weekdays:preferred,
    confidence,
    last_downloaded_at:lastDownloaded,
    next_check_at:nextFutureCheck(new Date(),preferred).toISOString(),
    updated_at:new Date().toISOString(),
  };
}

export async function GET() {
  const gate = await requireOperatorApi();
  if (!gate.ok) return gate.response;
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase není nakonfigurovaný." }, { status: 503 });

  const rows: any[] = [];
  let storageDegraded = false;

  for (const retailer of RETAILERS) {
    const rawLearning = await readJson<RetailerLearningState>(supabase, `_learning/${retailer.id}.json`) ?? emptyLearningState(retailer.id);

    const listResult = await supabase.storage.from(BUCKET).list(retailer.id, {
      limit: 100,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (listResult.error) storageDegraded = true;
    const files = listResult.data ?? [];
    const pdfs = files.filter((x: any) => x.name?.toLowerCase().endsWith(".pdf"));
    const states = files.filter((x: any) => x.name?.endsWith(".ai-state.json"));

    const {data:docs,error:docsError}=await supabase.from("leaflet_documents")
      .select("filename,storage_path,created_at,page_count,processed_pages,candidate_count,processing_status")
      .eq("retailer_id",retailer.id)
      .order("created_at",{ascending:true});
    if(docsError) storageDegraded=true;

    const learning=repairedLearningFromDocuments(rawLearning,docs??[]);
    const changed=JSON.stringify({h:rawLearning.weekday_download_hits,p:rawLearning.preferred_weekdays,l:rawLearning.last_downloaded_at,n:rawLearning.next_check_at})!==JSON.stringify({h:learning.weekday_download_hits,p:learning.preferred_weekdays,l:learning.last_downloaded_at,n:learning.next_check_at});
    if(changed)await writeLearning(supabase,learning);

    const canonicalByHash=new Map<string,string>();
    for(const d of docs??[]){const name=String((d as any).filename??"");const hash=pdfHash(name);if(hash&&!canonicalByHash.has(hash))canonicalByHash.set(hash,name);}
    const uniquePdfs:Array<{name:string}>=[];
    const seen=new Set<string>();
    for(const p of pdfs){
      const name=String((p as any).name??"");
      const hash=pdfHash(name);
      const key=hash?`sha:${hash}`:`name:${name.toLowerCase()}`;
      if(seen.has(key))continue;
      seen.add(key);
      uniquePdfs.push({name:hash?(canonicalByHash.get(hash)??name):name});
    }

    const uniqueDocuments=new Map<string,any>();
    for(const d of docs??[]){
      const name=String((d as any).filename??"");
      const hash=pdfHash(name);
      const key=hash?`sha:${hash}`:`path:${String((d as any).storage_path??name).toLowerCase()}`;
      if(!uniqueDocuments.has(key))uniqueDocuments.set(key,d);
    }
    const latestDoc=(docs??[]).length?(docs??[])[(docs??[]).length-1]:null;

    let aiState: any = null;
    if (states[0]?.name) aiState = await readJson<any>(supabase, `${retailer.id}/${states[0].name}`);

    const checksResult = await supabase.storage.from(BUCKET).list("_checks", {
      search: `${retailer.id}-`,
      limit: 20,
      sortBy: { column: "created_at", order: "desc" },
    });
    if (checksResult.error) storageDegraded = true;
    const lastCheckName = checksResult.data?.[0]?.name ?? null;
    const lastCheck = lastCheckName ? await readJson<any>(supabase, `_checks/${lastCheckName}`) : null;
    const totalDownloadHits = learning.weekday_download_hits.reduce((sum, value) => sum + Number(value || 0), 0);
    const documentAi = latestDoc ? {
      page_count: latestDoc.page_count ?? null,
      processed_pages: Number(latestDoc.processed_pages ?? 0),
      completed: ["ready_for_review","partially_reviewed","completed"].includes(String(latestDoc.processing_status ?? "")),
      next_page: Number(latestDoc.processed_pages ?? 0) < Number(latestDoc.page_count ?? 0) ? Number(latestDoc.processed_pages ?? 0) + 1 : null,
    } : null;

    rows.push({
      ...retailer,
      pdf_count: Math.max(uniquePdfs.length, uniqueDocuments.size),
      latest_pdf: uniquePdfs[0]?.name ?? null,
      last_check: lastCheck,
      learning: {
        confidence: learning.confidence,
        preferred_weekdays: learning.preferred_weekdays,
        schedule_is_learned: totalDownloadHits >= 2,
        checks_this_week_limit: learning.max_checks_per_week,
        last_check_at: learning.last_check_at,
        last_visit_at: learning.last_visit_at ?? lastCheck?.checked_at ?? null,
        last_visit_url: learning.last_visit_url ?? lastCheck?.visited_url ?? lastCheck?.source_page ?? null,
        last_downloaded_at: learning.last_downloaded_at,
        next_check_at: learning.next_check_at,
        download_hits: learning.weekday_download_hits,
      },
      ai: aiState ? {
        page_count: aiState.page_count ?? null,
        processed_pages: Array.isArray(aiState.processed_pages) ? aiState.processed_pages.length : 0,
        completed: Boolean(aiState.completed),
        next_page: aiState.next_page ?? null,
      } : documentAi,
    });
  }

  return NextResponse.json({
    ok: true,
    retailers: rows,
    storage_status: storageDegraded ? "degraded" : "ok",
    warning: storageDegraded ? "Supabase Storage je přetížený; některé stavy nemusí být dostupné." : null,
  });
}
