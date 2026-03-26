import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` je čistě server-side (transakce v /api/commit) a Turbopack ho nemá bundlovat.
  serverExternalPackages: ["tesseract.js", "pg"],
  turbopack: {
    /** Izolace od jiných Next projektů v nadřazených složkách */
    root: process.cwd(),
  },
};

export default nextConfig;
