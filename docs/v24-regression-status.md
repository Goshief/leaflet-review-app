# Leaflet extraction v24 regression gate

Before merging v24 into `main`, the following must pass:

- BILLA page 1 existing name extraction regression
- BILLA page 2 named products regression
- Promotional text is never emitted as `product_name`
- Approved/manual-reviewed candidates remain protected during reprocess
- Duplicate leaflet SHA never creates a second review document
- Lidl current leaflet yields candidates and duplicate-prevention remains active

The executable promotional-noise gate is `/api/leaflet-monitor/test-name-noise-v24`.
