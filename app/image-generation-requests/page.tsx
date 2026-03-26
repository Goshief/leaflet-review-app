import { GenerationRequestsPanel } from "@/components/product-types/generation-requests-panel";
import { listGenerationRequests } from "@/lib/product-types/generation-request-route-logic";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function ImageGenerationRequestsPage() {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return (
      <main>
        <p className="text-sm text-amber-800">
          Supabase není nakonfigurované — nelze načíst queue požadavků.
        </p>
      </main>
    );
  }

  const result = await listGenerationRequests(supabase, 500);
  if (!result.ok) {
    return (
      <main>
        <p className="text-sm text-rose-800">{result.error}</p>
      </main>
    );
  }

  return (
    <main>
      <GenerationRequestsPanel initialRequests={result.requests} />
    </main>
  );
}

