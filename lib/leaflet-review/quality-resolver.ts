import type { ExtractedCandidate } from "./extractor";

const DESCRIPTOR_ONLY=/^(?:podestýlková|polotučný|speciál|ochucená|ochucený|ochucené|rané|vinné\s+bílé)$/i;
const GENERIC_ONLY=/^(?:balení|více\s+druhů|druhy|mix|kombo|plech)$/i;

export function applyCandidateQuality(candidate:ExtractedCandidate):ExtractedCandidate{
  const name=String(candidate.product_name??"").replace(/\s+/g," ").trim();
  const reasons:string[]=[];
  if(!name)reasons.push("missing_product_name");
  if(DESCRIPTOR_ONLY.test(name))reasons.push("descriptor_without_product_noun");
  if(GENERIC_ONLY.test(name))reasons.push("generic_or_packaging_name");
  if(reasons.length===0)return candidate;
  return{
    ...candidate,
    status:"quarantine",
    confidence:Math.min(Number(candidate.confidence??1),.2),
    review_reason:`Kontrola kvality: ${reasons.join(", ")}. Název produktu není dostatečně doložen.`,
    extraction_payload:{...candidate.extraction_payload,quality_gate:{pass:false,reasons}},
  };
}
