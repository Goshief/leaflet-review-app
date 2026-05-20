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
  return `${v.toFixed(2).replace(".", ",")} Kč`;
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
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 16px", color: "#0f172a" }}>
      <header style={{ marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1, borderRadius: 20, border: "1px solid #d8dfcf", background: "#f4f5ee", padding: 16 }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#173f3a", margin: 0 }}>Ahoj Esterka!</p>
          <p style={{ fontSize: 12, color: "#173f3a", opacity: 0.75, margin: "4px 0 0" }}>Přehled produktů z databáze</p>
        </div>
      </header>

      <section style={{ borderRadius: 24, border: "1px solid #d8dfcf", background: "#f4f5ee", padding: 16, boxShadow: "0 1px 2px rgba(15,23,42,0.08)" }}>
        <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button onClick={() => setOnlyLoyalty((s) => !s)} style={{ borderRadius: 8, padding: "8px 12px", fontSize: 14, border: "1px solid #d8dfcf", background: onlyLoyalty ? "#175a41" : "#fff", color: onlyLoyalty ? "#fff" : "#173f3a" }}>Jen s kartou</button>
          <button onClick={() => setOnlyWithPhoto((s) => !s)} style={{ borderRadius: 8, padding: "8px 12px", fontSize: 14, border: "1px solid #d8dfcf", background: onlyWithPhoto ? "#175a41" : "#fff", color: onlyWithPhoto ? "#fff" : "#173f3a" }}>Jen s fotkou</button>
          <button onClick={() => setOnlyWithOriginalPrice((s) => !s)} style={{ borderRadius: 8, padding: "8px 12px", fontSize: 14, border: "1px solid #d8dfcf", background: onlyWithOriginalPrice ? "#175a41" : "#fff", color: onlyWithOriginalPrice ? "#fff" : "#173f3a" }}>Jen s původní cenou</button>
          <button style={{ borderRadius: 8, padding: "8px 12px", fontSize: 14, border: 0, background: "#175a41", color: "#fff" }}>Použít filtry</button>
          <button
            onClick={() => {
              setOnlyLoyalty(false);
              setOnlyWithPhoto(false);
              setOnlyWithOriginalPrice(false);
            }}
            style={{ borderRadius: 8, padding: "8px 12px", fontSize: 14, border: "1px solid #d8dfcf", background: "#fff", color: "#173f3a" }}
          >
            Reset
          </button>
        </div>

        <p style={{ margin: "0 0 12px", fontSize: 14, color: "#173f3a" }}>
          Zobrazeno {filtered.length} produktů po filtrech z {activeProducts} aktivních načtených položek.
          <br />
          S fotkou: {counts.withPhoto} · se slevou / původní cenou: {counts.withDiscount} · s efektivní cenou s kartou: {counts.withLoyalty}
        </p>
        {dataQuality ? (
          <p style={{ margin: "0 0 16px", borderRadius: 8, border: "1px solid #d8dfcf", background: "#fff", padding: "8px 12px", fontSize: 12, color: "rgba(23,63,58,0.72)" }}>
            Data quality (offers_raw): total {dataQuality.totalRows} · price_standard {dataQuality.withPriceStandard} ·{" "}
            has_loyalty_card_price=true {dataQuality.withLoyaltyFlagTrue} · approved_image_key {dataQuality.withApprovedImageKey}
          </p>
        ) : null}

        {filtered.length === 0 ? (
          <div style={{ borderRadius: 16, background: "#fff", border: "1px solid #d8dfcf", padding: 24, color: "#173f3a" }}>
            Žádné produkty neodpovídají filtrům. Resetni filtry nebo zkontroluj import.
          </div>
        ) : (
          <div
            data-testid="shopper-product-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 14,
              width: "100%",
              minHeight: 1,
              overflow: "visible",
              opacity: 1,
              visibility: "visible",
            }}
          >
            {filtered.map((p, idx) => (
              <article
                key={`${p.id}-${idx}`}
                style={{
                  display: "block",
                  visibility: "visible",
                  opacity: 1,
                  minHeight: 260,
                  borderRadius: 18,
                  border: "1px solid #d3d7cb",
                  background: "#ffffff",
                  padding: 12,
                  boxShadow: "0 1px 3px rgba(15,23,42,0.12)",
                  color: "#103f3a",
                }}
              >
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    style={{ marginBottom: 8, height: 110, width: "100%", borderRadius: 14, objectFit: "cover", background: "#eef2f7", display: "block" }}
                  />
                ) : (
                  <div style={{ marginBottom: 8, height: 110, borderRadius: 14, background: "linear-gradient(135deg,#f6f8ef,#e9efe0)" }} />
                )}

                <div style={{ marginBottom: 8, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, color: "rgba(23,63,58,0.7)" }}>{p.store}{p.validTo ? ` · do ${p.validTo}` : ""}</p>
                    <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 800, lineHeight: 1.2, color: "#103f3a" }}>{p.name}</p>
                    {p.detail ? <p style={{ margin: "4px 0 0", fontSize: 13, color: "rgba(16,63,58,0.8)" }}>{p.detail}</p> : null}
                  </div>
                  {p.badge ? <span style={{ borderRadius: 999, background: "#3f8b45", padding: "4px 8px", fontSize: 12, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>{p.badge}</span> : null}
                </div>

                <div style={{ marginTop: 10 }}>
                  <p style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#123f3a" }}>{czk(p.price)}</p>
                  {p.regularPrice != null && p.regularPrice > p.price ? (
                    <p style={{ margin: "2px 0 0", fontSize: 14, color: "#5f6f6c", textDecoration: "line-through" }}>{czk(p.regularPrice)}</p>
                  ) : null}
                  <p style={{ margin: "6px 0 0", fontSize: 12, color: "rgba(23,63,58,0.65)" }}>
                    {p.hasLoyaltyPrice ? `Cena s kartou: ${czk(p.loyaltyPrice)}` : "Nabídka bez karty"}
                  </p>
                  {p.unitPrice != null ? <p style={{ margin: "3px 0 0", fontSize: 12, color: "rgba(23,63,58,0.65)" }}>Jednotková cena: {czk(p.unitPrice)}</p> : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
