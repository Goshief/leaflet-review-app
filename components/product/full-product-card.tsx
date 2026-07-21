import type { ReactNode } from "react";
import type { QuarantineProductCardVm } from "@/lib/quarantine/quarantine-product-card-vm";

type Props = {
  variant: "quarantine";
  vm: QuarantineProductCardVm;
  leftColumn?: ReactNode;
  actionsSlot?: ReactNode;
  rootTag?: "article" | "div";
  rootTestId?: string;
};

export function FullProductCard({
  vm,
  leftColumn,
  actionsSlot,
  rootTag = "article",
  rootTestId,
}: Props) {
  const Tag = rootTag;
  return (
    <Tag
      data-testid={rootTestId}
      className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-[9rem_minmax(0,1fr)] lg:grid-cols-[9rem_minmax(0,1fr)_auto]"
    >
      <div>{leftColumn}</div>
      <div className="min-w-0 space-y-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{vm.name}</h3>
          {vm.brand || vm.category ? (
            <p className="text-xs text-slate-500">{[vm.brand, vm.category].filter(Boolean).join(" · ")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xl font-bold text-slate-900">{vm.price}</span>
          {vm.standardPrice ? <span className="text-sm text-slate-500">běžně {vm.standardPrice}</span> : null}
          {vm.loyaltyPrice ? <span className="text-sm font-semibold text-indigo-700">s kartou {vm.loyaltyPrice}</span> : null}
        </div>
        <dl className="grid gap-x-4 gap-y-1 text-xs text-slate-600 sm:grid-cols-2">
          {vm.packageText ? <div><dt className="inline font-semibold">Balení: </dt><dd className="inline">{vm.packageText}</dd></div> : null}
          {vm.validity ? <div><dt className="inline font-semibold">Platnost: </dt><dd className="inline">{vm.validity}</dd></div> : null}
          <div><dt className="inline font-semibold">Důvod: </dt><dd className="inline">{vm.reason}</dd></div>
        </dl>
        {vm.notes ? <p className="text-xs text-slate-500">{vm.notes}</p> : null}
      </div>
      {actionsSlot ? <div className="flex flex-wrap content-start gap-2 sm:col-span-2 lg:col-span-1 lg:max-w-64">{actionsSlot}</div> : null}
    </Tag>
  );
}
