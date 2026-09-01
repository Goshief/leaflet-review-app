import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogRetailerId, FetchedText } from "./types";

const RAW_BUCKET = "catalog-raw";

export type RawSourceKind = "robots" | "sitemap" | "product";

function safeSegment(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 100) || "unknown";
}

function extension(kind: RawSourceKind) {
  if (kind === "robots") return "txt";
  if (kind === "sitemap") return "xml";
  return "html";
}

function mime(kind: RawSourceKind, fetched: FetchedText) {
  if (fetched.contentType) return fetched.contentType.split(";")[0] || "text/plain";
  if (kind === "sitemap") return "application/xml";
  if (kind === "product") return "text/html";
  return "text/plain";
}

function duplicateStorageError(message: string) {
  return /already exists|duplicate|resource exists/i.test(message);
}

export async function saveRawSnapshot(
  supabase: SupabaseClient,
  args: {
    retailer: CatalogRetailerId;
    kind: RawSourceKind;
    externalId?: string | null;
    fetched: FetchedText;
  }
) {
  const sha256 = createHash("sha256").update(args.fetched.body).digest("hex");
  const identity = safeSegment(args.externalId || new URL(args.fetched.finalUrl).pathname || "index");
  const storagePath = `${args.retailer}/${args.kind}/${identity}/${sha256.slice(0, 24)}.${extension(args.kind)}`;
  const payload = new Blob([args.fetched.body], { type: mime(args.kind, args.fetched) });

  const { error: uploadError } = await supabase.storage.from(RAW_BUCKET).upload(storagePath, payload, {
    contentType: mime(args.kind, args.fetched),
    cacheControl: "31536000",
    upsert: false,
  });
  const unchangedRaw = Boolean(uploadError && duplicateStorageError(uploadError.message || ""));
  if (uploadError && !unchangedRaw) throw new Error(`catalog raw upload: ${uploadError.message}`);

  const row = {
    retailer_id: args.retailer,
    source_kind: args.kind,
    source_url: args.fetched.finalUrl,
    external_id: args.externalId ?? null,
    http_status: args.fetched.status,
    content_type: args.fetched.contentType || null,
    content_sha256: sha256,
    storage_bucket: RAW_BUCKET,
    storage_path: storagePath,
    fetched_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("catalog_fetches")
    .upsert(row, { onConflict: "retailer_id,source_url,content_sha256", ignoreDuplicates: false })
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(`catalog fetch persistence: ${error?.message || "missing id"}`);

  return {
    fetchId: String(data.id),
    sha256,
    storagePath,
    unchangedRaw,
  };
}
