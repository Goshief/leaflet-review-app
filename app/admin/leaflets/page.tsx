import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { RunLeafletButton } from "./RunLeafletButton";

export const dynamic = "force-dynamic";

const RETAILERS = [
  ["albert", "Albert"],
  ["billa", "Billa"],
  ["dm", "dm"],
  ["globus", "Globus"],
  ["kaufland", "Kaufland"],
  ["kosik", "Košík"],
  ["lidl", "Lidl"],
  ["penny", "Penny"],
  ["rohlik", "Rohlík"],
  ["rossmann", "Rossmann"],
  ["tesco", "Tesco"],
  ["teta", "Teta"],
] as const;

function fmt(value: string | null | undefined) {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat("cs-CZ", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Prague" }).format(new Date(value)); }
  catch { return value; }
}

function ymdPrague() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default async function LeafletAdminPage() {
  const auth = await createClient();
  const { data: authData } = await auth.auth.getUser();
  if (!authData.user) redirect("/login");

  const supabase = getSupabaseAdmin();
  if (!supabase) throw new Error("Supabase admin není nakonfigurovaný.");

  const [docsRes, intakeRes] = await Promise.all([
    supabase
      .from("leaflet_documents")
      .select("id,retailer_id,filename,source_url,valid_from,valid_to,page_count,cover_storage_path,storage_path,processing_status,created_at,updated_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("leaflet_pdf_intake")
      .select("batch_id,store_id,pdf_source_url,status,error_message,valid_from,valid_to,downloaded_at,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (docsRes.error) throw new Error(docsRes.error.message);
  if (intakeRes.error) throw new Error(intakeRes.error.message);

  const docs = docsRes.data ?? [];
  const intake = intakeRes.data ?? [];
  const today = ymdPrague();

  const rows = RETAILERS.map(([id, name]) => {
    const retailerDocs = docs.filter((row: any) => String(row.retailer_id) === id);
    const activeDocs = retailerDocs.filter((row: any) => row.valid_from && row.valid_to && row.valid_from <= today && row.valid_to >= today);
    const latestDoc = retailerDocs[0] ?? null;
    const latestIntake = intake.find((row: any) => String(row.store_id) === id) ?? null;
    const pageReady = activeDocs.filter((row: any) => Number(row.page_count) > 0).length;
    const coverReady = activeDocs.filter((row: any) => Boolean(row.cover_storage_path)).length;
    const intakeFailed = latestIntake && String(latestIntake.status).includes("failed");
    const status = activeDocs.length > 0 && pageReady === activeDocs.length && coverReady === activeDocs.length
      ? "OK"
      : intakeFailed
        ? "CHYBA"
        : activeDocs.length > 0
          ? "NEÚPLNÉ"
          : "BEZ AKTUÁLNÍHO";
    return { id, name, retailerDocs, activeDocs, latestDoc, latestIntake, pageReady, coverReady, status };
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-700">Administrace letáků</p>
            <h1 className="mt-2 text-3xl font-black">12 obchodů · crawler · PDF · platnost · stránky</h1>
            <p className="mt-2 text-sm text-slate-600">PDF se ukládají do Supabase Storage bucketu <code>leaflet-intake</code>. Originál archivu: <code>leaflets/&lt;obchod&gt;/&lt;rok&gt;/&lt;batch&gt;/original.pdf</code>. Publikační PDF: <code>&lt;obchod&gt;/&lt;obchod&gt;-YYYY-MM-DD__HASH.pdf</code>.</p>
          </div>
          <Link href="/" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold">Zpět</Link>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Obchod</th>
                <th className="px-4 py-3">Stav</th>
                <th className="px-4 py-3">Aktivní</th>
                <th className="px-4 py-3">Stránky</th>
                <th className="px-4 py-3">Cover</th>
                <th className="px-4 py-3">Poslední intake</th>
                <th className="px-4 py-3">Platnost</th>
                <th className="px-4 py-3">Storage</th>
                <th className="px-4 py-3">Akce</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-4 font-black">{row.name}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${row.status === "OK" ? "bg-emerald-100 text-emerald-800" : row.status === "CHYBA" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900"}`}>{row.status}</span>
                    {row.latestIntake?.error_message ? <div className="mt-2 max-w-72 text-xs text-red-700">{row.latestIntake.error_message}</div> : null}
                  </td>
                  <td className="px-4 py-4 font-bold">{row.activeDocs.length}</td>
                  <td className="px-4 py-4">{row.pageReady}/{row.activeDocs.length || 0}</td>
                  <td className="px-4 py-4">{row.coverReady}/{row.activeDocs.length || 0}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{fmt(row.latestIntake?.created_at)}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{row.latestDoc?.valid_from && row.latestDoc?.valid_to ? `${row.latestDoc.valid_from} – ${row.latestDoc.valid_to}` : "—"}</td>
                  <td className="px-4 py-4"><code className="block max-w-72 break-all text-[11px]">{row.latestDoc?.storage_path ?? row.latestIntake?.pdf_source_url ?? "—"}</code></td>
                  <td className="px-4 py-4"><RunLeafletButton retailer={row.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">Co znamená funkční stav</h2>
          <p className="mt-2 text-sm text-slate-600">OK = existuje aktuálně platný dokument, má vyrenderované stránky a první stránku jako cover. CHYBA = poslední intake skončil chybou. NEÚPLNÉ = dokument existuje, ale chybí stránky nebo cover. BEZ AKTUÁLNÍHO = žádný dokument dnes nesplňuje platnost.</p>
        </section>
      </div>
    </main>
  );
}
