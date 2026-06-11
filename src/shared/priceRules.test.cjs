const assert = require('assert');
const {
  normalizeTaxType,
  normalizeProductType,
  taxIncludedToTaxExcluded,
  taxExcludedToTaxIncluded,
  getDisplayPrice
} = require('./priceRules.cjs');

assert.equal(normalizeTaxType('tax_included'), 'tax_included');
assert.equal(normalizeTaxType('tax_zero'), 'tax_zero');
assert.equal(normalizeTaxType(''), 'tax_zero');
assert.equal(normalizeProductType('store', 'tax_zero'), 'store');
assert.equal(normalizeProductType('normal', 'tax_included'), 'normal');
assert.equal(normalizeProductType('', 'tax_included'), 'store');
assert.equal(normalizeProductType('', 'tax_zero'), 'normal');

assert.equal(taxIncludedToTaxExcluded(1000, 'tax_included'), 909);
assert.equal(taxIncludedToTaxExcluded(1100, 'tax_included'), 1000);
assert.equal(taxIncludedToTaxExcluded(11103, 'tax_included'), 10093);
assert.equal(taxIncludedToTaxExcluded(9, 'tax_included'), 9);
assert.equal(taxIncludedToTaxExcluded(1000, 'tax_zero'), 1000);

assert.equal(taxExcludedToTaxIncluded(1000, 'tax_included'), 1100);
assert.equal(taxExcludedToTaxIncluded(9, 'tax_included'), 9);
assert.equal(taxExcludedToTaxIncluded(1000, 'tax_zero'), 1000);

assert.equal(getDisplayPrice(5000, 'tax_included'), 5500);
assert.equal(getDisplayPrice(9, 'tax_included'), 9);
assert.equal(getDisplayPrice(5000, 'tax_zero'), 5000);

console.log('price rules tests passed');
