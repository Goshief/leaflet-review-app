import assert from "node:assert/strict";
import { computePlanItem } from "../lib/shopper/planner.ts";

{
  const p = computePlanItem(
    { id: "ci1", requested_name: "Milk", quantity: 2 },
    [
      { id: "o2", extracted_name: "Milk", price_total: 30, store_id: "lidl" },
      { id: "o1", extracted_name: "Milk", price_total: 25, store_id: "billa" },
    ]
  );
  assert.equal(p.chosen_offer_id, "o1");
  assert.equal(p.baseline_total, 60);
  assert.equal(p.optimized_total, 50);
  assert.equal(p.savings_total, 10);
}

{
  const p = computePlanItem({ id: "ci2", requested_name: "Eggs", quantity: 1 }, []);
  assert.equal(p.chosen_offer_id, null);
  assert.equal(p.unavailable_reason, "no_committed_offer_match");
  assert.equal(p.optimized_total, null);
}

console.log("OK: shopper planner tests passed");
