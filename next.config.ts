import type { NextConfig } from "next";
import path from "node:path";
import { SECURITY_HEADERS } from "./lib/security/headers";

// Deployment checkpoint: security recovery and upload fix verified 2026-08-16.
const nextConfig: NextConfig = {
  /**
   * Starý `public/product-types/gallery.html` jinak vyhrává nad App Routerem.
   * Rewrite běží před filesystemem — `/product-types/gallery.html` vždy obslouží stejnou stránku jako `/product-types/gallery`.
   */
  async rewrites() {
    return [
      {
        source: "/product-types/gallery.html",
        destination: "/product-types/gallery",
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS.map(({ key, value }) => ({ key, value })),
      },
      {
        source: "/product-types/gallery",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }],
      },
      {
        source: "/product-types/gallery.html",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" }],
      },
    ];
  },
  // Prevent Next/Turbopack from inferring a parent workspace root on machines
  // where multiple lockfiles exist above this app.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Ensure output file tracing stays within this app directory.
  outputFileTracingRoot: path.resolve(__dirname),
  // Server-side native/dynamic packages stay external so their runtime files are kept intact.
  // pdfjs-dist must stay external because its worker module is loaded dynamically at runtime.
  serverExternalPackages: ["tesseract.js", "pdfjs-dist", "pg"],
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
