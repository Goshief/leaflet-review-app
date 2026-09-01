"use client";

type Props = {
  src: string;
  title?: string;
  pageNo?: number;
};

export function LetakA4Image({ src, title, pageNo }: Props) {
  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-slate-300">
        <p className="whitespace-normal break-words font-semibold">{title || "Náhled A4"}</p>
        <p className="shrink-0 font-mono text-xs">{pageNo ? `strana ${pageNo}` : "—"}</p>
      </div>
      <div className="relative bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title || "Leták strana"}
          className="mx-auto max-h-[min(72vh,860px)] w-auto max-w-full object-contain"
        />
      </div>
    </section>
  );
}