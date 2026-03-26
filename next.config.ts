import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `pg` je čistě server-side (transakce v /api/commit) a Turbopack ho nemá bundlovat.
  serverExternalPackages: ["tesseract.js", "pg"],
  /**
   * Vercel (Turbopack) občas při build trace omylem “sebere” celý projekt,
   * což vede k chybám typu “unexpected file in NFT list”.
   * .traineddata jsou velké binární soubory pro Tesseract a nemají být součástí
   * output file tracingu pro serverless/edge funkce.
   */
  outputFileTracingExcludes: {
    "*": ["**/*.traineddata"],
  },
};

export default nextConfig;
