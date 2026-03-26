import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ImportRow } from "@/lib/data/import-batches";
import { RememberLastBatch } from "@/components/batches/remember-last-batch";
import { BatchItemsTableEditor, type BatchCommittedItem } from "@/components/batches/batch-items-table-editor";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };
type BatchItemRow = {
  id: string;
  import_id: string;
  extracted_name: string | null;
  price_total: number | null;
  currency: string | null;
  pack_qty: number | null;
  pack_unit: string | null;
  pack_unit_qty: number | null;
  price_standard: number | null;
  typical_price_per_unit: number | null;
  price_with_loyalty_card: number | null;
  has_loyalty_card_price: boolean | null;
  notes: string | null;
  brand: string | null;
  category: string | null;
  valid_from: string | null;
  valid_to: string | null;
  created_at: string | null;
  suggested_image_key?: string | null;
  approved_image_key?: string | null;
  image_review_status?: "suggested" | "approved" | "rejected" | "manual_override" | null;
};
type BatchCommittedItemWithSource = BatchCommittedItem;

export default async function BatchDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = getSupabaseAdmin();

  if (!supabase) {
    return (
      <main>
        <p className="text-sm text-amber-800">
          Supabase není nakonfigurovaný — nelze načíst detail dávky.
        </p>
        <Link href="/batches" className="mt-4 inline-block text-indigo-600 hover:underline">
          ← Zpět na seznam
        </Link>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("imports")
    .select("id, source_type, source_url, note, created_at, batch_no")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const b = data as ImportRow;

  const [raw, quarantine] = await Promise.all([
    supabase
      .from("offers_raw")
      .select(
        "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status",
        { count: "exact" }
      )
      .eq("import_id", id)
      .order("created_at", { ascending: false })
      .limit(4000),
    supabase
      .from("offers_quarantine")
      .select(
        "id, import_id, extracted_name, price_total, currency, pack_qty, pack_unit, pack_unit_qty, price_standard, typical_price_per_unit, price_with_loyalty_card, has_loyalty_card_price, notes, brand, category, valid_from, valid_to, created_at, suggested_image_key, approved_image_key, image_review_status",
        { count: "exact" }
      )
      .eq("import_id", id)
      .order("created_at", { ascending: false })
      .limit(4000),
  ]);
  const rawCount = raw.count ?? 0;
  const qCount = quarantine.count ?? 0;
  const rawItems: BatchCommittedItemWithSource[] = ((raw.data ?? []) as BatchItemRow[]).map((row) => ({
    ...row,
    source_table: "offers_raw",
  }));
  const quarantineItems: BatchCommittedItemWithSource[] = ((quarantine.data ?? []) as BatchItemRow[]).map((row) => ({
    ...row,
    source_table: "offers_quarantine",
  }));
  const committedItems = [...rawItems, ...quarantineItems].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
  );

  return (
    <main className="space-y-8">
      <RememberLastBatch importId={id} />
      <div>
        <Link
          href="/batches"
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          ← Letáky
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Import #{b.batch_no} — {b.source_type}
        </h1>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Stav
            </dt>
            <dd className="mt-1 text-lg font-semibold text-slate-900">
              Uloženo
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Vytvořeno
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {new Date(b.created_at).toLocaleString("cs-CZ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Schválené (offers_raw)
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {rawCount}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Karanténa (offers_quarantine)
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {qCount}
            </dd>
          </div>
        </dl>
        {b.note ? (
          <p className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">
            {b.note}
          </p>
        ) : null}
      </div>

      <p className="text-sm text-slate-600">
        Detail importu z tabulky <code className="text-slate-800">imports</code>.
      </p>
      <BatchItemsTableEditor items={committedItems} />
    </main>
  );
}
