"use client";

import { EditProductSheet } from "@/components/review/edit-product-sheet";
import {
  ProductReviewCards,
  computeRowCounts,
  type RowReviewStatus,
  type RowReason,
} from "@/components/review/product-cards";
import type { ReviewOfferRow } from "@/components/review/offers-table";
import { useLeafletPreview } from "@/components/leaflet/preview-context";
import { getReviewEmptyState } from "@/lib/review/empty-state";
import {
  getPdfPageCount,
  renderPdfPageToPngBlob,
  renderPdfPageToPngFile,
} from "@/lib/pdf/render-page";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToasts } from "@/components/ui/toasts";

type ApiSuccess = {
  ok: true;
  offers: ReviewOfferRow[];
  model: string;
  page_no: number | null;
  source_url: string | null;
  mode?: "ocr";
  ocr_raw?: {
    word_count: number;
    words: Array<{ text: string; x: number; y: number; w: number; h: number }>;
    price_anchors: Array<{
      priceKc: number;
      rawText: string;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  };
};

type ApiErrorBody = {
  error: string;
  validation_errors?: string[];
  raw_model_output?: string;
  detail?: string;
};

type ApprovedValidationIssue = {
  flatIndex: number;
  name: string;
  problems: Array<
    | "missing_name"
    | "missing_price"
    | "missing_store"
    | "missing_page_no"
    | "missing_packaging_or_unknown"
    | "missing_batch_metadata"
  >;
};

export default function ReviewPage() {
  const router = useRouter();
  const toast = useToasts();
  const {
    file,
    fileName,
    blobUrl,
    kind,
    sourceUrl,
    setSourceUrl,
    setFromFile,
    startManualImport,
    clear,
    manualImportText,
  } =
    useLeafletPreview();
  const [pageNo, setPageNo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [offersByPage, setOffersByPage] = useState<Record<number, ReviewOfferRow[]> | null>(
    null
  );
  const [model, setModel] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rawOut, setRawOut] = useState<string | null>(null);
  const [extractMode, setExtractMode] = useState<"ocr" | "vision" | "local">("ocr");
  const [ocrDump, setOcrDump] = useState<ApiSuccess["ocr_raw"] | null>(null);
  const [manualText, setManualText] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [commitMsg, setCommitMsg] = useState<string | null>(null);
  const [actorName, setActorName] = useState("");
  const [statusFilter, setStatusFilter] = useState<RowReviewStatus | "all">(
    "all"
  );

  // Pracovní filtry nad seznamem
  const [q, setQ] = useState("");
  const [filterStore, setFilterStore] = useState<string>("all");
  const [filterPage, setFilterPage] = useState<string>("all");
  const [onlyLoyalty, setOnlyLoyalty] = useState(false);
  const [onlyNoPack, setOnlyNoPack] = useState(false);
  const [onlyHasError, setOnlyHasError] = useState(false);
  const [onlyHasNote, setOnlyHasNote] = useState(false);

  const [rowStatusByPage, setRowStatusByPage] = useState<
    Record<number, Record<number, RowReviewStatus | undefined>>
  >({});
  const [rowReasonByPage, setRowReasonByPage] = useState<
    Record<number, Record<number, RowReason | undefined>>
  >({});
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [qs, setQs] = useState<string>("");
  const [tab, setTab] = useState<
    "all" | "pending" | "approved" | "rejected" | "quarantine"
  >("all");
  const [focus, setFocus] = useState<null | { page: number; idx: number }>(null);

  const [reasonDialog, setReasonDialog] = useState<
    | null
    | {
        indices: number[];
        status: "quarantine" | "rejected";
        code: string;
        detail: string;
        err: string | null;
      }
  >(null);

  const [precommitDialog, setPrecommitDialog] = useState<null | {
    issues: ApprovedValidationIssue[];
    allowOverride: boolean;
  }>(null);
  const [dryRunOpen, setDryRunOpen] = useState(false);

  const [pdfPageCount, setPdfPageCount] = useState<number | null>(null);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewBusy, setPdfPreviewBusy] = useState(false);
  const [pdfPreviewErr, setPdfPreviewErr] = useState<string | null>(null);
  const restoredPreviewRef = useRef(false);
  const autosaveTimerRef = useRef<number | null>(null);
  const didAutoManualImportRef = useRef(false);
  const [saveIndicator, setSaveIndicator] = useState<
    { state: "saving" | "saved" | "error"; at: string | null; detail?: string | null }
  >({ state: "saved", at: null, detail: null });

  const currentOffers = useMemo<ReviewOfferRow[]>(() => {
    return offersByPage?.[pageNo] ?? [];
  }, [offersByPage, pageNo]);
  const currentRowStatus = useMemo<Record<number, RowReviewStatus | undefined>>(() => {
    // Pozor: po JSON.parse jsou klíče objektů stringy ("3"), i když to logicky jsou čísla.
    return (rowStatusByPage[pageNo] ?? (rowStatusByPage as any)[String(pageNo)] ?? {}) as Record<
      number,
      RowReviewStatus | undefined
    >;
  }, [rowStatusByPage, pageNo]);

  const flat = useMemo(() => {
    const pages = Object.keys(offersByPage ?? {})
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const offers: ReviewOfferRow[] = [];
    const ptr: Array<{ page: number; idx: number }> = [];
    const status: Record<number, RowReviewStatus | undefined> = {};
    const reason: Record<number, RowReason | undefined> = {};
    for (const p of pages) {
      const arr = offersByPage?.[p] ?? [];
      const stPage = (rowStatusByPage[p] ?? (rowStatusByPage as any)[String(p)] ?? {}) as Record<
        number,
        RowReviewStatus | undefined
      >;
      const rrPage = (rowReasonByPage[p] ?? (rowReasonByPage as any)[String(p)] ?? {}) as Record<
        number,
        RowReason | undefined
      >;
      for (let i = 0; i < arr.length; i++) {
        const fi = offers.length;
        offers.push(arr[i]!);
        ptr.push({ page: p, idx: i });
        status[fi] = stPage[i];
        reason[fi] = rrPage[i];
      }
    }
    return { offers, ptr, status, reason };
  }, [offersByPage, rowStatusByPage, rowReasonByPage]);

  // Backwards-compatible aliases (zbytek stránky je psaný pro `offers` + `rowStatus`).
  const offers = currentOffers;
  const rowStatus = currentRowStatus;

  const setOffers = useCallback(
    (
      next:
        | ReviewOfferRow[] 
        | null
        | ((prev: ReviewOfferRow[] | null) => ReviewOfferRow[] | null)
    ) => {
      setOffersByPage((prev) => {
        const prevPage = (prev?.[pageNo] ?? null) as ReviewOfferRow[] | null;
        const resolved = typeof next === "function" ? (next as any)(prevPage) : next;
        if (resolved == null) return prev ?? {};
        return { ...(prev ?? {}), [pageNo]: resolved };
      });
    },
    [pageNo]
  );

  const setRowStatus = useCallback(
    (
      next:
        | Record<number, RowReviewStatus | undefined>
        | ((prev: Record<number, RowReviewStatus | undefined>) => Record<number, RowReviewStatus | undefined>)
    ) => {
      setRowStatusByPage((prev) => {
        const prevPage = prev[pageNo] ?? {};
        const resolved = typeof next === "function" ? (next as any)(prevPage) : next;
        return { ...prev, [pageNo]: resolved };
      });
    },
    [pageNo]
  );

  useEffect(() => {
    if (kind === "manual") return;
    const intakeId = new URLSearchParams(window.location.search)
      .get("intake_id")
      ?.trim();
    if (blobUrl) return;
    if (!intakeId) {
      // Pokud už máme uloženou rozpracovanou kontrolu (např. ephemeral session),
      // nesmí nás to vyhodit na /upload jen proto, že chybí intake_id.
      try {
        const hasAnyState = (() => {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i) ?? "";
            if (k.startsWith("leaflet_review_state:")) return true;
          }
          return false;
        })();
        if (hasAnyState) return;
      } catch {
        // ignore
      }
      router.replace("/upload");
    }
  }, [blobUrl, kind, router]);

  // Obnova "manual" session po refreshi (Excel/ChatGPT import).
  useEffect(() => {
    if (kind === "manual") return;
    if (blobUrl || file) return;
    const qs = new URLSearchParams(window.location.search);
    const mode = (qs.get("mode") ?? "").trim();
    const sessionId = (qs.get("session_id") ?? "").trim();
    if (mode !== "manual" || !sessionId) return;
    try {
      const raw = localStorage.getItem(`leaflet_manual_session:${sessionId}`) ?? "";
      const parsed = raw ? (JSON.parse(raw) as any) : null;
      const txt = (parsed?.manualText ?? "").toString();
      if (txt.trim()) {
        startManualImport(txt);
        if ((parsed?.sourceUrl ?? "").toString().trim() && !sourceUrl.trim()) {
          setSourceUrl((parsed.sourceUrl as string) ?? "");
        }
      }
    } catch {
      // ignore
    }
  }, [kind, blobUrl, file, startManualImport, sourceUrl, setSourceUrl]);

  // Obnova PDF/obrázku po refreshi přes intake_id v URL.
  useEffect(() => {
    if (kind === "manual") return;
    if (blobUrl || file) return;
    const qs = new URLSearchParams(window.location.search);
    const intakeId = (qs.get("intake_id") ?? "").trim();
    if (!intakeId) return;
    const name = (qs.get("name") ?? "leaflet").trim() || "leaflet";
    const mime = (qs.get("mime") ?? "").trim();
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/intake-file?intake_id=${encodeURIComponent(intakeId)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const b = await res.blob();
        if (cancel) return;
        const f = new File([b], name, { type: mime || b.type || "application/pdf" });
        setFromFile(f);
      } catch {
        // noop: UI ukáže fallback "Přesměrování…" nebo uživatel zkusí znovu.
      }
    })();
    return () => {
      cancel = true;
    };
  }, [blobUrl, file, kind, setFromFile]);

  useEffect(() => {
    if (!currentOffers?.length) {
      setRowStatusByPage((prev) => {
        const existing = prev[pageNo];
        if (existing && Object.keys(existing).length === 0) return prev;
        return { ...prev, [pageNo]: {} };
      });
      return;
    }
    setRowStatusByPage((prev) => ({
      ...prev,
      [pageNo]: Object.fromEntries(
        currentOffers.map((_, i) => [i, (prev[pageNo]?.[i] ?? "pending") as RowReviewStatus])
      ) as Record<number, RowReviewStatus>,
    }));
  }, [currentOffers, pageNo]);

  // Pokud uživatel přišel z /upload přes "Excel/ChatGPT výstup",
  // předvyplň textarea a usnadni import jedním klikem.
  useEffect(() => {
    if (kind !== "manual") return;
    if (!manualImportText.trim()) return;
    setManualText((prev) => (prev.trim() ? prev : manualImportText));
  }, [kind, manualImportText]);

  function getReviewStateKey(): string | null {
    const qs = new URLSearchParams(window.location.search);
    // Explicitní resume z Historie (lokální session key).
    const resumeKey = (qs.get("resume_key") ?? "").trim();
    if (resumeKey) return resumeKey;
    const intakeId = (qs.get("intake_id") ?? "").trim();
    if (intakeId) return `intake:${intakeId}`;
    const sessionId = (qs.get("session_id") ?? "").trim();
    if (sessionId) return `manual:${sessionId}`;
    // Fallback: i bez parametrů musí relace persistovat (a být vidět v Historii).
    try {
      const existing = (sessionStorage.getItem("leaflet_ephemeral_session") ?? "").trim();
      if (existing) return `ephemeral:${existing}`;
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
      sessionStorage.setItem("leaflet_ephemeral_session", id);
      return `ephemeral:${id}`;
    } catch {
      return "ephemeral:default";
    }
  }

  // Restore offers+status po refreshi.
  useEffect(() => {
    const key = getReviewStateKey();
    if (!key) return;
    if (offersByPage && Object.keys(offersByPage).length) return;
    try {
      const raw = localStorage.getItem(`leaflet_review_state:${key}`) ?? "";
      if (!raw.trim()) return;
      const s = JSON.parse(raw) as any;
      if (s.offersByPage && typeof s.offersByPage === "object") setOffersByPage(s.offersByPage);
      if (s.rowStatusByPage && typeof s.rowStatusByPage === "object") {
        // migrate legacy "quarantined" -> "quarantine"
        const migrated: Record<string, Record<string, unknown>> = {};
        for (const [p, st] of Object.entries(s.rowStatusByPage as Record<string, any>)) {
          const next: Record<string, unknown> = {};
          for (const [k2, v2] of Object.entries((st ?? {}) as Record<string, unknown>)) {
            next[k2] = v2 === "quarantined" ? "quarantine" : v2;
          }
          migrated[p] = next;
        }
        setRowStatusByPage(migrated as any);
      }
      if (s.rowReasonByPage && typeof s.rowReasonByPage === "object") {
        setRowReasonByPage(s.rowReasonByPage);
      }
      if (typeof s.pageNo === "number" && s.pageNo >= 1) setPageNo(s.pageNo);
      if (typeof s.sourceUrl === "string") setSourceUrl(s.sourceUrl);
      if (typeof s.extractMode === "string") setExtractMode(s.extractMode);
      if (typeof s.model === "string") setModel(s.model);
      if (typeof s.manualText === "string") setManualText(s.manualText);
      if (typeof s.actorName === "string") setActorName(s.actorName);

      // Kritické: po F5 se `preview-context` vynuluje (kind/blobUrl/file).
      // Pokud máme uložený stav kontroly, zvedni UI zpět do "manual" režimu,
      // aby se stránka nevyhodnotila jako "chybí soubor -> redirect".
      if (!restoredPreviewRef.current) {
        restoredPreviewRef.current = true;
        const hasOffersByPage = s.offersByPage && typeof s.offersByPage === "object";
        const txt = (s.manualText ?? "").toString();
        if (!blobUrl && !file && kind !== "manual" && (hasOffersByPage || txt.trim())) {
          startManualImport(txt);
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave: nikdy nenech produkty zmizet.
  useEffect(() => {
    const key = getReviewStateKey();
    if (!key) return;
    if (!offersByPage) return;
    if (autosaveTimerRef.current != null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setSaveIndicator({ state: "saving", at: null, detail: null });
    autosaveTimerRef.current = window.setTimeout(() => {
      try {
        const updated_at = new Date().toISOString();
        localStorage.setItem(
          `leaflet_review_state:${key}`,
          JSON.stringify({
            offersByPage,
            rowStatusByPage,
            rowReasonByPage,
            pageNo,
            sourceUrl,
            extractMode,
            model,
            manualText,
            actorName,
            resume_url:
              typeof window !== "undefined"
                ? `${window.location.pathname}${window.location.search}`
                : null,
            updated_at,
          })
        );
        // "Pokračovat tam, kde jsem skončila" (homepage CTA).
        try {
          const href =
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.search}`
              : "/review";
          localStorage.setItem(
            "leaflet_last_review",
            JSON.stringify({
              session_key: key,
              page_no: pageNo,
              href,
              updated_at,
              file_name: fileName ?? null,
            })
          );
        } catch {
          // ignore
        }
        setSaveIndicator({ state: "saved", at: updated_at, detail: null });
        toast.success("Session uložena");
      } catch (e) {
        setSaveIndicator({
          state: "error",
          at: null,
          detail: e instanceof Error ? e.message : "Uložení do localStorage selhalo.",
        });
        toast.error("Chyba ukládání", "Nepodařilo se uložit session.");
      } finally {
        autosaveTimerRef.current = null;
      }
    }, 220);
  }, [
    offersByPage,
    rowStatusByPage,
    rowReasonByPage,
    pageNo,
    sourceUrl,
    extractMode,
    model,
    manualText,
    actorName,
    fileName,
  ]);

  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, []);

  const readTabFromLocation = useCallback(() => {
    if (typeof window === "undefined") return "all" as const;
    const p = new URLSearchParams(window.location.search);
    const t = (p.get("tab") ?? "").trim();
    const normalized = t === "quarantined" ? "quarantine" : t;
    const allowed = new Set(["all", "pending", "approved", "rejected", "quarantine"]);
    return (allowed.has(normalized) ? normalized : "all") as
      | "all"
      | "pending"
      | "approved"
      | "rejected"
      | "quarantine";
  }, []);

  const readStatusFilterFromLocation = useCallback(() => {
    if (typeof window === "undefined") return "all" as const;
    const p = new URLSearchParams(window.location.search);
    const f = (p.get("filter") ?? "").trim();
    const normalized = f === "quarantined" ? "quarantine" : f;
    const allowed = new Set(["all", "approved", "pending", "quarantine", "rejected"]);
    return (allowed.has(normalized) ? normalized : "all") as RowReviewStatus | "all";
  }, []);

  const readFocusFromLocation = useCallback(() => {
    if (typeof window === "undefined") return null as null | { page: number; idx: number };
    const p = new URLSearchParams(window.location.search);
    const page = Number((p.get("focus_page") ?? "").trim());
    const idx = Number((p.get("focus_idx") ?? "").trim());
    if (!Number.isFinite(page) || !Number.isFinite(idx) || page < 1 || idx < 0) return null;
    return { page, idx };
  }, []);

  const setTabInUrl = useCallback(
    (nextTab: "all" | "pending" | "approved" | "rejected" | "quarantine") => {
      if (typeof window === "undefined") return;
      const p = new URLSearchParams(window.location.search);
      p.set("tab", nextTab);
      // Detail/focus je svázaný s konkrétní položkou; při změně tabu ho zruš.
      p.delete("focus_page");
      p.delete("focus_idx");
      const nextQs = `?${p.toString()}`;
      setTab(nextTab);
      setQs(nextQs);
      setFocus(null);
      router.push(`/review${nextQs}`);
    },
    [router]
  );

  const setFocusInUrl = useCallback(
    (next: null | { page: number; idx: number }) => {
      if (typeof window === "undefined") return;
      const p = new URLSearchParams(window.location.search);
      if (!next) {
        p.delete("focus_page");
        p.delete("focus_idx");
        setFocus(null);
      } else {
        p.set("focus_page", String(next.page));
        p.set("focus_idx", String(next.idx));
        setFocus(next);
      }
      const nextQs = `?${p.toString()}`;
      setQs(nextQs);
      router.push(`/review${nextQs}`);
    },
    [router]
  );

  // Udrž query string + tab synchronně s URL (klik / back / forward).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => {
      setQs(window.location.search || "");
      setTab(readTabFromLocation());
      setFocus(readFocusFromLocation());
      setStatusFilter(readStatusFilterFromLocation());
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [readTabFromLocation, readFocusFromLocation, readStatusFilterFromLocation]);

  const setStatusFilterInUrl = useCallback(
    (next: RowReviewStatus | "all") => {
      if (typeof window === "undefined") return;
      const p = new URLSearchParams(window.location.search);
      p.set("filter", next);
      const nextQs = `?${p.toString()}`;
      setStatusFilter(next);
      setQs(nextQs);
      router.push(`/review${nextQs}`);
    },
    [router]
  );

  // Přednastav extrakci z URL (?extract=ocr|vision|local) — přichází z /upload wizardu.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const e = (p.get("extract") ?? "").trim();
    const allowed = new Set(["ocr", "vision", "local"]);
    if (allowed.has(e)) setExtractMode(e as any);
  }, []);

  const tabHref = useMemo(() => {
    if (typeof window === "undefined") {
      return {
        all: "/review?tab=all",
        pending: "/review?tab=pending",
        approved: "/review?tab=approved",
        rejected: "/review?tab=rejected",
        quarantine: "/review?tab=quarantine",
      };
    }
    const p = new URLSearchParams(window.location.search);
    return {
      all: (() => {
        p.set("tab", "all");
        return `/review?${p.toString()}`;
      })(),
      pending: (() => {
        p.set("tab", "pending");
        return `/review?${p.toString()}`;
      })(),
      approved: (() => {
        p.set("tab", "approved");
        return `/review?${p.toString()}`;
      })(),
      rejected: (() => {
        p.set("tab", "rejected");
        return `/review?${p.toString()}`;
      })(),
      quarantine: (() => {
        p.set("tab", "quarantine");
        return `/review?${p.toString()}`;
      })(),
    };
  }, [qs]);

  useEffect(() => {
    if (kind !== "pdf" || !file) {
      setPdfPageCount(null);
      setPdfPreviewErr(null);
      return;
    }
    let cancel = false;
    (async () => {
      try {
        const n = await getPdfPageCount(file);
        if (cancel) return;
        setPdfPageCount(n);
      } catch {
        if (!cancel) {
          setPdfPageCount(null);
          setPdfPreviewErr("Nepodařilo se načíst PDF (poškozený soubor?).");
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [kind, file]);

  useEffect(() => {
    if (kind !== "pdf" || !file || !pdfPageCount) {
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setPdfPreviewBusy(false);
      setPdfPreviewErr(null);
      return;
    }
    const p = Math.min(Math.max(1, pageNo), pdfPageCount);
    if (p !== pageNo) setPageNo(p);

    let cancel = false;
    setPdfPreviewBusy(true);
    setPdfPreviewErr(null);
    (async () => {
      try {
        const png = await renderPdfPageToPngBlob(file, p);
        if (cancel) return;
        const url = URL.createObjectURL(png);
        setPdfPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
      } catch (e) {
        if (!cancel) {
          setPdfPreviewErr(
            e instanceof Error ? e.message : "Vykreslení stránky selhalo."
          );
          setPdfPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
        }
      } finally {
        if (!cancel) setPdfPreviewBusy(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [kind, file, pageNo, pdfPageCount]);

  const reviewCounts = useMemo(() => {
    const total = flat.offers.length;
    if (!total) return { approved: 0, rejected: 0, quarantined: 0, pending: 0, total: 0 };
    const indices = flat.offers.map((_, i) => i);
    const c = computeRowCounts(indices, flat.status);
    return { ...c, total };
  }, [flat]);

  const storeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const o of flat.offers) {
      const v =
        (o.store_id ?? (o as any).source_type ?? "").toString().trim().toLowerCase();
      if (v) s.add(v);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "cs"));
  }, [flat.offers]);

  const pageOptions = useMemo(() => {
    const s = new Set<number>();
    for (const o of flat.offers) {
      const p = (o as any).page_no;
      if (typeof p === "number" && Number.isFinite(p)) s.add(p);
    }
    return Array.from(s).sort((a, b) => a - b);
  }, [flat.offers]);

  const visibleIndices = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = flat.offers
      .map((_, i) => i)
      .filter((i) => {
        const s = (flat.status[i] ?? "pending") as RowReviewStatus;
        if (tab !== "all" && s !== tab) return false;
        // Volitelný status filtr (fallback pro starší odkazy /review?filter=…)
        if (statusFilter !== "all" && s !== statusFilter) return false;

        const o = flat.offers[i]!;
        if (!o) return false;

        if (filterStore !== "all") {
          const v =
            (o.store_id ?? (o as any).source_type ?? "").toString().trim().toLowerCase();
          if (v !== filterStore) return false;
        }

        if (filterPage !== "all") {
          const p = (o as any).page_no;
          if (String(p ?? "") !== filterPage) return false;
        }

        if (qq) {
          const hay = [
            (o.extracted_name ?? "").toString(),
            (o.brand ?? "").toString(),
            (o.category ?? "").toString(),
            (o.notes ?? "").toString(),
          ]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(qq)) return false;
        }

        if (onlyLoyalty) {
          const ok = !!(o.has_loyalty_card_price && o.price_with_loyalty_card != null);
          if (!ok) return false;
        }

        if (onlyNoPack) {
          const ok =
            o.pack_qty == null && o.pack_unit == null && o.pack_unit_qty == null;
          if (!ok) return false;
        }

        if (onlyHasNote) {
          const ok = (o.notes ?? "").toString().trim().length > 0;
          if (!ok) return false;
        }

        if (onlyHasError) {
          const nameOk = (o.extracted_name ?? "").toString().trim().length > 0;
          const priceOk = o.price_total != null && Number.isFinite(Number(o.price_total));
          if (nameOk && priceOk) return false;
        }

        return true;
      });

    // "Detail produktu" režim: pokud je v URL focus_page/focus_idx, zobraz jen tu jednu položku.
    if (!focus) return base;
    const fi = flat.ptr.findIndex((p) => p.page === focus.page && p.idx === focus.idx);
    if (fi < 0) return [];
    return [fi];
  }, [
    flat.offers,
    flat.status,
    tab,
    statusFilter,
    q,
    filterStore,
    filterPage,
    onlyLoyalty,
    onlyNoPack,
    onlyHasError,
    onlyHasNote,
    focus,
    flat.ptr,
  ]);
  const listEmptyState = useMemo(
    () => getReviewEmptyState(flat.offers.length, visibleIndices.length),
    [flat.offers.length, visibleIndices.length]
  );

  const runExtract = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setRawOut(null);
    setOffersByPage((prev) => ({ ...(prev ?? {}), [pageNo]: [] }));
    setRowStatusByPage((prev) => ({ ...prev, [pageNo]: {} }));
    setModel(null);
    setOcrDump(null);
    try {
      let upload: File;
      let metaPage = pageNo;
      if (kind === "image") {
        upload = file;
      } else if (kind === "pdf" && pdfPageCount) {
        const p = Math.min(Math.max(1, pageNo), pdfPageCount);
        metaPage = p;
        upload = await renderPdfPageToPngFile(file, p);
      } else {
        setErr("PDF se ještě načítá, počkej na počet stran.");
        setBusy(false);
        return;
      }

      const fd = new FormData();
      fd.append("file", upload);
      fd.append("page_no", String(metaPage));
      if (sourceUrl.trim()) fd.append("source_url", sourceUrl.trim());

      if (extractMode === "local") {
        // OCR (zdarma) -> Local LLM (Ollama) -> Lidl JSON schéma
        const extractRes = await fetch("/api/extract", {
          method: "POST",
          body: fd,
        });
        const extractData = await extractRes.json();
        if (!extractRes.ok) {
          const e = extractData as { error?: string; detail?: string };
          setErr(e.error || `HTTP ${extractRes.status}`);
          if (e.detail) setErr(`${e.error || ""} (${e.detail.slice(0, 200)})`.trim());
          return;
        }

        const extractedOffers = (extractData.offers ?? []) as ReviewOfferRow[];
        setOcrDump(extractData.ocr_raw ?? null);

        const blocks = extractedOffers.map((o) => ({
          page_no: metaPage,
          source_url: sourceUrl.trim() || null,
          text: (o.raw_text_block ?? o.extracted_name ?? "").toString(),
          price_total: o.price_total ?? null,
          currency: "CZK" as const,
        }));

        const normalizeRes = await fetch("/api/normalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks, page_no: metaPage, source_url: sourceUrl.trim() || null }),
        });
        const normalizeData = await normalizeRes.json() as {
          ok?: boolean;
          error?: string;
          detail?: string;
          offers?: ReviewOfferRow[];
          model?: string;
          raw_model_output?: string;
        };

        if (!normalizeRes.ok || !normalizeData.ok) {
          setErr(
            normalizeData.error ||
              `Normalize selhalo (HTTP ${normalizeRes.status})`
          );
          if (normalizeData.detail) {
            setErr(`${normalizeData.error} (${normalizeData.detail.slice(0, 200)})`);
          }
          if (normalizeData.raw_model_output) setRawOut(normalizeData.raw_model_output);
          return;
        }

        const normalizedOffers = (normalizeData.offers ?? []) as ReviewOfferRow[];
        // Zachovej OCR crop z /api/extract, aby bylo vidět "fotky/výřezy".
        const merged = normalizedOffers.map((o, i) => ({
          ...o,
          ocr_crop_bbox: extractedOffers[i]?.ocr_crop_bbox ?? null,
        }));

        setOffersByPage((prev) => ({ ...(prev ?? {}), [metaPage]: merged }));
        setRowStatusByPage((prev) => ({
          ...prev,
          [metaPage]: Object.fromEntries(merged.map((_, i) => [i, "pending" as const])) as Record<
            number,
            RowReviewStatus
          >,
        }));
        setModel(normalizeData.model ?? "ollama");
        if (normalizeData.raw_model_output) setRawOut(normalizeData.raw_model_output);
        return;
      }

      const endpoint =
        extractMode === "ocr" ? "/api/ocr-lidl-page" : "/api/parse-lidl-page";
      const res = await fetch(endpoint, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json()) as ApiSuccess | ApiErrorBody;

      if (!res.ok) {
        const e = data as ApiErrorBody;
        let msg = e.error || `HTTP ${res.status}`;
        if (e.validation_errors?.length) {
          msg += `: ${e.validation_errors.slice(0, 3).join("; ")}`;
        }
        if (e.detail && res.status !== 502) {
          msg += ` (${e.detail.slice(0, 200)})`;
        }
        setErr(msg);
        if (e.raw_model_output) setRawOut(e.raw_model_output);
        return;
      }

      const ok = data as ApiSuccess;
      if (ok.ok) {
        setOffersByPage((prev) => ({ ...(prev ?? {}), [metaPage]: ok.offers }));
        setRowStatusByPage((prev) => ({
          ...prev,
          [metaPage]: Object.fromEntries(ok.offers.map((_, i) => [i, "pending" as const])) as Record<
            number,
            RowReviewStatus
          >,
        }));
        setModel(ok.model);
        setOcrDump(ok.ocr_raw ?? null);
      }
    } catch {
      setErr("Síťová chyba nebo neplatná odpověď serveru.");
    } finally {
      setBusy(false);
    }
  }, [file, kind, pageNo, sourceUrl, pdfPageCount, extractMode]);

  const importManual = useCallback(async () => {
    const text = manualText.trim();
    if (!text) {
      setErr("Vlož semicolon CSV z Excelu nebo JSON pole produktů.");
      toast.warning("Chybí data pro import", "Vlož semicolon CSV nebo JSON pole produktů.");
      return;
    }
    setBusy(true);
    setErr(null);
    setRawOut(null);
    setOcrDump(null);
    try {
      const res = await fetch("/api/import-offers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await res.json()) as
        | { ok: true; offers: ReviewOfferRow[]; model?: string }
        | ApiErrorBody;
      if (!res.ok) {
        const e = data as ApiErrorBody;
        let msg = e.error || `HTTP ${res.status}`;
        if (e.validation_errors?.length) {
          msg += `: ${e.validation_errors.slice(0, 3).join("; ")}`;
        }
        setErr(msg);
        toast.error("Import selhal", msg.slice(0, 180));
        return;
      }
      const ok = data as { ok: true; offers: ReviewOfferRow[]; model?: string };
      const list = (ok.offers ?? []).slice();
      // Pokud import obsahuje více stran, zobraz jen aktuální stránku (pageNo).
      // Když uživatel stojí na jiné straně (např. 1) a import má jen page_no=3,
      // automaticky přepni pageNo na první dostupnou stránku, aby se něco zobrazilo.
      const pageNos = Array.from(
        new Set(list.map((o) => o.page_no).filter((n): n is number => typeof n === "number"))
      ).sort((a, b) => a - b);
      const anyHasPageNo = pageNos.length > 0;
      const targetPage = anyHasPageNo
        ? pageNos.includes(pageNo)
          ? pageNo
          : (pageNos[0] ?? pageNo)
        : pageNo;
      if (anyHasPageNo && targetPage !== pageNo) setPageNo(targetPage);
      const groups = new Map<number, ReviewOfferRow[]>();
      for (const o of list) {
        const p = typeof o.page_no === "number" ? o.page_no : targetPage;
        const arr = groups.get(p) ?? [];
        arr.push(o);
        groups.set(p, arr);
      }
      for (const [p, arr] of groups.entries()) {
        arr.sort((a, b) => {
          const an = (a.extracted_name ?? "").trim();
          const bn = (b.extracted_name ?? "").trim();
          if (!an && bn) return 1;
          if (an && !bn) return -1;
          return an.localeCompare(bn, "cs");
        });
      }
      setOffersByPage((prev) => ({ ...(prev ?? {}), ...Object.fromEntries(groups) }));
      setRowStatusByPage((prev) => {
        const next = { ...prev };
        for (const [p, arr] of groups.entries()) {
          next[p] =
            next[p] ??
            (Object.fromEntries(arr.map((_, i) => [i, "pending" as const])) as Record<
              number,
              RowReviewStatus
            >);
        }
        return next;
      });
      setModel(ok.model ?? "manual");
      toast.success("Import načten", `${list.length} položek připraveno ke kontrole.`);
    } catch {
      setErr("Síťová chyba nebo neplatná odpověď serveru.");
      toast.error("Import selhal", "Síťová chyba nebo neplatná odpověď serveru.");
    } finally {
      setBusy(false);
    }
  }, [manualText, pageNo, toast]);

  // Auto-import při příchodu z /upload (Excel/CSV) — aby uživatel viděl položky hned.
  useEffect(() => {
    if (kind !== "manual") return;
    if (!manualText.trim()) return;
    if (didAutoManualImportRef.current) return;
    const hasAnyOffers = !!(offersByPage && Object.keys(offersByPage).length);
    if (hasAnyOffers) return;
    didAutoManualImportRef.current = true;
    void importManual();
  }, [kind, manualText, offersByPage, importManual]);

  const commitApproved = useCallback(async () => {
    const approvedIndices = flat.offers
      .map((_, i) => i)
      .filter((i) => (flat.status[i] ?? "pending") === "approved");
    if (approvedIndices.length === 0) {
      setErr("Není co odeslat. Nejsou žádné schválené produkty.");
      return;
    }

    const validateApproved = (idx: number): ApprovedValidationIssue | null => {
      const o = flat.offers[idx] as any;
      if (!o) return { flatIndex: idx, name: "—", problems: ["missing_name"] };
      const problems: ApprovedValidationIssue["problems"] = [];
      const name = (o.extracted_name ?? "").toString().trim();
      if (!name) problems.push("missing_name");
      const price = o.price_total;
      if (price == null || !Number.isFinite(Number(price))) problems.push("missing_price");
      const store = (o.store_id ?? "").toString().trim();
      if (!store) problems.push("missing_store");
      const page = o.page_no;
      if (!(typeof page === "number" && Number.isFinite(page) && page >= 1)) problems.push("missing_page_no");

      const pu = (o.pack_unit ?? "").toString().trim().toLowerCase();
      const hasPackaging =
        o.pack_qty != null || o.pack_unit_qty != null || (o.pack_unit ?? "").toString().trim().length > 0;
      const explicitUnknown = pu === "unknown";
      if (!hasPackaging && !explicitUnknown) problems.push("missing_packaging_or_unknown");

      const hasBatchMeta = !!(sourceUrl.trim() || (fileName ?? "").toString().trim());
      if (!hasBatchMeta) problems.push("missing_batch_metadata");

      if (!problems.length) return null;
      return { flatIndex: idx, name: name || "—", problems };
    };

    const issues = approvedIndices.map(validateApproved).filter(Boolean) as ApprovedValidationIssue[];
    if (issues.length) {
      setPrecommitDialog({ issues, allowOverride: false });
      return;
    }

    const approvedOffers = approvedIndices.map((i) => flat.offers[i]!).filter(Boolean);
    const snapshotCounts = computeRowCounts(
      flat.offers.map((_, i) => i),
      flat.status
    );

    const exportedItems = approvedOffers.map((o) => ({
      page_no: (o as any).page_no ?? null,
      store_id: (o as any).store_id ?? null,
      source_type: (o as any).source_type ?? null,
      extracted_name: (o as any).extracted_name ?? null,
      price_total: (o as any).price_total ?? null,
      currency: (o as any).currency ?? null,
      has_loyalty_card_price: (o as any).has_loyalty_card_price ?? null,
      price_with_loyalty_card: (o as any).price_with_loyalty_card ?? null,
      notes: (o as any).notes ?? null,
      raw_text_block:
        typeof (o as any).raw_text_block === "string"
          ? String((o as any).raw_text_block).slice(0, 240)
          : null,
    }));

    const row_status = Object.fromEntries(
      approvedOffers.map((_, i) => [String(i), "approved" as const])
    ) as Record<number, "approved">;
    setCommitBusy(true);
    setCommitMsg(null);
    setErr(null);
    try {
      const res = await fetch("/api/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page_no: null,
          retailer: "lidl",
          source_url: sourceUrl.trim() || null,
          original_filename: fileName ?? null,
          actor: actorName.trim() || null,
          offers: approvedOffers,
          row_status,
        }),
      });
      const data = (await res.json()) as
        | {
            ok: true;
            batch_id: string;
            import_id: string | null;
            batch_no?: number | null;
            committed_approved: number;
            committed_raw_count?: number;
            committed_staging: number;
            quarantined: number;
            quarantined_count?: number;
            required_field_errors?: Array<{ index: number; problems: string[] }>;
            required_field_errors_count?: number;
            committed_at?: string;
            actor?: string | null;
          }
        | ApiErrorBody;
      if (!res.ok || !("ok" in data)) {
        const e = data as ApiErrorBody;
        const msg = e.detail
          ? `${e.error || `Commit selhal (HTTP ${res.status})`} (${String(e.detail).slice(0, 240)})`
          : (e.error || `Commit selhal (HTTP ${res.status})`);
        setErr(msg);
        toast.error("Import selhal", msg.slice(0, 160));

        // Lokální audit i pro neúspěšný commit (aby šlo dohledat co odešlo).
        try {
          const entry = {
            id:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : String(Date.now()),
            committed_at: new Date().toISOString(),
            actor: actorName.trim() || null,
            retailer: "lidl",
            source_url: sourceUrl.trim() || null,
            original_filename: fileName ?? null,
            page_no: pageNo,
            counts: {
              staging: approvedOffers.length,
              approved: snapshotCounts.approved,
              rejected: snapshotCounts.rejected,
              quarantined: snapshotCounts.quarantined,
              pending: snapshotCounts.pending,
            },
            batch_id: null,
            import_id: null,
            session_key: (() => {
              const qs = new URLSearchParams(window.location.search);
              const intakeId = (qs.get("intake_id") ?? "").trim();
              if (intakeId) return `intake:${intakeId}`;
              const sessionId = (qs.get("session_id") ?? "").trim();
              if (sessionId) return `manual:${sessionId}`;
              return null;
            })(),
            import_status: "error",
            http_status: res.status,
            db_error: msg,
            target_tables: ["imports", "offers_raw"],
            exported_items: exportedItems,
          };
          const raw = localStorage.getItem("leaflet_commit_log") ?? "[]";
          const arr = JSON.parse(raw) as any[];
          const next = Array.isArray(arr) ? [entry, ...arr].slice(0, 200) : [entry];
          localStorage.setItem("leaflet_commit_log", JSON.stringify(next));
        } catch {
          // ignore
        }
        return;
      }
      const ok = data as any;
      const rawCount = Number(ok.committed_raw_count ?? ok.committed_approved ?? 0);
      const quarantinedCount = Number(ok.quarantined_count ?? ok.quarantined ?? 0);
      setCommitMsg(
        `Uloženo: do DB ${rawCount}, do karantény ${quarantinedCount}, staging ${ok.committed_staging}${ok.committed_at ? ` (${ok.committed_at})` : ""}.`
      );
      const reqErrs = Array.isArray(ok.required_field_errors) ? ok.required_field_errors : [];
      if (reqErrs.length) {
        const labels: Record<string, string> = {
          missing_extracted_name: "chybí extracted_name",
          missing_price_total: "chybí price_total",
          bad_price_total: "price_total není číslo",
          bad_currency: "currency není CZK",
          missing_valid_to: "chybí valid_to",
        };
        const countsByProblem = reqErrs
          .flatMap((x: any) => (Array.isArray(x?.problems) ? (x.problems as string[]) : []))
          .reduce((acc: Record<string, number>, p: string) => {
            acc[p] = (acc[p] ?? 0) + 1;
            return acc;
          }, {});
        const topReasons = (Object.entries(countsByProblem) as Array<[string, number]>)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .slice(0, 3)
          .map(([k, n]) => `${labels[k] ?? k} (${n}×)`)
          .join(", ");
        toast.error(
          "Část položek šla do karantény",
          `DB: ${rawCount}, karanténa: ${quarantinedCount}. Důvody: ${topReasons || "chybějící povinná pole"}.`
        );
      } else {
        toast.success("Import do DB proběhl", `${rawCount} položek odesláno, karanténa ${quarantinedCount}.`);
      }

      // Lokální historie (dohledatelné i bez Supabase).
      try {
        const entry = {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : String(Date.now()),
          committed_at: ok.committed_at ?? new Date().toISOString(),
          actor: ok.actor ?? (actorName.trim() || null),
          retailer: "lidl",
          source_url: sourceUrl.trim() || null,
          original_filename: fileName ?? null,
          page_no: pageNo,
          counts: {
            staging: approvedOffers.length,
            approved: snapshotCounts.approved,
            rejected: snapshotCounts.rejected,
            quarantined: snapshotCounts.quarantined,
            pending: snapshotCounts.pending,
          },
          batch_id: ok.batch_id ?? null,
          import_id: ok.import_id ?? null,
          session_key: (() => {
            const qs = new URLSearchParams(window.location.search);
            const intakeId = (qs.get("intake_id") ?? "").trim();
            if (intakeId) return `intake:${intakeId}`;
            const sessionId = (qs.get("session_id") ?? "").trim();
            if (sessionId) return `manual:${sessionId}`;
            return null;
          })(),
          import_status: "ok",
          http_status: res.status,
          db_error: null,
          target_tables: ["imports", "offers_raw"],
          exported_items: exportedItems,
        };
        const raw = localStorage.getItem("leaflet_commit_log") ?? "[]";
        const arr = JSON.parse(raw) as any[];
        const next = Array.isArray(arr) ? [entry, ...arr].slice(0, 200) : [entry];
        localStorage.setItem("leaflet_commit_log", JSON.stringify(next));
      } catch {
        // ignore
      }
    } catch {
      setErr("Síťová chyba při commit.");
      toast.error("Import selhal", "Síťová chyba při commit.");
    } finally {
      setCommitBusy(false);
    }
  }, [flat, pageNo, sourceUrl, fileName, actorName, toast]);

  const dryRun = useMemo(() => {
    const approvedIndices = flat.offers
      .map((_, i) => i)
      .filter((i) => (flat.status[i] ?? "pending") === "approved");

    const validateApproved = (idx: number): ApprovedValidationIssue | null => {
      const o = flat.offers[idx] as any;
      if (!o) return { flatIndex: idx, name: "—", problems: ["missing_name"] };
      const problems: ApprovedValidationIssue["problems"] = [];
      const name = (o.extracted_name ?? "").toString().trim();
      if (!name) problems.push("missing_name");
      const price = o.price_total;
      if (price == null || !Number.isFinite(Number(price))) problems.push("missing_price");
      const store = (o.store_id ?? "").toString().trim();
      if (!store) problems.push("missing_store");
      const page = o.page_no;
      if (!(typeof page === "number" && Number.isFinite(page) && page >= 1)) problems.push("missing_page_no");
      const pu = (o.pack_unit ?? "").toString().trim().toLowerCase();
      const hasPackaging =
        o.pack_qty != null || o.pack_unit_qty != null || (o.pack_unit ?? "").toString().trim().length > 0;
      const explicitUnknown = pu === "unknown";
      if (!hasPackaging && !explicitUnknown) problems.push("missing_packaging_or_unknown");
      const hasBatchMeta = !!(sourceUrl.trim() || (fileName ?? "").toString().trim());
      if (!hasBatchMeta) problems.push("missing_batch_metadata");
      if (!problems.length) return null;
      return { flatIndex: idx, name: name || "—", problems };
    };

    const issues = approvedIndices.map(validateApproved).filter(Boolean) as ApprovedValidationIssue[];
    const approvedOffers = approvedIndices.map((i) => flat.offers[i]!).filter(Boolean) as any[];

    const row_status = Object.fromEntries(
      approvedOffers.map((_, i) => [String(i), "approved" as const])
    ) as Record<number, "approved">;

    const payload = {
      page_no: null as number | null,
      retailer: "lidl" as const,
      source_url: sourceUrl.trim() || null,
      original_filename: fileName ?? null,
      actor: actorName.trim() || null,
      offers: approvedOffers,
      row_status,
    };

    const offerKeys = (() => {
      const s = new Set<string>();
      for (const o of approvedOffers.slice(0, 50)) {
        for (const k of Object.keys(o ?? {})) s.add(k);
      }
      return Array.from(s).sort((a, b) => a.localeCompare(b, "cs"));
    })();

    return {
      approvedCount: approvedOffers.length,
      payload,
      topLevelKeys: Object.keys(payload),
      offerKeys,
      issues,
    };
  }, [flat.offers, flat.status, sourceUrl, fileName, actorName]);

  const applyPrecommitQuarantineAndContinue = useCallback(() => {
    if (!precommitDialog?.issues?.length) return;
    const indices = precommitDialog.issues.map((x) => x.flatIndex);
    // nastav status quarantine + důvod podle prvního problému
    setRowStatusByPage((prev) => {
      const next = { ...prev };
      for (const fi of indices) {
        const p = flat.ptr[fi];
        if (!p) continue;
        next[p.page] = { ...(next[p.page] ?? {}), [p.idx]: "quarantine" };
      }
      return next;
    });
    setRowReasonByPage((prev) => {
      const next = { ...prev };
      for (const it of precommitDialog.issues) {
        const fi = it.flatIndex;
        const p = flat.ptr[fi];
        if (!p) continue;
        const first = it.problems[0] ?? "missing_batch_metadata";
        const reason: RowReason =
          first === "missing_price"
            ? { kind: "quarantine", code: "missing_price", detail: null }
            : first === "missing_packaging_or_unknown"
              ? { kind: "quarantine", code: "missing_packaging", detail: null }
              : first === "missing_name"
                ? { kind: "quarantine", code: "unclear_name", detail: null }
                : { kind: "quarantine", code: "other", detail: first };
        next[p.page] = { ...(next[p.page] ?? {}), [p.idx]: reason };
      }
      return next;
    });
    setPrecommitDialog(null);
    // po přesunu do karantény commitni zbytek (po dalším renderu se přepočítá approved list)
    window.setTimeout(() => {
      void commitApproved();
    }, 0);
  }, [commitApproved, flat.ptr, precommitDialog]);

  const applyPrecommitOverride = useCallback(() => {
    setPrecommitDialog(null);
    void commitApproved();
  }, [commitApproved]);

  const redirectingToUpload = (!blobUrl || !kind) && kind !== "manual";

  const canExtract =
    kind !== "manual" &&
    file != null &&
    (kind === "image" || (kind === "pdf" && pdfPageCount != null && !pdfPreviewBusy));

  const goPrev = () => setPageNo((n) => Math.max(1, n - 1));
  const goNext = () =>
    setPageNo((n) =>
      pdfPageCount != null ? Math.min(pdfPageCount, n + 1) : n + 1
    );

  const pageImageSrc =
    kind === "manual" ? null : kind === "pdf" ? pdfPreviewUrl : blobUrl;

  const onRowStatus = (flatIndex: number, s: RowReviewStatus) => {
    const p = flat.ptr[flatIndex];
    if (!p) return;
    setRowStatusByPage((prev) => ({
      ...prev,
      [p.page]: { ...(prev[p.page] ?? {}), [p.idx]: s },
    }));
    if (s === "approved") toast.success("Položka schválena");
    else if (s === "rejected") toast.warning("Položka zamítnuta");
    else if (s === "quarantine") toast.warning("Položka přesunuta do karantény");
    if (s === "approved" || s === "pending") {
      // důvod nedává smysl mimo zamítnutí/karanténu
      setRowReasonByPage((prev) => {
        const existing = prev[p.page] ?? {};
        if (!(p.idx in existing)) return prev;
        const nextPage = { ...existing };
        delete nextPage[p.idx];
        return { ...prev, [p.page]: nextPage };
      });
    }
  };

  const requestRowStatus = useCallback(
    (indices: number[], s: RowReviewStatus) => {
      if (s !== "quarantine" && s !== "rejected") {
        for (const i of indices) onRowStatus(i, s);
        return;
      }
      const cleaned = Array.from(new Set(indices)).filter((x) => Number.isFinite(x));
      if (!cleaned.length) return;
      setReasonDialog({
        indices: cleaned,
        status: s,
        code: "",
        detail: "",
        err: null,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flat.ptr, rowStatusByPage]
  );

  const commitReasonDialog = useCallback(() => {
    if (!reasonDialog) return;
    const status = reasonDialog.status;
    const code = reasonDialog.code.trim();
    const detail = reasonDialog.detail.trim();
    if (!code) {
      setReasonDialog({ ...reasonDialog, err: "Vyber důvod." });
      return;
    }
    if (code === "other" && !detail) {
      setReasonDialog({ ...reasonDialog, err: "U „jiný důvod“ doplň krátký popis." });
      return;
    }

    const reason: RowReason =
      status === "quarantine"
        ? {
            kind: "quarantine",
            code: code as any,
            detail: detail || null,
          }
        : {
            kind: "rejected",
            code: code as any,
            detail: detail || null,
          };

    setRowStatusByPage((prev) => {
      const next = { ...prev };
      for (const fi of reasonDialog.indices) {
        const p = flat.ptr[fi];
        if (!p) continue;
        next[p.page] = { ...(next[p.page] ?? {}), [p.idx]: status };
      }
      return next;
    });
    setRowReasonByPage((prev) => {
      const next = { ...prev };
      for (const fi of reasonDialog.indices) {
        const p = flat.ptr[fi];
        if (!p) continue;
        next[p.page] = { ...(next[p.page] ?? {}), [p.idx]: reason };
      }
      return next;
    });
    setReasonDialog(null);
  }, [flat.ptr, reasonDialog]);

  const onApproveAllRows = (indices: number[]) => {
    if (!flat.offers.length) return;
    setRowStatusByPage((prev) => {
      const next = { ...prev };
      for (const fi of indices) {
        const p = flat.ptr[fi];
        if (!p) continue;
        next[p.page] = { ...(next[p.page] ?? {}), [p.idx]: "approved" };
      }
      return next;
    });
  };

  const bulkSetCategory = useCallback(
    (indices: number[], category: string | null) => {
      if (!indices.length) return;
      setOffersByPage((prev) => {
        const next = { ...(prev ?? {}) } as Record<number, ReviewOfferRow[]>;
        for (const fi of indices) {
          const p = flat.ptr[fi];
          if (!p) continue;
          const arr = (next[p.page] ?? []).slice();
          const cur = arr[p.idx];
          if (!cur) continue;
          arr[p.idx] = { ...cur, category: category };
          next[p.page] = arr;
        }
        return next;
      });
    },
    [flat.ptr]
  );

  const toggleFilter = (s: RowReviewStatus) => {
    setStatusFilter((prev) => (prev === s ? "all" : s));
  };

  return (
    <main className="mx-auto max-w-[1600px] space-y-8 pb-24">
      {redirectingToUpload ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <p className="font-semibold text-slate-900">Přesměrování na nahrání…</p>
          <p className="mt-1 text-slate-600">
            Chybí nahraný soubor. Pokud tě to nepřesměruje automaticky, otevři prosím stránku{" "}
            <a href="/upload" className="font-semibold text-indigo-700 underline">
              Nahrát
            </a>
            .
          </p>
        </div>
      ) : null}
      <div className="sticky top-14 z-30 -mx-4 border-b border-slate-200/90 bg-slate-50/95 px-4 py-3 backdrop-blur-md md:-mx-8 md:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
            {(
              [
                { id: "all", label: "Vše" },
                { id: "pending", label: "Ke kontrole" },
                { id: "approved", label: "Schváleno" },
                { id: "rejected", label: "Zamítnuto" },
                { id: "quarantine", label: "Karanténa" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTabInUrl(t.id)}
                className={`rounded-full px-3 py-1 ring-1 ring-slate-200 ${
                  tab === t.id
                    ? "bg-white font-semibold text-slate-900"
                    : "bg-slate-100 font-medium text-slate-700 hover:bg-slate-200/60"
                }`}
              >
                {t.label}
              </button>
            ))}
            <span className="ml-1 rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              Schváleno: <strong className="text-emerald-700">{reviewCounts.approved}</strong>
            </span>
            <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              Zamítnuto: <strong className="text-rose-700">{reviewCounts.rejected}</strong>
            </span>
            <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              Karanténa: <strong className="text-indigo-700">{reviewCounts.quarantined}</strong>
            </span>
            <span className="rounded-full bg-white px-3 py-1 font-medium text-slate-700 ring-1 ring-slate-200">
              Čeká: <strong className="text-amber-700">{reviewCounts.pending}</strong>
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              title="Zobrazí přesný payload, který se pošle do /api/commit"
              disabled={busy || !flat.offers.length}
              onClick={() => setDryRunOpen(true)}
              className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Zobrazit payload importu
            </button>
            <button
              type="button"
              title="Zapíše schválené do databáze (Supabase)"
              disabled={commitBusy || busy || !flat.offers.length}
              onClick={commitApproved}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {commitBusy ? "Odesílám…" : "Odeslat schválené do databáze →"}
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-slate-200">
            Audit: reviewed_at/imported_at se zapíše při commitu
          </span>
          <span
            className={
              saveIndicator.state === "saved"
                ? "rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 ring-1 ring-emerald-200/80"
                : saveIndicator.state === "saving"
                  ? "rounded-full bg-amber-50 px-2.5 py-1 font-semibold text-amber-900 ring-1 ring-amber-200/80"
                  : "rounded-full bg-rose-50 px-2.5 py-1 font-semibold text-rose-900 ring-1 ring-rose-200/80"
            }
            title={saveIndicator.detail ?? undefined}
          >
            {saveIndicator.state === "saved"
              ? `Uloženo${saveIndicator.at ? ` · ${new Date(saveIndicator.at).toLocaleTimeString("cs-CZ")}` : ""}`
              : saveIndicator.state === "saving"
                ? "Ukládá se…"
                : "Chyba ukládání"}
          </span>
          <label className="flex items-center gap-2">
            <span>Operátor</span>
            <input
              value={actorName}
              onChange={(e) => setActorName(e.target.value)}
              placeholder="např. Klára"
              className="w-40 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
            />
          </label>
        </div>
        {commitMsg ? (
          <p className="mt-2 text-sm font-medium text-emerald-700">{commitMsg}</p>
        ) : null}
      </div>

      <div>
        <Link
          href="/upload"
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          ← Zpět na nahrání
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
          Kontrola letáku
        </h1>
        <p className="mt-1 text-slate-600">
          <span className="font-semibold text-slate-800">{fileName}</span>
          {kind === "pdf" && pdfPageCount != null ? (
            <span> · PDF, {pdfPageCount} str.</span>
          ) : kind === "image" ? (
            <span> · obrázek</span>
          ) : null}
        </p>

        {offers && offers.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Stav", value: "Ke kontrole", accent: "text-amber-700" },
              { label: "Stránek (PDF)", value: String(pdfPageCount ?? 1) },
              { label: "Produktů (řádků)", value: String(offers.length) },
              {
                label: "Extrakce",
                value:
                  extractMode === "ocr"
                    ? "OCR"
                    : extractMode === "vision"
                      ? "Vision"
                      : "Local LLM (Ollama)",
              },
            ].map((c) => (
              <div
                key={c.label}
                className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-100"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {c.label}
                </p>
                <p
                  className={`mt-1 text-2xl font-semibold tabular-nums text-slate-900 ${"accent" in c ? c.accent : ""}`}
                >
                  {c.value}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 rounded-3xl border border-slate-200/90 bg-white p-5 shadow-sm ring-1 ring-slate-100">
          <label
            htmlFor="source-url"
            className="text-xs font-semibold uppercase tracking-wide text-slate-400"
          >
            Odkaz na leták (volitelné)
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="source-url"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
            />
            {sourceUrl.trim() ? (
              <a
                href={sourceUrl.trim()}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm font-semibold text-indigo-600 hover:underline"
              >
                Otevřít →
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {kind === "pdf" && pdfPageCount != null ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            disabled={pageNo <= 1}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
          >
            ⏮ Předchozí
          </button>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: Math.min(pdfPageCount, 24) }, (_, idx) => {
              const n = idx + 1;
              const active = n === pageNo;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPageNo(n)}
                  className={
                    active
                      ? "min-w-[2.25rem] rounded-xl bg-indigo-600 px-2 py-1.5 text-sm font-semibold text-white shadow-md"
                      : "min-w-[2.25rem] rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-600 hover:border-indigo-200"
                  }
                >
                  {n}
                </button>
              );
            })}
            {pdfPageCount > 24 ? (
              <span className="self-center px-1 text-xs text-slate-400">
                … +{pdfPageCount - 24}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={goNext}
            disabled={pageNo >= pdfPageCount}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-40"
          >
            Další ⏭
          </button>
        </div>
      ) : null}

      <section className="grid gap-8 xl:grid-cols-2 xl:items-start">
        <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Náhled stránky
            </p>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              Strana {pageNo} · Lidl CZ
            </span>
          </div>
          {kind === "manual" ? (
            <div className="flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
              Bez PDF náhledu (import z Excelu/ChatGPT).
            </div>
          ) : kind === "pdf" ? (
            pdfPreviewBusy ? (
              <div className="flex aspect-[3/4] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-sm text-slate-500">
                Vykresluji stránku…
              </div>
            ) : pdfPreviewErr ? (
              <p className="text-sm text-rose-600">{pdfPreviewErr}</p>
            ) : pdfPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pdfPreviewUrl}
                alt={`Stránka ${pageNo}`}
                className="max-h-[min(72vh,640px)] w-full rounded-2xl border border-slate-100 bg-slate-50 object-contain shadow-inner"
              />
            ) : null
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            blobUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={blobUrl}
                alt="Stránka"
                className="max-h-[min(72vh,640px)] w-full rounded-2xl border border-slate-100 bg-slate-50 object-contain shadow-inner"
              />
            ) : null
          )}
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-100">
            <div className="grid gap-3 lg:grid-cols-12 lg:items-end">
              <div className="lg:col-span-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Hledat (název / poznámka / značka)
                </label>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="např. kuře, jogurt, 1+1…"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="all">Vše</option>
                  <option value="pending">Ke kontrole</option>
                  <option value="approved">Schváleno</option>
                  <option value="rejected">Zamítnuto</option>
                  <option value="quarantine">Karanténa</option>
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Obchod
                </label>
                <select
                  value={filterStore}
                  onChange={(e) => setFilterStore(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="all">Vše</option>
                  {storeOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="lg:col-span-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Stránka
                </label>
                <select
                  value={filterPage}
                  onChange={(e) => setFilterPage(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="all">Vše</option>
                  {pageOptions.map((p) => (
                    <option key={p} value={String(p)}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyLoyalty}
                  onChange={(e) => setOnlyLoyalty(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Jen s loyalty cenou
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyNoPack}
                  onChange={(e) => setOnlyNoPack(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Jen bez balení
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyHasNote}
                  onChange={(e) => setOnlyHasNote(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Jen s poznámkou
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={onlyHasError}
                  onChange={(e) => setOnlyHasError(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                Jen s chybou
              </label>
              <button
                type="button"
                onClick={() => setStatusFilterInUrl("quarantine")}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800 ring-1 ring-indigo-200/70"
              >
                Jen karanténa
              </button>
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setFilterStore("all");
                  setFilterPage("all");
                  setOnlyLoyalty(false);
                  setOnlyNoPack(false);
                  setOnlyHasNote(false);
                  setOnlyHasError(false);
                  setStatusFilterInUrl("all");
                }}
                className="text-xs font-semibold text-slate-600 hover:underline"
              >
                Reset filtrů
              </button>
              <span className="ml-auto rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                Zobrazeno: {visibleIndices.length} / {flat.offers.length}
              </span>
              {listEmptyState === "filtered_out" ? (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-200/80">
                  Data existují, ale aktuální filtr nic nevrací
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
            {flat.offers.length ? (
              <ProductReviewCards
                offers={flat.offers}
                pageImageSrc={pageImageSrc ?? undefined}
                onEdit={(i) => {
                  setEditIndex(i);
                  const p = flat.ptr[i];
                  if (p) setFocusInUrl({ page: p.page, idx: p.idx });
                }}
                disabled={busy}
                rowStatus={flat.status}
                rowReason={flat.reason}
                onRowStatus={onRowStatus}
                onRequestRowStatus={requestRowStatus}
                onBulkSetCategory={bulkSetCategory}
                onApproveAll={onApproveAllRows}
                // Důležité: filtrujeme jen přes `visibleIndices`, aby se položky
                // po změně statusu "neztratily" kvůli dvojité filtraci.
                filterStatus="all"
                visibleIndices={visibleIndices}
              />
            ) : (
              <p className="text-sm text-slate-500">
                Po extrakci se zobrazí produktové karty s cenami a výřezy (OCR).
              </p>
            )}
          </div>

          <details className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm ring-1 ring-slate-100">
            <summary className="cursor-pointer select-none text-sm font-semibold text-slate-800">
              Nastavení & debug (extrakce, ruční import, OCR výstupy)
            </summary>

            <div className="mt-5 space-y-6">
              <div className="rounded-3xl border border-slate-200/90 bg-white p-6 shadow-[0_12px_48px_rgba(15,23,42,0.06)] ring-1 ring-slate-100">
                <h2 className="text-base font-semibold text-slate-900">Extrakce</h2>
                <div className="mt-4 flex flex-wrap gap-6 text-sm">
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="extract-mode"
                      checked={extractMode === "ocr"}
                      onChange={() => setExtractMode("ocr")}
                      className="text-indigo-600"
                    />
                    <span className="text-slate-800">
                      <strong className="text-indigo-700">OCR</strong> — bez AI
                    </span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="extract-mode"
                      checked={extractMode === "vision"}
                      onChange={() => setExtractMode("vision")}
                      className="text-indigo-600"
                    />
                    <span className="text-slate-800">
                      <strong className="text-violet-700">Vision API</strong>
                    </span>
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="extract-mode"
                      checked={extractMode === "local"}
                      onChange={() => setExtractMode("local")}
                      className="text-emerald-600"
                    />
                    <span className="text-slate-800">
                      <strong className="text-emerald-700">Local LLM (Ollama)</strong> — zdarma offline
                    </span>
                  </label>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-500">
                  {extractMode === "ocr"
                    ? "Tesseract + kotvy cen. Bez API klíče."
                    : extractMode === "vision"
                      ? "OpenAI / Gemini dle .env — bez klíče ukázková data."
                      : "OCR bloky → Ollama normalizace do tvého JSON schématu."}
                </p>

                <div className="mt-5 flex flex-wrap items-end gap-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Číslo stránky
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={pdfPageCount ?? undefined}
                      value={pageNo}
                      onChange={(e) => {
                        const v = Number(e.target.value) || 1;
                        const max = pdfPageCount ?? v;
                        setPageNo(Math.min(Math.max(1, v), max));
                      }}
                      className="mt-1 w-24 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={!canExtract || busy}
                    onClick={runExtract}
                    className="rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:from-indigo-500 hover:to-violet-500 disabled:opacity-50"
                  >
                    {busy
                      ? "Zpracovávám…"
                      : extractMode === "ocr"
                        ? "Spustit OCR"
                        : extractMode === "vision"
                          ? "Spustit vision"
                          : "Spustit Ollama"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      clear();
                      router.push("/upload");
                    }}
                    className="text-sm font-medium text-indigo-600 hover:underline"
                  >
                    Změnit soubor
                  </button>
                </div>

                {kind === "pdf" && pdfPageCount == null && !pdfPreviewErr ? (
                  <p className="mt-3 text-sm text-slate-500">Načítám PDF…</p>
                ) : null}

                {err ? (
                  <div
                    className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
                    role="alert"
                  >
                    {err}
                  </div>
                ) : null}
                {model ? <p className="mt-3 text-xs text-slate-400">Zdroj: {model}</p> : null}
              </div>

              <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm ring-1 ring-slate-100">
                <div className="border-b border-slate-200 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-900 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-white/80">
                      Ruční import (fallback)
                    </p>
                    <div className="flex flex-wrap gap-1.5 text-[11px]">
                      <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/85 ring-1 ring-white/15">
                        Soubor: {fileName}
                      </span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/85 ring-1 ring-white/15">
                        Strana: {pageNo}
                        {kind === "pdf" && pdfPageCount != null ? ` / ${pdfPageCount}` : ""}
                      </span>
                      <span className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-white/85 ring-1 ring-white/15">
                        Režim: {extractMode === "ocr" ? "OCR" : extractMode === "vision" ? "Vision" : "Local LLM"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50/60 p-4">
                  <p className="text-sm text-slate-700">
                    Vlož semicolon CSV z Excelu (hlavička + řádky), nebo JSON pole. Po importu se řádky zobrazí vpravo jako karty ke schválení.
                  </p>
                  <textarea
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder={`store_id;source_type;page_no;...;raw_text_block\nlidl;leaflet;3;null;...`}
                    className="mt-3 h-32 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-[12px] leading-relaxed text-slate-800 shadow-inner outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={importManual}
                        disabled={busy}
                        className="rounded-2xl bg-gradient-to-r from-slate-900 to-indigo-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/10 transition hover:from-slate-800 hover:to-indigo-800 disabled:opacity-50"
                      >
                        {busy ? "Importuji…" : "Vytvořit produkty ke schválení"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setManualText("")}
                        disabled={busy}
                        className="text-sm font-medium text-slate-600 hover:underline disabled:opacity-50"
                      >
                        Vymazat
                      </button>
                    </div>
                    <p className="text-xs text-slate-500">Tip: klidně vlož celý blok včetně hlavičky.</p>
                  </div>
                </div>
              </div>

              {ocrDump ? (
                <details className="rounded-3xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <summary className="cursor-pointer font-medium text-slate-700">
                    Raw OCR ({ocrDump.word_count} slov)
                  </summary>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-500">
                    {JSON.stringify(
                      {
                        price_anchors: ocrDump.price_anchors,
                        words_sample: ocrDump.words.slice(0, 120),
                      },
                      null,
                      2
                    )}
                  </pre>
                </details>
              ) : null}

              {rawOut ? (
                <details className="rounded-3xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
                  <summary className="cursor-pointer font-medium text-slate-700">Surový výstup modelu</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-500">
                    {rawOut}
                  </pre>
                </details>
              ) : null}
            </div>
          </details>
        </div>
      </section>

      <EditProductSheet
        open={editIndex != null}
        offer={editIndex != null ? flat.offers[editIndex]! : null}
        onClose={() => {
          setEditIndex(null);
          setFocusInUrl(null);
        }}
        onSave={(patch) => {
          if (editIndex == null) return;
          const p = flat.ptr[editIndex];
          if (!p) return;
          setOffersByPage((prev) => {
            const next = { ...(prev ?? {}) };
            const arr = (next[p.page] ?? []).slice();
            if (!arr[p.idx]) return next;
            arr[p.idx] = { ...arr[p.idx]!, ...patch };
            next[p.page] = arr;
            return next;
          });
        }}
      />

      {reasonDialog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.35)]">
            <div className="border-b border-slate-200 px-6 py-4">
              <p className="text-sm font-semibold text-slate-900">
                {reasonDialog.status === "quarantine" ? "Důvod karantény" : "Důvod zamítnutí"}{" "}
                <span className="text-slate-500">({reasonDialog.indices.length}×)</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Cíl: ať víme <strong>proč</strong> položky padají (ne jen kolik).
              </p>
            </div>
            <div className="space-y-3 px-6 py-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Důvod
                </label>
                <select
                  value={reasonDialog.code}
                  onChange={(e) =>
                    setReasonDialog((prev) =>
                      prev ? { ...prev, code: e.target.value, err: null } : prev
                    )
                  }
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                >
                  <option value="">— vyber —</option>
                  {reasonDialog.status === "quarantine" ? (
                    <>
                      <option value="missing_price">chybí cena</option>
                      <option value="missing_packaging">chybí balení</option>
                      <option value="unclear_name">nejasný název</option>
                      <option value="suspicious_ocr">podezřelá OCR extrakce</option>
                      <option value="duplicate">duplicita</option>
                      <option value="other">jiný důvod</option>
                    </>
                  ) : (
                    <>
                      <option value="not_a_product">není to produkt</option>
                      <option value="bad_block">špatně rozpoznaný blok</option>
                      <option value="duplicate_row">duplicitní řádek</option>
                      <option value="nonsense_price">nesmyslná cena</option>
                      <option value="other">jiný důvod</option>
                    </>
                  )}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Poznámka (volitelné)
                </label>
                <input
                  value={reasonDialog.detail}
                  onChange={(e) =>
                    setReasonDialog((prev) =>
                      prev ? { ...prev, detail: e.target.value, err: null } : prev
                    )
                  }
                  placeholder="např. špatně přečtené '39-99', chybí jednotka, …"
                  className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20"
                />
                <p className="mt-1 text-xs text-slate-500">
                  U „jiný důvod“ je poznámka povinná.
                </p>
              </div>
              {reasonDialog.err ? (
                <p className="text-sm font-medium text-rose-700">{reasonDialog.err}</p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setReasonDialog(null)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Zrušit
              </button>
              <button
                type="button"
                onClick={commitReasonDialog}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Uložit důvod
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {precommitDialog ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.35)]">
            <div className="border-b border-slate-200 px-6 py-4">
              <p className="text-sm font-semibold text-slate-900">
                Validace před importem do DB
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Některé <strong>schválené</strong> položky nejsou kvalitní. Nechceš je poslat do DB bez rozhodnutí.
              </p>
            </div>
            <div className="px-6 py-4 space-y-3">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Nalezeno problémů u <strong>{precommitDialog.issues.length}</strong> položek.
              </div>
              <div className="max-h-64 overflow-auto rounded-2xl border border-slate-200">
                <ul className="divide-y divide-slate-100">
                  {precommitDialog.issues.slice(0, 80).map((it) => (
                    <li key={it.flatIndex} className="px-4 py-3 text-sm">
                      <p className="font-semibold text-slate-900">
                        {it.name}
                        <span className="ml-2 text-xs font-medium text-slate-500">
                          (#{it.flatIndex + 1})
                        </span>
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Chybí / problém:{" "}
                        <span className="font-semibold text-slate-700">
                          {it.problems.join(", ")}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
              {precommitDialog.issues.length > 80 ? (
                <p className="text-xs text-slate-500">Zobrazuju prvních 80 (kvůli výkonu).</p>
              ) : null}

              <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={precommitDialog.allowOverride}
                  onChange={(e) =>
                    setPrecommitDialog((prev) => (prev ? { ...prev, allowOverride: e.target.checked } : prev))
                  }
                  className="rounded border-slate-300 text-indigo-600"
                />
                Chci commitnout i přesto (rozumím riziku)
              </label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setPrecommitDialog(null)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Zrušit
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={applyPrecommitQuarantineAndContinue}
                  className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100"
                >
                  Přesunout nevalidní do karantény a pokračovat
                </button>
                <button
                  type="button"
                  disabled={!precommitDialog.allowOverride}
                  onClick={applyPrecommitOverride}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Commitnout i přesto
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {dryRunOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-4xl rounded-3xl border border-slate-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.35)]">
            <div className="border-b border-slate-200 px-6 py-4">
              <p className="text-sm font-semibold text-slate-900">Dry run import</p>
              <p className="mt-1 text-sm text-slate-600">
                Kontrola před commitem: co přesně se pošle do <code>/api/commit</code>.
              </p>
            </div>
            <div className="space-y-4 px-6 py-4">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-800 ring-1 ring-slate-200">
                  Do DB půjde: {dryRun.approvedCount}
                </span>
                <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200">
                  Pole payloadu: {dryRun.topLevelKeys.join(", ")}
                </span>
                <span className="rounded-full bg-white px-3 py-1 font-semibold text-slate-700 ring-1 ring-slate-200">
                  Pole položek (vzorek): {dryRun.offerKeys.length}
                </span>
                {dryRun.issues.length ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-950 ring-1 ring-amber-200/80">
                    Chyby validace: {dryRun.issues.length}
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-50 px-3 py-1 font-semibold text-emerald-900 ring-1 ring-emerald-200/80">
                    Validace OK
                  </span>
                )}
              </div>

              {dryRun.issues.length ? (
                <details className="rounded-3xl border border-amber-200 bg-amber-50/60 px-5 py-4 text-sm">
                  <summary className="cursor-pointer font-semibold text-amber-950">
                    Zobrazit chyby validace
                  </summary>
                  <ul className="mt-3 space-y-2 text-xs text-amber-950">
                    {dryRun.issues.slice(0, 50).map((it) => (
                      <li key={it.flatIndex}>
                        <strong>{it.name}</strong> — {it.problems.join(", ")}
                      </li>
                    ))}
                  </ul>
                  {dryRun.issues.length > 50 ? (
                    <p className="mt-2 text-[11px] text-amber-900">
                      Zobrazuju prvních 50 (kvůli výkonu).
                    </p>
                  ) : null}
                </details>
              ) : null}

              <details className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-800">
                  Jaká pole se pošlou
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Payload (top-level)
                    </p>
                    <p className="mt-2 text-xs text-slate-800">
                      {dryRun.topLevelKeys.join(", ")}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Offers (klíče z prvních 50)
                    </p>
                    <p className="mt-2 text-xs text-slate-800">
                      {dryRun.offerKeys.join(", ")}
                    </p>
                  </div>
                </div>
              </details>

              <details className="rounded-3xl border border-slate-200 bg-slate-50/60 px-5 py-4 text-sm">
                <summary className="cursor-pointer font-semibold text-slate-800">
                  JSON payload (náhled)
                </summary>
                <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-all text-xs text-slate-700">
                  {JSON.stringify(
                    {
                      ...dryRun.payload,
                      offers: Array.isArray((dryRun.payload as any).offers)
                        ? (dryRun.payload as any).offers.slice(0, 20)
                        : [],
                    },
                    null,
                    2
                  )}
                </pre>
                {dryRun.approvedCount > 20 ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Zobrazuju prvních 20 položek (kvůli výkonu).
                  </p>
                ) : null}
              </details>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button
                type="button"
                onClick={() => setDryRunOpen(false)}
                className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Zavřít
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
