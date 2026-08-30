/**
 * Declarative authorization matrix for Letáky Admin (point 04).
 *
 * Roles come only from getAuthenticatedActor() / app_metadata (point 03).
 * Proxy refreshes the session only; definitive checks run in page layouts
 * and each API Route Handler.
 */

export type AccessLevel = "public" | "operator" | "admin";

export type PageAccessRule = {
  /** URL path prefix or exact path (no trailing slash except `/`). */
  path: string;
  access: AccessLevel;
  /** Layout or page module that must call the matching require*Page guard. */
  guardModule: string;
};

export type ApiAccessRule = {
  /** Repo-relative Route Handler path. */
  file: string;
  /** Required access per exported HTTP method. */
  methods: Partial<Record<"GET" | "POST" | "PATCH" | "PUT" | "DELETE", AccessLevel>>;
};

/**
 * Public exceptions — proven public purpose from implementation:
 * - `/` Setrik shopper homepage (public offers UI)
 * - `/api/setrik/*` public comparison/search/smart-cart APIs
 * - `/api/auth/login` public login endpoint (same-origin + rate limited)
 * - `/login`, `/logout`, `/forbidden` auth UX (must not redirect-loop)
 */
export const PUBLIC_PAGE_PATHS = [
  "/",
  "/login",
  "/logout",
  "/forbidden",
] as const;

export const PAGE_ACCESS_MATRIX: PageAccessRule[] = [
  { path: "/upload", access: "operator", guardModule: "app/upload/layout.tsx" },
  { path: "/review", access: "operator", guardModule: "app/review/layout.tsx" },
  { path: "/batches", access: "operator", guardModule: "app/batches/layout.tsx" },
  { path: "/quarantine", access: "operator", guardModule: "app/quarantine/layout.tsx" },
  { path: "/history", access: "operator", guardModule: "app/history/layout.tsx" },
  { path: "/parsers", access: "operator", guardModule: "app/parsers/layout.tsx" },
  {
    path: "/product-types",
    access: "operator",
    guardModule: "app/product-types/layout.tsx",
  },
  {
    path: "/image-generation-requests",
    access: "operator",
    guardModule: "app/image-generation-requests/layout.tsx",
  },
  { path: "/settings", access: "admin", guardModule: "app/settings/layout.tsx" },
  { path: "/catalog", access: "operator", guardModule: "app/catalog/layout.tsx" },
];

export const API_ACCESS_MATRIX: ApiAccessRule[] = [
  { file: "app/api/auth/login/route.ts", methods: { GET: "public", POST: "public" } },
  { file: "app/api/commit/route.ts", methods: { POST: "operator" } },
  {
    file: "app/api/batches/item/route.ts",
    methods: { POST: "operator", PATCH: "operator" },
  },
  {
    file: "app/api/generation-request/route.ts",
    methods: { GET: "operator", POST: "operator", PATCH: "operator" },
  },
  { file: "app/api/quarantine/action/route.ts", methods: { POST: "operator" } },
  { file: "app/api/stats/route.ts", methods: { GET: "operator" } },
  { file: "app/api/intake/route.ts", methods: { POST: "operator" } },
  { file: "app/api/intake-file/route.ts", methods: { GET: "operator" } },
  { file: "app/api/extract/route.ts", methods: { POST: "operator" } },
  { file: "app/api/ocr-lidl-page/route.ts", methods: { POST: "operator" } },
  { file: "app/api/parse-lidl-page/route.ts", methods: { POST: "operator" } },
  { file: "app/api/normalize/route.ts", methods: { POST: "operator" } },
  { file: "app/api/import-offers/route.ts", methods: { POST: "operator" } },
  {
    file: "app/api/parser-prompt/route.ts",
    methods: { GET: "operator", POST: "admin" },
  },
  {
    file: "app/api/parser-prompts/route.ts",
    methods: { GET: "operator", POST: "admin" },
  },
  { file: "app/api/parser-test/route.ts", methods: { POST: "admin" } },
  { file: "app/api/setrik/offers/route.ts", methods: { GET: "public" } },
  { file: "app/api/setrik/retailers/route.ts", methods: { GET: "public" } },
  { file: "app/api/setrik/products/route.ts", methods: { GET: "public" } },
  { file: "app/api/setrik/products/[id]/route.ts", methods: { GET: "public" } },
  { file: "app/api/setrik/smart-cart/route.ts", methods: { POST: "public" } },
  { file: "app/api/setrik/smart-products/route.ts", methods: { GET: "public" } },
  { file: "app/api/setrik/smart-products/[id]/route.ts", methods: { GET: "public" } },
  { file: "app/api/catalog/export/route.ts", methods: { GET: "operator" } },
  { file: "app/logout/route.ts", methods: { POST: "public", GET: "public" } },
];

export function requiredApiAccess(
  file: string,
  method: string
): AccessLevel | null {
  const rule = API_ACCESS_MATRIX.find((r) => r.file === file);
  if (!rule) return null;
  const key = method.toUpperCase() as keyof ApiAccessRule["methods"];
  return rule.methods[key] ?? null;
}
