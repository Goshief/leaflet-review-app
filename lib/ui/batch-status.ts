import type { ImportBatchStatus } from "@/lib/db/types";

const LABELS: Record<ImportBatchStatus, string> = {
  uploaded: "Nahráno",
  processing: "Zpracovává se",
  review: "Ke kontrole",
  imported: "Importováno",
  error: "Chyba",
};

export function batchStatusLabel(status: string): string {
  return LABELS[status as ImportBatchStatus] ?? status;
}
