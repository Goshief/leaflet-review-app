"use client";

import { useMemo, useState } from "react";
import type { HomepageDataQuality, ShopperHomepageProduct } from "@/lib/shopper/homepage-data";

type Props = {
  products: ShopperHomepageProduct[];
  initialSessionId: string;
  activeProducts: number;
  dataQuality: HomepageDataQuality | null;
};

function czk(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(2).replace('.', ',')} Kč`;
}

export function ShopperHomepage({ products, initialSessionId: _initialSessionId, activeProducts, dataQuality }: Props) {
  const [onlyLoyalty, setOnlyLoyalty] = useState(false);
  const [onlyWithPhoto, setOnlyWithPhoto] = useState(false);
  const [onlyWithOriginalPrice, setOnlyWithOriginalPrice] = useState(false);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (onlyLoyalty && !p.hasLoyaltyPrice) return false;
      if (onlyWithPhoto && !p.imageUrl) return false;
      if (onlyWithOriginalPrice && !(p.regularPrice != null && p.regularPrice > p.price)) return false;
      return true;
    });
  }, [products, onlyLoyalty, onlyWithPhoto, onlyWithOriginalPrice]);

  const counts = useMemo(() => {
    const withPhoto = products.filter((p) => !!p.imageUrl).length;
    const withDiscount = products.filter((p) => p.regularPrice != null && p.regularPrice > p.price).length;
    const withLoyalty = products.filter((p) => p.hasLoyaltyPrice).length;
    return { withPhoto, withDiscount, withLoyalty };
  }, [products]);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="flex-1 rounded-2xl border border-[#d8dfcf] bg-[#f4f5ee] px-4 py-3">
          <p className="text-base font-semibold text-[#173f3a]">Ahoj Esterka!</p>
          <p className="text-xs text-[#173f3ab3]">Přehled produktů z databáze</p>
        </div>
      </header>

      <section className="rounded-3xl border border-[#d8dfcf] bg-[#f4f5ee] p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap gap-2">
          <button onClick={() => setOnlyLoyalty((s) => !s)} className={`rounded-lg px-3 py-1.5 text-sm ${onlyLoyalty ? 'bg-[#175a41] text-white' : 'bg-white text-[#173f3a] border border-[#d8dfcf]'}`}>Jen s kartou</button>
          <button onClick={() => setOnlyWithPhoto((s) => !s)} className={`rounded-lg px-3 py-1.5 text-sm ${onlyWithPhoto ? 'bg-[#175a41] text-white' : 'bg-white text-[#173f3a] border border-[#d8dfcf]'}`}>Jen s fotkou</button>
          <button onClick={() => setOnlyWithOriginalPrice((s) => !s)} className={`rounded-lg px-3 py-1.5 text-sm ${onlyWithOriginalPrice ? 'bg-[#175a41] text-white' : 'bg-white text-[#173f3a] border border-[#d8dfcf]'}`}>Jen s původní cenou</button>
          <button className="rounded-lg bg-[#175a41] px-3 py-1.5 text-sm text-white">Použít filtry</button>
          <button
            onClick={() => {
              setOnlyLoyalty(false);
              setOnlyWithPhoto(false);
              setOnlyWithOriginalPrice(false);
            }}
            className="rounded-lg border border-[#d8dfcf] bg-white px-3 py-1.5 text-sm text-[#173f3a]"
          >
            Reset
          </button>
        </div>

        <p className="mb-3 text-sm text-[#173f3a]">
          Zobrazeno {filtered.length} produktů po filtrech z {activeProducts} aktivních načtených položek.
          <br />
          S fotkou: {counts.withPhoto} · se slevou / původní cenou: {counts.withDiscount} · s efektivní cenou s kartou: {counts.withLoyalty}
        </p>
        {dataQuality ? (
          <p className="mb-3 rounded-lg border border-[#d8dfcf] bg-white px-3 py-2 text-xs text-[#173f3ab8]">
            Data quality (offers_raw): total {dataQuality.totalRows} · price_standard {dataQuality.withPriceStandard} ·
            {" "}has_loyalty_card_price=true {dataQuality.withLoyaltyFlagTrue} · approved_image_key {dataQuality.withApprovedImageKey}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p, idx) => (
            <article key={`${p.id}-${idx}`} className="rounded-2xl border border-[#d3d7cb] bg-white p-3 shadow-sm">
              {p.imageUrl ? (
                <img src={p.imageUrl} alt={p.name} className="mb-2 h-24 w-full rounded-xl object-cover" />
              ) : (
                <div className="mb-2 h-24 rounded-xl bg-gradient-to-br from-[#f6f8ef] to-[#e9efe0]" />
              )}

              <div className="mb-1 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-[#173f3ab3]">{p.store}{p.validTo ? ` · do ${p.validTo}` : ""}</p>
                  <p className="text-base font-semibold leading-tight text-[#103f3a]">{p.name}</p>
                  {p.detail ? <p className="text-sm text-[#103f3acc]">{p.detail}</p> : null}
                </div>
                {p.badge ? <span className="rounded-full bg-[#3f8b45] px-2 py-1 text-xs font-bold text-white">{p.badge}</span> : null}
              </div>

              <div className="mt-2">
                <p className="text-2xl font-semibold text-[#123f3a]">{czk(p.price)}</p>
                {p.regularPrice != null && p.regularPrice > p.price ? (
                  <p className="text-sm text-[#5f6f6c] line-through">{czk(p.regularPrice)}</p>
                ) : null}
                <p className="text-xs text-[#173f3a99]">
                  {p.hasLoyaltyPrice ? `Cena s kartou: ${czk(p.loyaltyPrice)}` : "Nabídka bez karty"}
                </p>
                {p.unitPrice != null ? <p className="text-xs text-[#173f3a99]">Jednotková cena: {czk(p.unitPrice)}</p> : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
