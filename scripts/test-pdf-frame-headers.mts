import assert from "node:assert/strict";
import { PDF_VIEWER_HEADERS, SECURITY_HEADERS } from "../lib/security/headers.ts";

const globalHeaders = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]));
const pdfHeaders = Object.fromEntries(PDF_VIEWER_HEADERS.map(({ key, value }) => [key, value]));
const effective = { ...globalHeaders, ...pdfHeaders };

assert.equal(globalHeaders["X-Frame-Options"], "DENY", "global UI remains non-frameable");
assert.match(globalHeaders["Content-Security-Policy"], /frame-ancestors 'none'/);
assert.equal(effective["X-Frame-Options"], "SAMEORIGIN", "PDF endpoint must override global DENY");
assert.match(effective["Content-Security-Policy"], /frame-ancestors 'self'/, "PDF endpoint must allow same-origin iframe");
assert.equal(effective["X-Content-Type-Options"], "nosniff");
assert.match(effective["Cache-Control"], /no-store/);

console.log("PASS PDF frame headers: global DENY preserved; PDF endpoint overrides to SAMEORIGIN/self only");
