"use client";

import { LeafletPreviewProvider } from "@/components/leaflet/preview-context";
import { ToastProvider } from "@/components/ui/toasts";
import type { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <LeafletPreviewProvider>{children}</LeafletPreviewProvider>
    </ToastProvider>
  );
}
