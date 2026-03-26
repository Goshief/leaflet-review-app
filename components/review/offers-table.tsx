import type { LidlPageOffer } from "@/lib/lidl-parser";
import { OcrCropThumb } from "./ocr-crop-thumb";

/** Řádek z vision API nebo OCR heuristiky (+ volitelný výřez). */
export type ReviewOfferRow = LidlPageOffer & {
  ocr_crop_bbox?: { x: number; y: number; w: number; h: number } | null;
};

function cell(v: string | number | boolean | null | undefined) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "ano" : "ne";
  return String(v);
}

export function OffersTable({
  offers,
  pageImageSrc,
}: {
  offers: ReviewOfferRow[];
  /** Stejný obrázek jako stránka (PNG z PDF / upload) — pro výřezy OCR. */
  pageImageSrc?: string | null;
}) {
  const showThumb =
    !!pageImageSrc && offers.some((o) => o.ocr_crop_bbox && o.ocr_crop_bbox.w > 0);

  if (offers.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Model nevrátil žádné řádky (prázdné pole) — zkontroluj stránku nebo zkus
        znovu.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {showThumb ? (
              <th className="w-[100px] px-3 py-2">Výřez</th>
            ) : null}
            <th className="px-3 py-2">Název</th>
            <th className="px-3 py-2">Cena</th>
            <th className="px-3 py-2">Balení</th>
            <th className="px-3 py-2">Přeškrt.</th>
            <th className="px-3 py-2">Jedn.</th>
            <th className="px-3 py-2">Lidl+</th>
            <th className="px-3 py-2">Pozn.</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o, i) => (
            <tr
              key={i}
              className="border-b border-slate-100 odd:bg-white even:bg-slate-50/80"
            >
              {showThumb ? (
                <td className="px-3 py-2 align-top">
                  {pageImageSrc && o.ocr_crop_bbox && o.ocr_crop_bbox.w > 0 ? (
                    <OcrCropThumb
                      imageSrc={pageImageSrc}
                      bbox={o.ocr_crop_bbox}
                    />
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              ) : null}
              <td className="max-w-[220px] px-3 py-2 align-top text-slate-900">
                {cell(o.extracted_name)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {o.price_total != null ? (
                  <>
                    {o.price_total} {o.currency}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top text-slate-600">
                {o.pack_qty == null &&
                o.pack_unit_qty == null &&
                o.pack_unit == null
                  ? "—"
                  : `${[o.pack_qty, o.pack_unit_qty].filter((x) => x != null).join("×")} ${o.pack_unit ?? ""}`.trim()}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {cell(o.price_standard)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {cell(o.typical_price_per_unit)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {o.has_loyalty_card_price === true && o.price_with_loyalty_card != null
                  ? `${o.price_with_loyalty_card} Kč`
                  : cell(o.has_loyalty_card_price)}
              </td>
              <td className="max-w-[140px] px-3 py-2 align-top text-xs text-slate-500">
                {cell(o.notes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
