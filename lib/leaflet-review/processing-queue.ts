export type PendingLeafletDocument = {
  id: string;
  retailer_id: string;
  storage_bucket: string;
  storage_path: string;
  source_url: string | null;
  valid_to: string | null;
  processing_status: string;
  updated_at: string | null;
  created_at: string;
};

export function isPendingLeafletDocument(
  doc: PendingLeafletDocument,
  today: string,
  staleBefore: string,
): boolean {
  if (!doc.id || !doc.retailer_id || doc.storage_bucket !== "leaflet-intake") return false;
  if (!doc.storage_path.toLowerCase().endsWith(".pdf")) return false;
  if (doc.storage_path.toLowerCase().includes("remote-catalog-")) return false;
  if (!doc.valid_to || doc.valid_to < today) return false;
  if (doc.processing_status === "downloaded") return true;
  return doc.processing_status === "processing"
    && !!doc.updated_at
    && doc.updated_at < staleBefore;
}

export function selectNextPendingLeaflet(
  docs: PendingLeafletDocument[],
  today: string,
  staleBefore: string,
): PendingLeafletDocument | null {
  return docs
    .filter((doc) => isPendingLeafletDocument(doc, today, staleBefore))
    .sort((a, b) => a.valid_to!.localeCompare(b.valid_to!)
      || a.created_at.localeCompare(b.created_at))[0] ?? null;
}

export type LeafletValidityEvidence = {
  from: string | null;
  to: string | null;
  source: string | null;
};

export function preserveCatalogValidity(
  extracted: LeafletValidityEvidence,
  stored: { from: string | null; to: string | null },
): LeafletValidityEvidence {
  return {
    from: extracted.from ?? stored.from,
    to: extracted.to ?? stored.to,
    source: extracted.source ?? (stored.from || stored.to ? "catalog_metadata" : null),
  };
}
