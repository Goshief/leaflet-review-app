"use client";

import { useEffect } from "react";

export function RememberLastBatch({ importId }: { importId: string }) {
  useEffect(() => {
    try {
      localStorage.setItem(
        "leaflet_last_batch",
        JSON.stringify({ import_id: importId, at: new Date().toISOString() })
      );
    } catch {
      // ignore
    }
  }, [importId]);

  return null;
}

