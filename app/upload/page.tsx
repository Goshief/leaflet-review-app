import { UploadFormStorage } from "@/components/leaflet/upload-form-storage";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Nahrát nový leták
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
        Nahraj <strong className="font-semibold text-slate-800">PDF celého letáku</strong>{" "}
        nebo <strong className="font-semibold text-slate-800">obrázek</strong> stránky.
        Soubor se nahrává přímo do Supabase Storage, takže velké PDF nejde přes limit Vercelu.
      </p>
      <div className="mt-10">
        <UploadFormStorage />
      </div>
    </main>
  );
}
