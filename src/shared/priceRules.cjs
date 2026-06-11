const {
  TAX_TYPE_ZERO,
  TAX_TYPE_INCLUDED,
  PRODUCT_TYPE_NORMAL,
  PRODUCT_TYPE_STORE
} = require('./domainConstants.cjs');

function normalizeTaxType(value) {
  return value === TAX_TYPE_INCLUDED ? TAX_TYPE_INCLUDED : TAX_TYPE_ZERO;
}

function normalizeProductType(value, taxType) {
  if (value === PRODUCT_TYPE_STORE || value === PRODUCT_TYPE_NORMAL) return value;
  return normalizeTaxType(taxType) === TAX_TYPE_INCLUDED ? PRODUCT_TYPE_STORE : PRODUCT_TYPE_NORMAL;
}

function taxIncludedToTaxExcluded(value, taxType) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (normalizeTaxType(taxType) !== TAX_TYPE_INCLUDED || number < 10) return Math.floor(number);
  return Math.floor((number / 1.1) + 1e-6);
}

function taxExcludedToTaxIncluded(value, taxType) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  if (normalizeTaxType(taxType) !== TAX_TYPE_INCLUDED || number < 10) return Math.floor(number);
  return Math.floor(number * 1.1);
}

function getDisplayPrice(value, taxType) {
  return taxExcludedToTaxIncluded(value, taxType);
}

module.exports = {
  normalizeTaxType,
  normalizeProductType,
  taxIncludedToTaxExcluded,
  taxExcludedToTaxIncluded,
  getDisplayPrice
};
