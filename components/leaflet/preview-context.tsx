"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LeafletKind = "pdf" | "image" | "manual" | null;

export type RetailerId = "lidl" | "kaufland" | "billa" | "albert" | "penny" | "other";

export type LeafletPreviewState = {
  file: File | null;
  fileName: string | null;
  blobUrl: string | null;
  kind: LeafletKind;
  manualImportText: string;
  retailer: RetailerId;
  sourceUrl: string;
  setRetailer: (id: RetailerId) => void;
  setSourceUrl: (url: string) => void;
  setFromFile: (file: File) => boolean;
  setManualImportText: (text: string) => void;
  startManualImport: (text: string) => void;
  clear: () => void;
};

const LeafletPreviewContext = createContext<LeafletPreviewState | null>(null);

export function LeafletPreviewProvider({ children }: { children: ReactNode }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [kind, setKind] = useState<LeafletKind>(null);
  const [manualImportText, setManualImportText] = useState("");
  const [retailer, setRetailer] = useState<RetailerId>("lidl");
  const [sourceUrl, setSourceUrl] = useState("");
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    blobUrlRef.current = blobUrl;
  }, [blobUrl]);

  useEffect(() => {
    return () => {
      const u = blobUrlRef.current;
      if (u) URL.revokeObjectURL(u);
    };
  }, []);

  const setFromFile = useCallback((f: File) => {
    const isPdf =
      f.type === "application/pdf" || /\.pdf$/i.test(f.name);
    const isImage = /^image\//.test(f.type);
    if (!isPdf && !isImage) return false;

    setManualImportText("");
    setFile(f);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setFileName(f.name);
    setKind(isPdf ? "pdf" : "image");
    return true;
  }, []);

  const startManualImport = useCallback((text: string) => {
    setFile(null);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFileName("Import (Excel/ChatGPT)");
    setKind("manual");
    setManualImportText(text);
  }, []);

  const clear = useCallback(() => {
    setFile(null);
    setBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setFileName(null);
    setKind(null);
    setManualImportText("");
  }, []);

  const value = useMemo(
    () => ({
      file,
      fileName,
      blobUrl,
      kind,
      manualImportText,
      retailer,
      sourceUrl,
      setRetailer,
      setSourceUrl,
      setFromFile,
      setManualImportText,
      startManualImport,
      clear,
    }),
    [
      file,
      fileName,
      blobUrl,
      kind,
      manualImportText,
      retailer,
      sourceUrl,
      setFromFile,
      startManualImport,
      clear,
    ]
  );

  return (
    <LeafletPreviewContext.Provider value={value}>
      {children}
    </LeafletPreviewContext.Provider>
  );
}

export function useLeafletPreview() {
  const ctx = useContext(LeafletPreviewContext);
  if (!ctx) {
    throw new Error("useLeafletPreview: chybí LeafletPreviewProvider");
  }
  return ctx;
}
