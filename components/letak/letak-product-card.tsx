"use client";

import { aiVerificationBadge } from "@/lib/leaflet/ai-verification-badge";
import { loyaltyProgramLabel } from "@/lib/leaflet/retailer-adapter";
import type { AiChecks } from "@/lib/leaflet/ai-checks";
import type { AiProposal, FieldSources } from "@/lib/leaflet/field-source";
import { LEAFLET_PRODUCT_KEYS } from "@/lib/leaflet/leaflet-product";
import type { LidlPageOffer } from "@/lib/lidl-parser";

export type LetakOfferRow = LidlPageOffer & {
  id?: string;
  ai_checks?: AiChecks | null;
  review_status?: "pending" | "approved" | "rejected" | "needs_review";
  package_unknown?: boolean | null;
  field_sources?: FieldSources | null;
  ai_proposal?: AiProposal | null;
  parser_run_id?: string | null;
};

type Props = {
  offer: LetakOfferRow;
  disabled?: boolean;
  onApprove: () => void;
  onReread: () => void;
  onEdit: () => void;
  onReject: () => void;
};

function display(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "ano" : "ne";
  return String(value);
}

function money(value: number | null | undefined, currency = "CZK"): string {
  if (value == null) return "—";
  return `${value} ${currency}`;
}

export function LetakProductCard({ offer, disabled, onApprove, onReread, onEdit, onReject }: Props) {
  const loyalty = loyaltyProgramLabel(offer.store_id);
  const packUnknown =
    offer.package_unknown === true || String(offer.pack_unit ?? "").trim().toLowerCase() === "unknown";
  const ai = aiVerificationBadge(offer);
  const status = offer.review_status ?? "pending";
  const proposals = Object.entries(offer.ai_proposal ?? {}).filter(([, value]) => value != null && value !== "");
  const humanKeys = LEAFLET_PRODUCT_KEYS.filter((key) => offer.field_sources?.[key] === "human");

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            ai.kind === "confirmed"
              ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
              : "bg-amber-50 text-amber-900 ring-1 ring-amber-200"
          }`}
        >
          {ai.text}
        </p>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          strana {display(offer.page_no)} · {status}
        </p>
      </div>

      <h3 className="mt-3 text-base font-bold leading-snug whitespace-normal break-words text-slate-900">
        {offer.extracted_name?.trim() || "—"}
      </h3>
      <p className="mt-1 whitespace-normal break-words text-sm text-slate-600">
        {offer.brand?.trim() || "značka —"}
      </p>

      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">price_total</dt>
          <dd className="font-semibold tabular-nums text-slate-900">{money(offer.price_total, offer.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">price_standard</dt>
          <dd className="tabular-nums text-slate-800">{money(offer.price_standard, offer.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{loyalty}</dt>
          <dd className="tabular-nums text-slate-800">{money(offer.price_with_loyalty_card, offer.currency)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">has_loyalty_card_price</dt>
          <dd className="text-slate-800">{display(offer.has_loyalty_card_price)} ({loyalty})</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">pack_qty</dt>
          <dd className="tabular-nums text-slate-800">{display(offer.pack_qty)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">pack_unit</dt>
          <dd className="whitespace-normal break-words text-slate-800">{display(offer.pack_unit)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">pack_unit_qty</dt>
          <dd className="tabular-nums text-slate-800">{display(offer.pack_unit_qty)}</dd>
        </div>
        {packUnknown ? (
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">package_unknown</dt>
            <dd className="font-semibold text-amber-800">ano (unknown)</dd>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">notes</dt>
          <dd className="whitespace-normal break-words text-slate-800">{display(offer.notes)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">page_no</dt>
          <dd className="tabular-nums text-slate-800">{display(offer.page_no)}</dd>
        </div>
        {humanKeys.length ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">source=human</dt>
            <dd className="whitespace-normal break-words text-slate-800">{humanKeys.join(", ")}</dd>
          </div>
        ) : null}
        {proposals.length ? (
          <div className="sm:col-span-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
            <dt className="text-xs font-semibold uppercase tracking-wide text-amber-800">AI návrh (nepřepsáno)</dt>
            <dd className="mt-1 whitespace-normal break-words text-sm text-amber-950">
              {proposals.map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={onApprove}
          className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          Schválit
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onReread}
          className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-900 disabled:opacity-50"
        >
          Znovu přečíst AI
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onEdit}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50"
        >
          Upravit
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onReject}
          className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 disabled:opacity-50"
        >
          Zamítnout
        </button>
      </div>
    </article>
  );
}
