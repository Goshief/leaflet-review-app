import { UploadForm } from "@/components/leaflet/upload-form";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Nahrát nový leták
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
        Nahraj <strong className="font-semibold text-slate-800">PDF celého letáku</strong>{" "}
        nebo <strong className="font-semibold text-slate-800">obrázek</strong> stránky.
        V kontrole zvolíš <strong>OCR</strong> (bez AI) nebo <strong>vision API</strong>.
      </p>
      <div className="mt-10">
        <UploadForm />
      </div>
    </main>
  );
}
