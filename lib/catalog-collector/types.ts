export type CatalogRetailerId = "billa" | "teta" | "dm" | "lidl" | "rossmann" | "rohlik";

export type CatalogOffer = {
  price: number | null;
  regularPrice: number | null;
  loyaltyPrice: number | null;
  unitPrice: number | null;
  unitBasis: string | null;
  currency: string;
  available: boolean;
};

export type CatalogProduct = {
  retailerId: CatalogRetailerId;
  externalId: string;
  sourceUrl: string;
  name: string;
  brand: string | null;
  sku: string | null;
  gtin: string | null;
  quantityValue: number | null;
  quantityUnit: string | null;
  imageUrl: string | null;
  category: string | null;
  countryOfOrigin: string | null;
  metadata: Record<string, unknown>;
  offer: CatalogOffer;
};

export type FetchedText = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
};

export type CatalogRunStats = {
  retailer: CatalogRetailerId;
  discovered: number;
  attempted: number;
  saved: number;
  failed: number;
  unchangedRaw: number;
  startedAt: string;
  finishedAt: string;
  errors: Array<{ url: string; error: string }>;
};

export type CatalogAdapter = {
  retailer: CatalogRetailerId;
  hostPattern: RegExp;
  robotsUrl: string;
  sitemapUrl: string;
  robotsMustAllowPath: string;
  robotsDeniedMessage: string;
  productPath: RegExp;
  preferSitemapName?: RegExp;
  maxSitemaps?: number;
  concurrency?: number;
  delayMs?: number;
  parse: (html: string, sourceUrl: string) => CatalogProduct;
  externalIdFromUrl: (sourceUrl: string) => string | null;
};
