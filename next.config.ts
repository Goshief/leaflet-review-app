import type { NextConfig } from "next";
import path from "node:path";
import { PDF_VIEWER_HEADERS, SECURITY_HEADERS } from "./lib/security/headers";

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
        source: "/api/leaflet-monitor/pdf",
        headers: PDF_VIEWER_HEADERS.map(({ key, value }) => ({ key, value })),
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
  turbopack: {
    root: path.resolve(__dirname),
  },
  outputFileTracingRoot: path.resolve(__dirname),
  serverExternalPackages: ["tesseract.js", "pdfjs-dist", "pg"],
  // pdfjs-dist loads its worker dynamically on Node. Vercel tracing otherwise
  // omits it from the serverless function and runtime falls back to a missing fake worker.
  outputFileTracingIncludes: {
    "/api/leaflet-ai/process": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/pdfjs-dist/standard_fonts/**/*",
      "./node_modules/pdfjs-dist/cmaps/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "*": ["**/*.traineddata"],
  },
};

export default nextConfig;
