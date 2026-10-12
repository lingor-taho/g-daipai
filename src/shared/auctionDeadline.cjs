function auctionEndMs(value) {
  const text = String(value || '').trim();
  if (!text) return NaN;
  // Yahoo timestamps without a zone use Japan time, independent of browser/server locale.
  const qualified = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(text);
  return Date.parse(text.replace(' ', 'T') + (qualified ? '' : '+09:00'));
}
function isAuctionEnded(value, nowMs = Date.now()) {
  const endMs = auctionEndMs(value);
  return Number.isFinite(endMs) && endMs < nowMs;
}
module.exports = { auctionEndMs, isAuctionEnded };
