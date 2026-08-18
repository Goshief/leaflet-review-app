import { UploadFormStorage } from "@/components/leaflet/upload-form-storage";
import { LeafletMonitorPanel } from "@/components/leaflet/monitor-panel";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-7xl">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
        Nahrát nový leták
      </h1>
      <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-600">
        Automatika hlídá známé obchody a ruční upload zůstává jako záloha. PDF se nahrává přímo do Supabase Storage, takže velké soubory nejdou přes limit Vercelu.
      </p>

      <div className="mt-8">
        <LeafletMonitorPanel />
      </div>

      <div className="mx-auto mt-10 max-w-3xl">
        <UploadFormStorage />
      </div>
    </main>
  );
}
