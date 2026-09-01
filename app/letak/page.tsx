"use client";

import { LeafletA4Viewer } from "@/components/leaflet/a4-viewer";
import { useLeafletPreview } from "@/components/leaflet/preview-context";
import { LetakA4Image } from "@/components/letak/letak-a4-image";
import { LetakProductCard, type LetakOfferRow } from "@/components/letak/letak-product-card";
import { EditProductSheet } from "@/components/review/edit-product-sheet";
import { emptyAiChecks } from "@/lib/leaflet/ai-checks";
import { emptyFieldSources, markHumanEdits } from "@/lib/leaflet/field-source";
import { leafletOffersToCsv, leafletOffersToJson } from "@/lib/leaflet/offers-csv";
import { extractPdfPageWords } from "@/lib/pdf/render-page";
import { pdfTextLayerLooksUsable } from "@/lib/pdf/text-words";
import { useCallback, useEffect, useRef, useState } from "react";

type QueueItem = {
  batch_id: string;
  page_id: string;
  page_no: number;
  store_id: string;
  remaining_pages: number;
  remaining_leaflets: number;
  remaining_pages_in_batch: number;
  image_url: string;
  offers: LetakOfferRow[];
};

function sampleLetakOffers(): LetakOfferRow[] {
  const confirmed = emptyAiChecks(null);
  const review = emptyAiChecks(null);
  review.pack_unit = { status: "unresolved", agreement: 0 };
  return [
    {
      store_id: "billa",
      source_type: "leaflet",
      page_no: 1,
      valid_from: "2026-08-05",
      valid_to: "2026-08-11",
      valid_from_text: null,
      valid_to_text: null,
      extracted_name:
        "Bio řecký jogurt bílý 10 % tuku z Valašska s příchutí vanilky a lesního medu — celý název musí zůstat vidět bez ořezu",
      price_total: 34.9,
      currency: "CZK",
      pack_qty: 1,
      pack_unit: "g",
      pack_unit_qty: 150,
      price_standard: 49.9,
      typical_price_per_unit: null,
      price_with_loyalty_card: 29.9,
      has_loyalty_card_price: true,
      notes: "Akce jen tento týden, bez dalšího ořezu textu.",
      brand: "Srdce domova",
      category: null,
      raw_text_block: null,
      review_status: "pending",
      field_sources: emptyFieldSources(),
      ai_checks: confirmed,
    },
    {
      store_id: "lidl",
      source_type: "leaflet",
      page_no: 1,
      valid_from: null,
      valid_to: null,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name: "Máslo 250 g",
      price_total: 39.9,
      currency: "CZK",
      pack_qty: 1,
      pack_unit: "unknown",
      pack_unit_qty: null,
      price_standard: 54.9,
      typical_price_per_unit: null,
      price_with_loyalty_card: null,
      has_loyalty_card_price: false,
      notes: null,
      brand: null,
      category: null,
      raw_text_block: null,
      review_status: "needs_review",
      package_unknown: true,
      field_sources: emptyFieldSources(),
      ai_checks: review,
    },
    {
      store_id: "kaufland",
      source_type: "leaflet",
      page_no: 1,
      valid_from: null,
      valid_to: null,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name: "K-Classic mléko polotučné 1,5 %",
      price_total: 22.9,
      currency: "CZK",
      pack_qty: 1,
      pack_unit: "l",
      pack_unit_qty: 1,
      price_standard: 27.9,
      typical_price_per_unit: null,
      price_with_loyalty_card: 19.9,
      has_loyalty_card_price: true,
      notes: null,
      brand: "K-Classic",
      category: null,
      raw_text_block: null,
      review_status: "pending",
      field_sources: emptyFieldSources(),
      ai_checks: confirmed,
    },
    {
      store_id: "penny",
      source_type: "leaflet",
      page_no: 1,
      valid_from: null,
      valid_to: null,
      valid_from_text: null,
      valid_to_text: null,
      extracted_name: "PENNY vajíčka M 10 ks",
      price_total: 39.9,
      currency: "CZK",
      pack_qty: 10,
      pack_unit: "ks",
      pack_unit_qty: 1,
      price_standard: 49.9,
      typical_price_per_unit: null,
      price_with_loyalty_card: 34.9,
      has_loyalty_card_price: true,
      notes: "Cena s kartou jen v akci.",
      brand: "PENNY",
      category: null,
      raw_text_block: null,
      review_status: "pending",
      field_sources: emptyFieldSources(),
      ai_checks: confirmed,
    },
  ];
}

export default function LetakA4Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const preview = useLeafletPreview();
  const file = preview.kind === "pdf" ? preview.file : null;
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [offers, setOffers] = useState<LetakOfferRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [queueItem, setQueueItem] = useState<QueueItem | null>(null);
  const [queueEmpty, setQueueEmpty] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);

  function applyQueueItem(item: QueueItem | null) {
    setQueueItem(item);
    if (!item) {
      setQueueEmpty(true);
      setOffers([]);
      setPageImageUrl(null);
      return;
    }
    setQueueEmpty(false);
    setPageNo(item.page_no);
    setPageImageUrl(item.image_url);
    setOffers(item.offers || []);
    if (item.store_id) preview.setRetailer(item.store_id as typeof preview.retailer);
  }

  async function loadQueue() {
    setQueueLoading(true);
    const response = await fetch("/api/letak/queue");
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || data?.message || `Queue HTTP ${response.status}`);
    applyQueueItem(data?.item ?? null);
    setQueueEmpty(Boolean(data?.empty || !data?.item));
    setQueueLoading(false);
  }

  async function reviewAction(action: "approve_page" | "approve_offer" | "reject_offer", offerId?: string) {
    if (!queueItem?.page_id) return;
    setBusy(true);
    setError("");
    try {
      const previous = queueItem;
      const response = await fetch("/api/letak/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, page_id: queueItem.page_id, offer_id: offerId, offers }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || data?.message || `Review HTTP ${response.status}`);
      const next = (data?.item ?? null) as QueueItem | null;
      applyQueueItem(next);
      setQueueEmpty(Boolean(data?.empty || !next));
      if (!next) {
        setReading("Hotovo. Není další nezkontrolovaná stránka.");
      } else if (next.page_id === previous.page_id) {
        setReading(action === "reject_offer" ? "Zamítnuto. Strana zůstává ke kontrole." : "Schváleno. Strana zůstává ke kontrole.");
      } else if (next.batch_id !== previous.batch_id) {
        setReading(`Další leták: ${next.store_id}, strana ${next.page_no}.`);
      } else {
        setReading(`Další strana ${next.page_no}.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("sample") === "1") {
      setOffers(sampleLetakOffers());
      setQueueLoading(false);
      return;
    }
    void loadQueue().catch((e) => {
      setQueueLoading(false);
      setError(e instanceof Error ? e.message : String(e));
    });
  }, []);

  const onPageChange = useCallback((nextPage: number, imageUrl: string | null) => {
    setPageNo(nextPage);
    setPageImageUrl(imageUrl);
  }, []);

  async function parseCurrentPage() {
    if (!pageImageUrl) {
      setError("Náhled strany ještě není připravený.");
      return;
    }
    setBusy(true);
    setError("");
    setReading(`AI čte stranu ${pageNo}…`);
    try {
      const blob = await fetch(pageImageUrl).then((res) => res.blob());
      const image = new File([blob], `page-${pageNo}.png`, { type: blob.type || "image/png" });
      const form = new FormData();
      form.set("file", image);
      form.set("page_no", String(pageNo));
      const response = await fetch("/api/parse-lidl-page", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Parser HTTP ${response.status}`);
      }
      const rows = Array.isArray(data?.offers) ? data.offers : [];
      setOffers(
        rows.map((offer: LetakOfferRow) => ({
          ...offer,
          id: offer.id || crypto.randomUUID(),
          store_id: offer.store_id || preview.retailer,
          page_no: typeof offer.page_no === "number" ? offer.page_no : pageNo,
          review_status: offer.review_status ?? "pending",
          field_sources: offer.field_sources ?? emptyFieldSources(),
        })),
      );
      setReading(rows.length ? `Strana ${pageNo}: ${rows.length} produktů.` : `Strana ${pageNo}: parser nenašel produkty.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReading("");
    } finally {
      setBusy(false);
    }
  }

  async function rereadFromImage(scope: "page" | "product", productIndex?: number) {
    if (!pageImageUrl) {
      setError("Náhled strany ještě není připravený. Re-read potřebuje originální obrázek, ne OCR text.");
      return;
    }
    setBusy(true);
    setError("");
    setReading(scope === "page" ? `AI znovu čte celou stranu ${pageNo}…` : "AI znovu čte produkt z originálního obrázku…");
    try {
      const blob = await fetch(pageImageUrl).then((res) => res.blob());
      const image = new File([blob], `page-${pageNo}.png`, { type: blob.type || "image/png" });
      const form = new FormData();
      form.set("file", image);
      form.set("scope", scope);
      form.set("page_no", String(pageNo));
      form.set("store_id", preview.retailer);
      form.set("offers", JSON.stringify(offers));
      if (queueItem?.batch_id) form.set("batch_id", queueItem.batch_id);
      if (queueItem?.page_id) form.set("page_id", queueItem.page_id);
      if (lastRunId) form.set("previous_run_id", lastRunId);
      if (scope === "product" && productIndex != null) {
        form.set("product_index", String(productIndex));
        const bbox = offers[productIndex]?.ai_checks?.bbox;
        if (bbox) form.set("bbox", JSON.stringify(bbox));
      }
      const response = await fetch("/api/letak/reread", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || data?.message || `Re-read HTTP ${response.status}`);
      }
      const rows = Array.isArray(data?.offers) ? data.offers : [];
      if (scope === "product" && productIndex != null && rows[0]) {
        setOffers((prev) => prev.map((row, index) => (index === productIndex ? { ...row, ...rows[0] } : row)));
      } else {
        setOffers(rows);
      }
      if (data?.new_run_id) setLastRunId(String(data.new_run_id));
      setReading(
        scope === "page"
          ? `Strana ${pageNo} znovu přečtena (${rows.length} produktů). Nový parser_run uložen.`
          : "Produkt znovu přečten z originálního obrázku. Lidské opravy zůstaly.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReading("");
    } finally {
      setBusy(false);
    }
  }

  async function readAllPages() {
    if (!file) return;
    setError("");
    try {
      const { numPages: count } = await extractPdfPageWords(file, 1);
      const rows: Array<Record<string, unknown>> = [];
      for (let page = 1; page <= count; page += 1) {
        setReading(`Čtu textovou vrstvu strany ${page}/${count}…`);
        const { words } = await extractPdfPageWords(file, page);
        if (!pdfTextLayerLooksUsable(words)) {
          rows.push({ page_no: page, notes: "strana bez PDF textu", extracted_name: "CHYBA ČTENÍ" });
          continue;
        }
        const response = await fetch("/api/parse-leaflet-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words, page_no: page, store_id: preview.retailer }),
          signal: AbortSignal.timeout(60_000),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          rows.push({ page_no: page, notes: data?.error || `HTTP ${response.status}`, extracted_name: "CHYBA ČTENÍ" });
          continue;
        }
        const pageOffers = Array.isArray(data?.offers) ? data.offers : [];
        if (pageOffers.length === 0) {
          rows.push({ page_no: page, notes: "strana bez produktu", extracted_name: null });
        } else {
          for (const offer of pageOffers) rows.push({ ...offer, page_no: page });
        }
      }
      const base = (file.name || "letak").replace(/\.pdf$/i, "");
      const csv = leafletOffersToCsv(rows);
      const json = leafletOffersToJson(rows);
      for (const [body, type, name] of [
        [csv, "text/csv;charset=utf-8", `${base}-offer-raw.csv`],
        [json, "application/json;charset=utf-8", `${base}-offer-raw.json`],
      ] as const) {
        const blob = new Blob([body], { type });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      }
      setReading(`Hotovo: ${rows.length} řádků z ${count} stran. Excel i JSON (21 polí) jsou ke stažení.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setReading("");
    }
  }

  function patchOffer(index: number, patch: Partial<LetakOfferRow>) {
    setOffers((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <main className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ke kontrole</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Nejnovější leták, první nezkontrolovaná stránka. Nic se neschvaluje samo. Kouknout, případně znovu
            přečíst AI, výjimečně upravit, schválit.
          </p>
          {queueItem ? (
            <p className="mt-2 text-sm font-medium text-slate-700">
              {queueItem.store_id} · strana {queueItem.page_no} · zbývá {queueItem.remaining_pages_in_batch} stran v
              letáku · {queueItem.remaining_leaflets} letáků ve frontě
            </p>
          ) : queueEmpty ? (
            <p className="mt-2 text-sm font-medium text-slate-700">Fronta je prázdná.</p>
          ) : null}
        </div>
        <label className="text-sm font-semibold text-slate-700">
          Obchod
          <select
            value={preview.retailer}
            onChange={(e) => preview.setRetailer(e.target.value as typeof preview.retailer)}
            className="mt-1 block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
          >
            <option value="lidl">Lidl</option>
            <option value="billa">BILLA</option>
            <option value="kaufland">Kaufland</option>
            <option value="penny">Penny</option>
            <option value="albert">Albert</option>
            <option value="other">jiné</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {queueItem ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void reviewAction("approve_page")}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Schválit celou stránku
            </button>
            <button
              type="button"
              disabled={busy || !pageImageUrl}
              onClick={() => void rereadFromImage("page")}
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-900 disabled:opacity-40"
            >
              Znovu přečíst AI
            </button>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl px-4 py-2 text-sm font-bold ${
            queueItem
              ? "border border-slate-200 bg-white text-slate-700"
              : "bg-slate-900 text-white"
          }`}
        >
          {file ? "Otevřít jiné PDF" : "Otevřít PDF ručně"}
        </button>
        {file ? (
          <>
            <button
              type="button"
              disabled={busy || !pageImageUrl}
              onClick={() => void parseCurrentPage()}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? `AI čte stranu ${pageNo}…` : `Číst stranu ${pageNo}`}
            </button>
            <button
              type="button"
              disabled={busy || !pageImageUrl}
              onClick={() => void rereadFromImage("page")}
              className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-bold text-indigo-900 disabled:opacity-40"
            >
              Znovu přečíst AI celou stránku
            </button>
            <button
              type="button"
              disabled={Boolean(reading) && !reading.startsWith("Hotovo") && !reading.startsWith("Strana")}
              onClick={() => void readAllPages()}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 disabled:opacity-40"
            >
              Číst všechny strany do CSV
            </button>
          </>
        ) : null}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) {
              setOffers([]);
              setQueueItem(null);
              preview.setFromFile(next);
            }
          }}
        />
      </div>
      {reading ? <p className="rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800">{reading}</p> : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700">{error}</p> : null}

      {file || pageImageUrl || offers.length || queueItem || queueEmpty || queueLoading ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(22rem,0.9fr)_minmax(28rem,1.1fr)]">
          <div className="xl:sticky xl:top-4">
            {file ? (
              <LeafletA4Viewer
                file={file}
                compact
                title={preview.fileName || file.name}
                onPageChange={onPageChange}
                onReadPage={() => void rereadFromImage("page")}
              />
            ) : pageImageUrl ? (
              <LetakA4Image src={pageImageUrl} title={`${preview.retailer} · strana ${pageNo}`} pageNo={pageNo} />
            ) : (
              <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
                <div className="px-5 py-3 text-sm font-semibold text-slate-300">Náhled A4</div>
                <div className="flex aspect-[210/297] max-h-[min(72vh,860px)] items-center justify-center bg-black text-sm text-slate-400">
                  {queueLoading ? "Načítám stránku ke kontrole…" : "Není nic ke kontrole."}
                </div>
              </section>
            )}
          </div>
          <section className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-900">Produkty na straně {pageNo}</h2>
              <div className="flex items-center gap-3">
                <p className="text-sm text-slate-500">{offers.length} karet</p>
                {queueItem ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void reviewAction("approve_page")}
                    className="rounded-xl bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Schválit celou stránku
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy || !pageImageUrl}
                  onClick={() => void rereadFromImage("page")}
                  className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-900 disabled:opacity-40"
                >
                  Znovu přečíst AI
                </button>
              </div>
            </div>
            {offers.length ? (
              <ul className="space-y-3">
                {offers.map((offer, index) => (
                  <li key={`${offer.id || offer.page_no}-${index}-${offer.extracted_name ?? "row"}`}>
                    <LetakProductCard
                      offer={offer}
                      disabled={busy}
                      onApprove={() => {
                        if (queueItem?.page_id && offer.id) void reviewAction("approve_offer", offer.id);
                        else patchOffer(index, { review_status: "approved" });
                      }}
                      onReread={() => void rereadFromImage("product", index)}
                      onEdit={() => setEditIndex(index)}
                      onReject={() => {
                        if (queueItem?.page_id && offer.id) void reviewAction("reject_offer", offer.id);
                        else patchOffer(index, { review_status: "rejected" });
                      }}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-sm text-slate-600">
                {queueLoading
                  ? "Načítám data ke kontrole…"
                  : queueEmpty
                    ? "Není nic ke kontrole. Workflow už doběhlo — čeká se na další leták z CRONu."
                    : "Na této straně zatím nejsou produktová data."}
              </p>
            )}
          </section>
        </div>
      ) : (
        <p className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-12 text-center text-slate-600">
          Není nic ke kontrole.
        </p>
      )}

      <EditProductSheet
        open={editIndex != null}
        offer={editIndex != null ? offers[editIndex] ?? null : null}
        onClose={() => setEditIndex(null)}
        onSave={(patch) => {
          if (editIndex == null) return;
          const current = offers[editIndex];
          if (!current) return;
          patchOffer(editIndex, {
            ...patch,
            field_sources: markHumanEdits(current, patch, current.field_sources),
          });
        }}
      />
    </main>
  );
}
