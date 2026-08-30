import { CatalogExcelExportPanel } from "@/components/catalog/excel-export-panel";

export const dynamic = "force-dynamic";

export default function CatalogExcelPage() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Katalog bez Supabase</h1>
        <p className="mt-2 text-slate-600">
          Stáhni produkty do Excelu. Soubor se stáhne v prohlížeči a zároveň se uloží do <code>exports/</code>.
        </p>
      </div>
      <CatalogExcelExportPanel />
    </main>
  );
}
