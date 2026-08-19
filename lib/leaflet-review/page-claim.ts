const DEFAULT_STALE_CLAIM_MS = 15 * 60 * 1000;

async function conditionalClaim(
  supabase: any,
  leafletId: string,
  pageNo: number,
  statuses: string[],
  staleBefore?: string,
): Promise<boolean> {
  let query = supabase
    .from("leaflet_page_processing")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("leaflet_id", leafletId)
    .eq("page_no", pageNo)
    .in("status", statuses);
  if (staleBefore) query = query.lt("updated_at", staleBefore);
  const { data, error } = await query.select("page_no");
  if (error) throw new Error(`page claim: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
}

export async function claimLeafletPage(
  supabase: any,
  leafletId: string,
  pageNo: number,
  force = false,
  staleClaimMs = DEFAULT_STALE_CLAIM_MS,
): Promise<boolean> {
  const allowedStatuses = force ? ["pending", "failed", "completed"] : ["pending", "failed"];
  if (await conditionalClaim(supabase, leafletId, pageNo, allowedStatuses)) return true;
  if (force) return false;

  const staleBefore = new Date(Date.now() - staleClaimMs).toISOString();
  return conditionalClaim(supabase, leafletId, pageNo, ["processing"], staleBefore);
}

export async function failLeafletPageClaim(
  supabase: any,
  leafletId: string,
  pageNo: number,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const { error: updateError } = await supabase
    .from("leaflet_page_processing")
    .update({
      status: "failed",
      processing_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })
    .eq("leaflet_id", leafletId)
    .eq("page_no", pageNo)
    .eq("status", "processing");
  if (updateError) throw new Error(`page claim cleanup: ${updateError.message}`);
}
