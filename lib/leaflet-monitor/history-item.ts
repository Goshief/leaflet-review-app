export function historyItemFromDocument(d: any) {
  return {
    id: d.id,
    retailer: d.retailer_id,
    pdf: d.filename,
    created_at: d.created_at,
    updated_at: d.updated_at,
    status: d.processing_status,
    page_count: d.page_count,
    processed_pages: d.processed_pages,
    approved_count: d.approved_count,
    rejected_count: d.rejected_count,
    quarantine_count: d.quarantine_count,
    unreviewed_count: d.unreviewed_count,
    candidate_count: d.candidate_count,
    valid_from: d.valid_from,
    valid_to: d.valid_to,
    notification_status: d.notification_status,
  };
}
