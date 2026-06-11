const {
  BID_MODE_BID,
  BID_MODE_BUYOUT,
  BID_STRATEGY_DIRECT,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD,
  DEFAULT_MULTI_BID_MIN_PRICE
} = require('./domainConstants.cjs');
const {
  normalizeTaxType,
  taxIncludedToTaxExcluded
} = require('./priceRules.cjs');

function getMinBidIncrement(price) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

function getRequiredBidMaxPrice(currentPrice, bidCount) {
  const current = Number(currentPrice || 0);
  if (!Number.isFinite(current) || current <= 0) return 0;
  const count = Number(bidCount || 0);
  const increment = Number.isFinite(count) && count > 0 ? getMinBidIncrement(current) : 0;
  return Math.floor(current + increment);
}

function shouldSplitDirectBidByYahooLowPriceRule({ strategy, bidMode, currentPrice, submitMaxPrice, taxType }) {
  if (strategy !== BID_STRATEGY_DIRECT) return false;
  if (bidMode !== BID_MODE_BID) return false;
  const submitTaxExcluded = taxIncludedToTaxExcluded(submitMaxPrice, taxType);
  if (submitTaxExcluded <= YAHOO_LOW_PRICE_BID_LIMIT) return false;
  const currentTaxExcluded = Number(currentPrice || 0);
  if (!Number.isFinite(currentTaxExcluded) || currentTaxExcluded <= 0) return true;
  return currentTaxExcluded < YAHOO_LOW_PRICE_THRESHOLD;
}

function resolveBuyoutTaskPrices({ fetchedBuyoutPrice, submittedBuyoutPrice, inputMaxPrice, taxType }) {
  const resolvedTaxType = normalizeTaxType(taxType);
  const value = Number(fetchedBuyoutPrice || submittedBuyoutPrice || inputMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return { buyoutPrice: 0, userMaxPrice: 0, bidMaxPrice: 0 };
  }
  const buyoutPrice = Math.floor(value);
  if (resolvedTaxType === 'tax_included') {
    return {
      buyoutPrice,
      userMaxPrice: buyoutPrice,
      bidMaxPrice: taxIncludedToTaxExcluded(buyoutPrice, resolvedTaxType)
    };
  }
  return {
    buyoutPrice,
    userMaxPrice: buyoutPrice,
    bidMaxPrice: buyoutPrice
  };
}

module.exports = {
  BID_MODE_BID,
  BID_MODE_BUYOUT,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD,
  DEFAULT_MULTI_BID_MIN_PRICE,
  getMinBidIncrement,
  getRequiredBidMaxPrice,
  shouldSplitDirectBidByYahooLowPriceRule,
  resolveBuyoutTaskPrices
};
