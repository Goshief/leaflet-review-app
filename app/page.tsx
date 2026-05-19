import Link from "next/link";
import { getSetrikPublicOffers } from "@/lib/setrik/public-offers";

export const revalidate = 30;

function formatPrice(value: number | null, currency: string) {
  if (value == null) return "Cena neuvedena";
  return new Intl.NumberFormat("cs-CZ", {
    style: "currency",
    currency: currency || "CZK",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat("cs-CZ", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export default async function SetrikHomePage() {
  const data = await getSetrikPublicOffers(120);
  const offers = data.offers;

  return (
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                Setík
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-5xl">
                Akční nabídky z letáků
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                Hlavní veřejná aplikace. Data sem tečou z PDF kontroly v části <strong>/review</strong>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/review"
                className="rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Nahrát / zkontrolovat PDF
              </Link>
              <Link
                href="/api/setrik/offers"
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
              >
                API data
              </Link>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-3xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Nabídek</p>
              <p className="mt-1 text-3xl font-bold text-emerald-950">{data.total}</p>
            </div>
            <div className="rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Zdroj</p>
              <p className="mt-1 truncate text-lg font-bold text-slate-950">
                {data.source_table ?? "nenakonfigurováno"}
              </p>
            </div>
            <div className="rounded-3xl bg-indigo-50 p-4 ring-1 ring-indigo-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">Role aplikace</p>
              <p className="mt-1 text-lg font-bold text-indigo-950">veřejný Setík</p>
            </div>
          </div>
        </div>

        {!data.configured ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            {data.message}
          </div>
        ) : null}

        {offers.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">
            Zatím nejsou dostupné žádné nabídky. Nahraj leták přes <Link href="/review" className="font-semibold text-indigo-700 underline">/review</Link>.
          </div>
        ) : (
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {offers.map((offer) => {
              const validFrom = formatDate(offer.valid_from);
              const validTo = formatDate(offer.valid_to);
              return (
                <article
                  key={`${offer.source}-${offer.id}`}
                  className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="flex h-40 items-center justify-center bg-slate-100">
                    {offer.image_url ? (
                      <img
                        src={offer.image_url}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                        Bez obrázku
                      </span>
                    )}
                  </div>
                  <div className="space-y-3 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {offer.store ?? "Obchod"}
                      </p>
                      <h2 className="mt-1 line-clamp-2 min-h-[3.5rem] text-lg font-bold leading-7 text-slate-950">
                        {offer.name}
                      </h2>
                    </div>
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-2xl font-black text-emerald-700">
                          {formatPrice(offer.price, offer.currency)}
                        </p>
                        {offer.regular_price != null ? (
                          <p className="text-sm text-slate-400 line-through">
                            {formatPrice(offer.regular_price, offer.currency)}
                          </p>
                        ) : null}
                      </div>
                      {offer.loyalty_price != null ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                          klub {formatPrice(offer.loyalty_price, offer.currency)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                      {offer.brand ? <span>{offer.brand}</span> : null}
                      {offer.category ? <span>· {offer.category}</span> : null}
                      {offer.unit ? <span>· {offer.unit}</span> : null}
                    </div>
                    {validFrom || validTo ? (
                      <p className="text-xs font-medium text-slate-500">
                        Platí {validFrom ?? "?"} – {validTo ?? "?"}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </section>
    </main>
  );
}
