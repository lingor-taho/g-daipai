# Website Bid Rate Design

## Goal

Add a user-facing RMB helper on the client submit page. The feature only converts RMB input into the existing JPY `max_price` submission value. It does not affect task storage semantics, Yahoo plugin bidding, won order sync, or admin settlement exchange-rate configuration.

## Rate Source

- Source: Bank of China foreign exchange page, `https://www.boc.cn/sourcedb/whpj/`.
- Currency row: JPY / `日元`.
- Base field: `现汇卖出价`, whose page unit is RMB per 100 foreign currency.
- Formula: `websiteRate = roundTo4(sourceCashSellRate / 100 + 0.002)`.
- Example: `4.2518 / 100 + 0.002 = 0.044518`, rounded to `0.0445`.

## Server Behavior

- Expose `GET /api/task/website-rate` for authenticated users.
- Keep an in-memory cache for 3 hours.
- If cache is valid, return it immediately.
- If cache is missing or expired, fetch the BOC page, parse the JPY cash sell rate, calculate the website rate, and cache it.
- Do not persist this rate in SQLite and do not reuse `exchange_config` or admin finance config.

## Client Behavior

- On submit page mount, check localStorage for a valid 3-hour website-rate cache.
- If missing or expired, request `GET /api/task/website-rate` in the background.
- JPY mode remains usable while rate loading fails or is pending.
- RMB mode is disabled until a valid rate is available.
- Currency switch defaults to JPY. Active currency is bold and dark red.

## Amount Rules

- JPY mode keeps the existing behavior.
- RMB mode converts the user's entered RMB to JPY with `Math.floor(rmb / websiteRate)` before calling existing bid-price helpers.
- Normal products also show actual bid now:
  - JPY: `实际出价：2,247日元`
  - RMB: `实际出价：100人民币 ≈2,247日元`
- Store tax-before products:
  - JPY: `实际出价：2,472日元`
  - RMB: `实际出价：110人民币 ≈2,472日元`
- Store tax-after products:
  - JPY: `实际出价：2,247日元`
  - RMB: `实际出价：100人民币 ≈2,247日元`

## Testing

- Unit-test BOC JPY row parsing, formula rounding, and cache TTL decisions.
- Unit-test RMB to JPY conversion and actual bid display calculations.
- Verify submit page build still succeeds.
