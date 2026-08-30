import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const CATALOG_SNAPSHOT_DIR = "public/catalog-exports";
export const CATALOG_SNAPSHOT_NAME = /^catalog-(?:all|[a-z0-9]+)-latest\.xlsx$/i;

export type CatalogSnapshotFile = {
  name: string;
  url: string;
  bytes: number;
  updatedAt: string;
};

export function catalogSnapshotDir() {
  return path.join(process.cwd(), CATALOG_SNAPSHOT_DIR);
}

export function isSafeSnapshotName(name: string) {
  return CATALOG_SNAPSHOT_NAME.test(name) && !name.includes("..") && !name.includes("/") && !name.includes("\\");
}

export async function writeCatalogSnapshot(name: string, xlsx: Buffer) {
  if (!isSafeSnapshotName(name)) throw new Error(`Unsafe catalog snapshot name: ${name}`);
  const dir = catalogSnapshotDir();
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), xlsx);
  return path.join(dir, name);
}

export async function listCatalogSnapshots(): Promise<CatalogSnapshotFile[]> {
  const dir = catalogSnapshotDir();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const files: CatalogSnapshotFile[] = [];
  for (const name of names) {
    if (!isSafeSnapshotName(name)) continue;
    const info = await stat(path.join(dir, name));
    if (!info.isFile()) continue;
    files.push({
      name,
      url: `/catalog-exports/${name}`,
      bytes: info.size,
      updatedAt: info.mtime.toISOString(),
    });
  }
  return files.sort((a, b) => {
    if (a.name.includes("-all-")) return -1;
    if (b.name.includes("-all-")) return 1;
    return a.name.localeCompare(b.name);
  });
}
