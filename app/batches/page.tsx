import Link from "next/link";
import { listImportBatches } from "@/lib/data/import-batches";
import { BatchesClient } from "@/components/batches/batches-client";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { BatchItemsTableEditor, type BatchCommittedItem } from "@/components/batches/batch-items-table-editor";

export const dynamic = "force-dynamic";

type AggregatedItemRow = BatchCommittedItem;

export default async function BatchesPage() {
  const result = await listImportBatches();
  let aggregatedItems: AggregatedItemRow[] = [];

  if (result.ok && result.batches.length > 0) {
    const supabase = getSupabaseAdmin();
    const batchIds = result.batches.map((b) => b.id);
    if (supabase && batchIds.length > 0) {
      const [raw, quarantine] = await Promise.all([
        supabase
          .from("offers_raw")
          .select(
            "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status"
          )
          .in("import_id", batchIds)
          .order("import_id", { ascending: false })
          .limit(5000),
        supabase
          .from("offers_quarantine")
          .select(
            "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status"
          )
          .in("import_id", batchIds)
          .order("import_id", { ascending: false })
          .limit(5000),
      ]);
      const rawItems = ((raw.data ?? []) as Omit<AggregatedItemRow, "source_table">[]).map((row) => ({
        ...row,
        source_table: "offers_raw" as const,
      }));
      const quarantineItems = ((quarantine.data ?? []) as Omit<AggregatedItemRow, "source_table">[]).map((row) => ({
        ...row,
        source_table: "offers_quarantine" as const,
      }));
      aggregatedItems = [...rawItems, ...quarantineItems];
    }
  }
  return (
    <main>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Správa letáků
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Provozní seznam dávek (z databáze) + rychlé akce.
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-xl shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-violet-500"
        >
          + Nahrát nový leták
        </Link>
      </div>

      {!result.ok ? (
        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">
            {result.reason === "not_configured"
              ? "Supabase není nakonfigurovaný"
              : "Nepodařilo se načíst dávky"}
          </p>
          <p className="mt-2 text-amber-900/90">{result.message}</p>
          {result.reason === "not_configured" ? (
            <p className="mt-3 text-amber-900/80">
              Zkopíruj proměnné z <code className="rounded bg-amber-100 px-1">.env.example</code>{" "}
              do <code className="rounded bg-amber-100 px-1">.env.local</code> a spusť migraci z{" "}
              <code className="rounded bg-amber-100 px-1">supabase/migrations/</code> v SQL
              editoru projektu.
            </p>
          ) : null}
        </div>
      ) : null}

      {result.ok && result.batches.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center shadow-[0_4px_24px_rgba(15,23,42,0.04)]">
          <p className="text-slate-900 font-semibold">
            Zatím tu nejsou žádné dávky. Nahraj první leták a vytvoř pracovní dávku.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Tip: po kontrole klikni na <strong>„Odeslat schválené do databáze“</strong> — tím vznikne dávka v seznamu.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Link
              href="/upload"
              className="inline-flex items-center justify-center rounded-2xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-indigo-500/20 hover:bg-indigo-700"
            >
              + Nahrát leták
            </Link>
            <Link
              href="/review"
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Otevřít kontrolu →
            </Link>
          </div>
        </div>
      ) : null}

      {result.ok && result.batches.length > 0 ? (
        <>
          <section className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Všechny portované položky napříč dávkami</h2>
              <p className="mt-1 text-sm text-slate-600">
                Jeden velký seznam bez proklikávání dávkami ({aggregatedItems.length} položek). Upravovat můžeš rovnou zde.
              </p>
            </div>
            {aggregatedItems.length === 0 ? (
              <p className="text-sm text-slate-500">Zatím nejsou dostupné žádné portované položky.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                  {result.batches.map((b) => (
                    <span key={b.id} className="rounded-full bg-slate-100 px-2.5 py-1 ring-1 ring-slate-200">
                      Import #{b.batch_no} · {new Date(b.created_at).toLocaleDateString("cs-CZ")} · {b.id}
                    </span>
                  ))}
                </div>
                <BatchItemsTableEditor items={aggregatedItems} />
              </>
            )}
          </section>
          <BatchesClient batches={result.batches} />
        </>
      ) : null}
    </main>
  );
}
