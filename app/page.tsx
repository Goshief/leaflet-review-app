import { HomeDashboard } from "@/components/dashboard/home-dashboard";
import { LocalDashboard } from "@/components/dashboard/local-dashboard";
import { getDashboardData } from "@/lib/dashboard/get-dashboard";

/** Dashboard se počítá v getDashboardData (unstable_cache); route může být cachovaná. */
export const revalidate = 30;

export default async function Home() {
  const d = await getDashboardData();
  if (d.ok && d.configured) {
    return (
      <HomeDashboard
        configured
        showDemoBadge
        hot_now={d.hot_now}
        alerts={d.alerts}
        today={d.today}
        trend_7d={d.trend_7d}
        trend_30d={d.trend_30d}
        dominance_inserted={d.dominance_inserted}
        dominance_approved={d.dominance_approved}
        dominance_quarantined={d.dominance_quarantined}
        quality_by_retailer={d.quality_by_retailer}
        quarantine_reasons={d.quarantine_reasons}
        problem_batches={d.problem_batches}
        activity={d.activity}
      />
    );
  }

  // Bez Supabase: reálná lokální čísla z localStorage (commit historie).
  return <LocalDashboard />;
}

