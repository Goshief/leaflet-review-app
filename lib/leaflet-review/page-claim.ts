export async function claimLeafletPage(
  supabase: any,
  leafletId: string,
  pageNo: number,
  force = false,
): Promise<boolean> {
  const allowedStatuses = force ? ["pending", "failed", "completed"] : ["pending", "failed"];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("leaflet_page_processing")
    .update({ status: "claimed", updated_at: now })
    .eq("leaflet_id", leafletId)
    .eq("page_no", pageNo)
    .in("status", allowedStatuses)
    .select("page_no");
  if (error) throw new Error(`page claim: ${error.message}`);
  return Array.isArray(data) && data.length === 1;
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
    .eq("status", "claimed");
  if (updateError) throw new Error(`page claim cleanup: ${updateError.message}`);
}
