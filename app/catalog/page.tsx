import { CatalogCollector } from "@/components/catalog/catalog-collector";

export default function CatalogPage() {
  return <main className="mx-auto max-w-5xl"><h1 className="text-3xl font-bold text-slate-900">Katalogový sběrač</h1><p className="mt-3 max-w-3xl text-slate-600">Klonuje produktovou stránku, vytáhne strukturovaná data a stáhne originální produktový obrázek do našeho Storage. Každý běh ukládá neměnný snapshot pro audit a pozdější historii cen.</p><div className="mt-8"><CatalogCollector /></div></main>;
}
