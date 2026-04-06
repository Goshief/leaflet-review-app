import { QuarantineClient } from "@/components/quarantine/quarantine-client";
import { QuarantineListError } from "@/components/quarantine/quarantine-list-error";
import { QuarantineDbEmpty } from "@/components/quarantine/quarantine-db-empty";
import { QuarantineDbNotConfigured } from "@/components/quarantine/quarantine-db-not-configured";
import { listQuarantine } from "@/lib/quarantine/list-quarantine";
import { loadAdminDataSnapshot } from "@/lib/observability/data-snapshot";
import { countQuarantineOpenRows } from "@/lib/quarantine/quarantine-table-counts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function QuarantinePage() {
  const res = await listQuarantine();

  if (!res.ok && res.configured) {
    return <QuarantineListError message={res.error} />;
  }

  if (res.ok && res.configured) {
    if (res.items.length === 0) {
      return <QuarantineDbEmpty />;
    }

    let dbCounts: { open: number; total: number } | null = null;
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const [snap, openRes] = await Promise.all([
        loadAdminDataSnapshot(supabase),
        countQuarantineOpenRows(supabase),
      ]);
      if (snap.ok && openRes.ok) {
        dbCounts = {
          total: snap.snapshot.totals.quarantined_offers,
          open: openRes.open,
        };
      }
    }
    return <QuarantineClient items={res.items} dbCounts={dbCounts} />;
  }

  return <QuarantineDbNotConfigured message={res.message} />;
}
