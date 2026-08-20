import type { ExtractedCandidate } from "./extractor";

const GENERIC_VARIANT = /^(?:(?:více|různé|různých|\d+)\s+druh(?:y|ů)|druhy|mix)$/i;
const VERIFIED_DESCRIPTOR = /^(?:rané|vinné\s+bílé|ochucen(?:á|ý|é))$/i;
const LABELED_VARIANT = /^(?:varianta|příchuť|odrůda|druh)\s*[:\-]\s*(.+)$/i;

function clean(value:string){return value.replace(/\s+/g," ").trim();}
function sourceParts(candidate:ExtractedCandidate){return String(candidate.source_text??"").split("|").map(clean).filter(Boolean);}

export function resolveCandidateVariant(candidate:ExtractedCandidate):{value:string;raw:string}|null{
  const parts=sourceParts(candidate);
  for(const raw of parts){
    const labeled=raw.match(LABELED_VARIANT);
    if(labeled){
      const value=clean(labeled[1]??"");
      if(value && !GENERIC_VARIANT.test(value) && value.length<=60)return{value,raw};
    }
  }
  for(const raw of parts){
    if(GENERIC_VARIANT.test(raw))continue;
    if(VERIFIED_DESCRIPTOR.test(raw))return{value:raw,raw};
  }
  return null;
}

export function applyVariantEvidence(candidate:ExtractedCandidate):ExtractedCandidate{
  const found=resolveCandidateVariant(candidate);
  if(!found)return{...candidate,variant:null};
  return{
    ...candidate,
    variant:found.value,
    field_evidence:{...candidate.field_evidence,variant:{raw_text:found.raw,source:"product_block_text"}},
    extraction_payload:{...candidate.extraction_payload,variant_resolution:{source:"explicit_product_block_text",raw:found.raw,value:found.value}},
  };
}
