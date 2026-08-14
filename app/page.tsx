import Link from "next/link";
import Image from "next/image";
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

function getDiscountPercent(price: number | null, regularPrice: number | null) {
  if (price == null || regularPrice == null || regularPrice <= price || regularPrice <= 0) {
    return null;
  }

  return Math.round(((regularPrice - price) / regularPrice) * 100);
}

export default async function SetrikHomePage() {
  const data = await getSetrikPublicOffers(120);
  const offers = data.offers;
  const topDiscountOffers = [...offers]
    .sort((a, b) => {
      const discountA = getDiscountPercent(a.price, a.regular_price) ?? 0;
      const discountB = getDiscountPercent(b.price, b.regular_price) ?? 0;
      return discountB - discountA;
    })
    .slice(0, 15);

  return (
    <main className="min-h-screen bg-[#f5f8ff] text-slate-950">
      <section className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 rounded-3xl border border-white/80 bg-white/90 px-5 py-4 shadow-sm backdrop-blur">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-xl font-black text-white shadow-sm">
              Š
            </span>
            <span>
              <span className="block text-xl font-black tracking-tight text-slate-950">šetřík</span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                slevy z letáků
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-3 text-sm font-semibold text-slate-600 md:flex">
            <a href="#nejvetsi-slevy" className="hover:text-blue-700">Největší slevy</a>
            <Link href="/review" className="hover:text-blue-700">Nahrát leták</Link>
          </div>
        </header>

        <section className="mt-6 overflow-hidden rounded-[2rem] border border-blue-100 bg-white shadow-sm">
          <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:p-10">
            <div>
              <p className="inline-flex rounded-full bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 ring-1 ring-blue-100">
                Setřík hlídá akce za tebe
              </p>
              <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight text-slate-950 sm:text-6xl">
                Nejlepší slevy z českých letáků na jednom místě
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
                Přehledná homepage pro veřejný Setřík. Níže najdeš sekci s 15 produkty s největší slevou dnes.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href="#nejvetsi-slevy"
                  className="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                >
                  Zobrazit největší slevy
                </a>
                <Link
                  href="/review"
                  className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-slate-50"
                >
                  Nahrát / zkontrolovat PDF
                </Link>
              </div>
            </div>

            <div className="rounded-[2rem] bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white shadow-lg">
              <div className="rounded-[1.5rem] bg-white/12 p-5 ring-1 ring-white/25">
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-100">Dnes v akci</p>
                <p className="mt-3 text-5xl font-black">{topDiscountOffers.length}</p>
                <p className="mt-2 text-blue-50">produktů v sekci Největší slevy dnes</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-2xl bg-white/12 p-4 ring-1 ring-white/20">
                  <p className="text-blue-100">Nabídek celkem</p>
                  <p className="mt-1 text-2xl font-black">{data.total}</p>
                </div>
                <div className="rounded-2xl bg-white/12 p-4 ring-1 ring-white/20">
                  <p className="text-blue-100">Zdroj</p>
                  <p className="mt-1 truncate text-base font-black">{data.source_table ?? "nenakonfigurováno"}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {!data.configured ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
            {data.message}
          </div>
        ) : null}

        {offers.length === 0 ? (
          <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 text-center text-slate-600 shadow-sm">
            Zatím nejsou dostupné žádné nabídky. Nahraj leták přes <Link href="/review" className="font-semibold text-blue-700 underline">/review</Link>.
          </div>
        ) : (
          <section id="nejvetsi-slevy" className="mt-8">
            <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.22em] text-blue-600">Největší slevy dnes</p>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                  15 produktů s nejvyšší slevou
                </h2>
              </div>
              <p className="text-sm font-medium text-slate-500">
                Seřazeno podle procentuální slevy z původní ceny.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {topDiscountOffers.map((offer) => {
                const validFrom = formatDate(offer.valid_from);
                const validTo = formatDate(offer.valid_to);
                const discountPercent = getDiscountPercent(offer.price, offer.regular_price);

                return (
                  <article
                    key={`${offer.source}-${offer.id}`}
                    className="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                  >
                    <div className="relative flex h-40 items-center justify-center bg-slate-100">
                      {discountPercent ? (
                        <span className="absolute left-3 top-3 rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white shadow-sm">
                          -{discountPercent} %
                        </span>
                      ) : null}
                      {offer.image_url ? (
                        <Image
                          src={offer.image_url}
                          alt=""
                          width={320}
                          height={320}
                          unoptimized
                          className="h-full w-full object-contain p-3 transition group-hover:scale-105"
                        />
                      ) : (
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200">
                          Bez obrázku
                        </span>
                      )}
                    </div>
                    <div className="space-y-3 p-4">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                          {offer.store ?? "Obchod"}
                        </p>
                        <h3 className="mt-1 line-clamp-2 min-h-[3.25rem] text-base font-black leading-6 text-slate-950">
                          {offer.name}
                        </h3>
                      </div>
                      <div>
                        <p className="text-2xl font-black text-slate-950">
                          {formatPrice(offer.price, offer.currency)}
                        </p>
                        {offer.regular_price != null ? (
                          <p className="text-sm text-slate-400 line-through">
                            {formatPrice(offer.regular_price, offer.currency)}
                          </p>
                        ) : null}
                      </div>
                      {offer.loyalty_price != null ? (
                        <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">
                          klub {formatPrice(offer.loyalty_price, offer.currency)}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
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
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
