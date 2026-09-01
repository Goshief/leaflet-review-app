"use client";

import { useEffect, useRef, useState } from "react";
import { loadPdfDocument, renderLoadedPdfPage } from "@/lib/pdf/render-page";

type Props = {
  file: File;
  title?: string;
  compact?: boolean;
  onReadPage?: (pageNo: number) => void;
  onPageChange?: (pageNo: number, imageUrl: string | null) => void;
};

export function LeafletA4Viewer({ file, title, compact, onReadPage, onPageChange }: Props) {
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Array<string | null>>([]);
  const [busy, setBusy] = useState("Načítám leták…");
  const [error, setError] = useState("");
  const cacheRef = useRef<Map<number, string>>(new Map());
  const thumbsRef = useRef<string[]>([]);
  const thumbBox = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef(1);

  useEffect(() => {
    onPageChange?.(page, currentUrl);
  }, [page, currentUrl, onPageChange]);

  useEffect(() => {
    let cancelled = false;
    const cache = new Map<number, string>();
    cacheRef.current = cache;
    thumbsRef.current = [];

    async function open() {
      setBusy("Rozkládám PDF na strany A4…");
      setError("");
      setCurrentUrl(null);
      setThumbs([]);
      setPage(1);
      pageRef.current = 1;
      try {
        const pdf = await loadPdfDocument(file);
        if (cancelled) return;
        setPageCount(pdf.numPages);
        setThumbs(Array.from({ length: pdf.numPages }, () => null));

        const first = URL.createObjectURL(await renderLoadedPdfPage(pdf, 1, 1.55));
        cache.set(1, first);
        if (!cancelled) {
          setCurrentUrl(first);
          setBusy("");
        }

        for (let n = 1; n <= pdf.numPages; n += 1) {
          if (cancelled) return;
          const thumb = URL.createObjectURL(await renderLoadedPdfPage(pdf, n, 0.26));
          thumbsRef.current.push(thumb);
          setThumbs((prev) => {
            const next = [...prev];
            next[n - 1] = thumb;
            return next;
          });
          if (!cache.has(n) && n === pageRef.current) {
            const full = URL.createObjectURL(await renderLoadedPdfPage(pdf, n, 1.55));
            cache.set(n, full);
            if (!cancelled) setCurrentUrl(full);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy("");
        }
      }
    }

    void open();
    return () => {
      cancelled = true;
      for (const url of cache.values()) URL.revokeObjectURL(url);
      for (const url of thumbsRef.current) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, [file]);

  useEffect(() => {
    if (!file || pageCount < 1) return;
    const cached = cacheRef.current.get(page);
    if (cached) {
      setCurrentUrl(cached);
      return;
    }
    let cancelled = false;
    async function show() {
      try {
        const pdf = await loadPdfDocument(file);
        const url = URL.createObjectURL(await renderLoadedPdfPage(pdf, page, 1.55));
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        cacheRef.current.set(page, url);
        setCurrentUrl(url);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    void show();
    return () => {
      cancelled = true;
    };
  }, [file, page, pageCount]);

  useEffect(() => {
    const node = thumbBox.current?.querySelector(`[data-page="${page}"]`);
    if (node instanceof HTMLElement) node.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [page]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      if (event.key === "ArrowRight") setPage((p) => Math.min(pageCount || p, p + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount]);

  return (
    <section className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-950 text-white shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-slate-300">
        <p className="whitespace-normal break-words font-semibold">{title || file.name}</p>
        <p className="shrink-0 font-mono text-xs">{pageCount ? `${page}/${pageCount}` : "—"}</p>
      </div>

      <div className="relative bg-black">
        {busy ? <p className="px-5 py-24 text-center text-slate-400">{busy}</p> : null}
        {error ? <p className="px-5 py-24 text-center text-rose-300">{error}</p> : null}
        {currentUrl && !busy ? (
          <img src={currentUrl} alt={`Leták strana ${page}`} className={compact ? "mx-auto max-h-[min(72vh,860px)] w-auto max-w-full object-contain" : "mx-auto max-h-[78vh] w-auto max-w-full object-contain"} />
        ) : null}

        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="absolute left-3 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-3xl font-black text-white backdrop-blur disabled:opacity-20 sm:flex"
          aria-label="Předchozí strana"
        >
          ‹
        </button>
        <button
          type="button"
          disabled={!pageCount || page >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          className="absolute right-3 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 text-3xl font-black text-white backdrop-blur disabled:opacity-20 sm:flex"
          aria-label="Další strana"
        >
          ›
        </button>
      </div>

      <div ref={thumbBox} className="flex gap-2 overflow-x-auto bg-slate-900 px-4 py-3">
        {thumbs.map((url, index) => {
          const n = index + 1;
          return (
            <button
              key={n}
              type="button"
              data-page={n}
              onClick={() => setPage(n)}
              className={
                n === page
                  ? "h-24 w-16 shrink-0 overflow-hidden rounded-lg ring-2 ring-indigo-400"
                  : "h-24 w-16 shrink-0 overflow-hidden rounded-lg opacity-70 ring-1 ring-white/10 hover:opacity-100"
              }
            >
              {url ? <img src={url} alt={`Náhled ${n}`} className="h-full w-full object-cover" /> : (
                <span className="flex h-full items-center justify-center text-[10px] text-slate-400">{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900 px-5 py-3">
        <div className="flex gap-2">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Předchozí
          </button>
          <button type="button" disabled={!pageCount || page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))} className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold disabled:opacity-40">
            Další
          </button>
        </div>
        {onReadPage ? (
          <button type="button" onClick={() => onReadPage(page)} className="rounded-xl bg-indigo-500 px-4 py-2 text-sm font-bold">
            Číst stranu {page} AI parserem
          </button>
        ) : null}
      </div>
    </section>
  );
}
