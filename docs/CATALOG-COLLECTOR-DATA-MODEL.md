# Catalog collector data model

`catalog_sources` defines retailer source metadata. `catalog_discovered_urls` is the crawl queue. `catalog_fetches` points to content-addressed RAW snapshots in private Storage. `retailer_products` stores the retailer-native normalized product. `retailer_offers_current` stores the latest observed price/availability. `retailer_price_observations` stores one daily observation per retailer product for price history. `catalog_collector_runs` stores operational statistics.

Cross-retailer canonical matching is intentionally not part of this first collector migration. It should be built as a separate layer on top of stable retailer-native identities, preferring GTIN/EAN where available.
