"use client";

import { LeafletA4Viewer } from "@/components/leaflet/a4-viewer";
import { useLeafletPreview } from "@/components/leaflet/preview-context";
import { useRouter } from "next/navigation";
import { useRef } from "react";

export default function LetakA4Page() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const preview = useLeafletPreview();
  const router = useRouter();
  const file = preview.kind === "pdf" ? preview.file : null;

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Leták po stranách A4</h1>
          <p className="mt-2 max-w-3xl text-slate-600">
            Stejný režim jako u konkurence: PDF se rozloží na jednotlivé strany, listuješ šipkami
            a dole jsou náhledy. Čtení produktů zůstává naše — tlačítkem dole.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white"
        >
          {file ? "Otevřít jiné PDF" : "Otevřít PDF leták"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) preview.setFromFile(next);
          }}
        />
      </div>

      {file ? (
        <LeafletA4Viewer
          file={file}
          title={preview.fileName || file.name}
          onReadPage={(pageNo) => {
            sessionStorage.setItem("letak-page", String(pageNo));
            router.push("/review");
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const next = event.dataTransfer.files?.[0];
            if (next) preview.setFromFile(next);
          }}
          className="flex min-h-72 w-full flex-col items-center justify-center rounded-[2rem] border-2 border-dashed border-slate-300 bg-white text-slate-600"
        >
          <span className="text-lg font-bold text-slate-900">Přetáhni sem PDF leták</span>
          <span className="mt-2 text-sm">Rozloží se na A4 strany, jako na Cenito.</span>
        </button>
      )}
    </main>
  );
}
