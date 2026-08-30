import assert from "node:assert/strict";
import { parseProductHtml } from "../lib/catalog/collector.ts";

const html=`<html><head><title>Test</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Ajax 1 l","sku":"A-1","gtin13":"1234567890123","brand":{"@type":"Brand","name":"Ajax"},"image":"/ajax.jpg","offers":{"@type":"Offer","price":"29,90","priceCurrency":"CZK","availability":"https://schema.org/InStock"}}</script></head></html>`;
const result=parseProductHtml(html,"https://shop.example/product/ajax");
assert.equal(result.product.name,"Ajax 1 l");assert.equal(result.product.price,29.9);assert.equal(result.product.brand,"Ajax");assert.equal(result.product.image_source_url,"https://shop.example/ajax.jpg");assert.equal(result.product.availability,"InStock");
console.log("catalog collector: OK");
