import { supabase } from "./supabase/client";

const BUCKET = "product-types";

/** Legacy keys v DB bez přípony (`butter`) → objekt `butter.png` v bucketu. Klíče s příponou (`foo.png`) beze změny. */
function normalizeStorageObjectPath(imageKey: string): string {
  const clean = imageKey
    .replace(/^\/+/, "")
    .replace(/^product-types\/+/, "");

  if (!clean) return "";

  if (/\.[a-z0-9]{2,12}$/i.test(clean)) return clean;
  return `${clean}.png`;
}

export function getProductTypeImageUrl(imageKey?: string | null) {
  if (!imageKey) return "/placeholder.png";

  const path = normalizeStorageObjectPath(imageKey);
  if (!path) return "/placeholder.png";

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function uploadProductTypeImage(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const base = file.name
    .replace(/\.[^/.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const fileName = `${base || "image"}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, file, {
      upsert: true,
      contentType: file.type || undefined,
    });

  if (error) throw error;
  return fileName;
}
