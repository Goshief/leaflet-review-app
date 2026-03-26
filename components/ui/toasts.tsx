"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ToastKind = "success" | "info" | "warning" | "error";

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string | null;
  created_at: number;
  ttl_ms: number;
};

type ToastContextValue = {
  push: (t: Omit<Toast, "id" | "created_at"> & { id?: string; created_at?: number }) => void;
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

function id() {
  try {
    // eslint-disable-next-line no-undef
    return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  } catch {
    return String(Date.now());
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((t: Omit<Toast, "id" | "created_at"> & { id?: string; created_at?: number }) => {
    const toast: Toast = {
      id: t.id ?? id(),
      kind: t.kind,
      title: t.title,
      message: t.message ?? null,
      created_at: t.created_at ?? Date.now(),
      ttl_ms: t.ttl_ms ?? 2500,
    };
    setToasts((prev) => [toast, ...prev].slice(0, 6));
  }, []);

  const api = useMemo<ToastContextValue>(() => {
    return {
      push,
      success: (title, message) => push({ kind: "success", title, message, ttl_ms: 2200 }),
      info: (title, message) => push({ kind: "info", title, message, ttl_ms: 2600 }),
      warning: (title, message) => push({ kind: "warning", title, message, ttl_ms: 3200 }),
      error: (title, message) => push({ kind: "error", title, message, ttl_ms: 4200 }),
    };
  }, [push]);

  useEffect(() => {
    if (!toasts.length) return;
    const now = Date.now();
    const nextExp = Math.min(...toasts.map((t) => t.created_at + t.ttl_ms));
    const delay = Math.max(50, nextExp - now);
    const timer = window.setTimeout(() => {
      const ts = Date.now();
      setToasts((prev) => prev.filter((t) => t.created_at + t.ttl_ms > ts));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [toasts]);

  const dismiss = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed inset-x-0 top-16 z-[200] flex flex-col items-center gap-2 px-4 sm:top-4">
        {toasts.map((t) => {
          const cls =
            t.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : t.kind === "warning"
                ? "border-amber-200 bg-amber-50 text-amber-950"
                : t.kind === "error"
                  ? "border-rose-200 bg-rose-50 text-rose-950"
                  : "border-slate-200 bg-white text-slate-950";
          const dot =
            t.kind === "success"
              ? "bg-emerald-500"
              : t.kind === "warning"
                ? "bg-amber-400"
                : t.kind === "error"
                  ? "bg-rose-500"
                  : "bg-indigo-500";
          return (
            <div
              key={t.id}
              className={`w-full max-w-xl rounded-2xl border px-4 py-3 shadow-[0_12px_48px_rgba(15,23,42,0.12)] ${cls}`}
              role="status"
            >
              <div className="flex items-start gap-3">
                <span className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{t.title}</p>
                  {t.message ? <p className="mt-1 text-sm opacity-90">{t.message}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="rounded-xl px-2 py-1 text-sm font-semibold opacity-60 hover:opacity-100"
                  aria-label="Zavřít"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToasts() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used within ToastProvider");
  return ctx;
}

