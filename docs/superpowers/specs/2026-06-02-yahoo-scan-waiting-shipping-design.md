# Yahoo Scan Waiting Shipping Design

Last updated: 2026-06-02

## Goal

Implement the concrete `scan` idle action for orders in `waiting_shipping` status. This work must reuse the existing idle action pipeline:

`A bidding sync -> B won sync -> C transaction start -> D scan -> E payment -> F receipt`

No separate scan loop, immediate execution path, or alternate scheduler is added. Manual scan execution only changes the existing scan counter/flag so the current `/api/plugin/idle-action/next` logic naturally returns `action: 'scan'`.

## Scope

This first scan implementation only handles:

- `orders.order_status = 'waiting_shipping'`

Future scan work for `pending_bundle` and "待发送" will use the same `action: 'scan'` branch and add more job types or status filters inside the scan implementation.

## Scheduling

The existing `/api/plugin/idle-action/next` endpoint already returns `action: 'scan'` when:

- there is no higher priority `transaction_start` action,
- the current hour is inside the configured scan window,
- `scan_idle_counter >= scan_every_idle_runs`.

`background.js` will add a `scan` branch inside `syncIdleYahooPages()` after bidding and won sync:

1. Fetch next idle action.
2. If `action === 'transaction_start'`, run transaction start.
3. If `action === 'scan'`, run scan jobs.
4. Complete the idle action through `/api/plugin/idle-action/complete`.

The existing completion rule remains unchanged: completing `scan` resets `scan_idle_counter` to `0`.

## Manual Scan Trigger

Admin system config adds a "manual scan" button. Clicking it calls a server endpoint that writes:

```text
scan_idle_counter = scan_every_idle_runs
```

If `scan_every_idle_runs` is missing or invalid, the server uses the existing default `5`.

This does not bypass the existing idle-sync interval, bid guard window, scan window, or action priority. It only makes the existing scheduler consider scan ready on the next eligible idle cycle.

## Server API

Add plugin endpoints:

- `GET /api/plugin/scan/jobs`
- `POST /api/plugin/scan/status`

`GET /api/plugin/scan/jobs` returns waiting-shipping orders joined to their successful task:

- `orderId`
- `productId`
- `productUrl`
- `productTitle`
- `transactionUrl`
- `shippingFeeText`

Candidate condition:

```sql
orders.order_status = 'waiting_shipping'
AND tasks.status = 'success'
```

`POST /api/plugin/scan/status` accepts one order scan result:

```json
{ "orderId": 1, "shippingFeeText": "1060円" }
```

On valid shipping fee:

- update the related task's `shipping_fee_text` to `1060円`;
- update `orders.order_status` to `pending_payment`;
- clear scan error fields if such fields exist.

If no shipping fee is available yet, the plugin does not call status update for that order.

## Yahoo Page Parsing

The plugin opens the order's `transaction_url`. If `transaction_url` is missing, it may reuse the existing `/my/won` fallback that clicks `取引連絡` for the product ID.

On the transaction page, content extraction reads the payment information area:

Case 1, shipping available:

```text
支払い金額 ： 2,560円（落札価格：1,500円 数量：1個 送料：1,060円）
```

The scan result must use the true shipping fee from `送料：1,060円`, normalized as:

```text
1060円
```

It must not store the total payment amount `2,560円` as shipping.

Case 2, shipping not available:

```text
支払い金額 ： 送料決定後、確定します。
```

The scan result is pending. The plugin closes the tab and does not update the order or task.

## Tab Handling

Each scan job closes every tab it created or took over for that job. This mirrors the transaction-start cleanup approach and avoids leaving transaction pages open after no-op scans.

## Error Handling

- Missing transaction URL and failed `/my/won` fallback: report a scan error if a scan error field is added; otherwise skip and close opened tabs.
- Yahoo login failure: report Yahoo login status through the existing login-status endpoint and stop the current scan run.
- Unparseable payment area: close the tab and leave the order in `waiting_shipping` for the next scan.
- Extracted amount must be a positive yen value; invalid values are ignored.

## Tests

Content tests:

- Extract `1060円` from `支払い金額 ： 2,560円（落札価格：1,500円 数量：1個 送料：1,060円）`.
- Detect pending shipping from `送料決定後、確定します。`.
- Do not treat the total payment amount as shipping.

Server tests:

- `GET /api/plugin/scan/jobs` returns only `waiting_shipping` orders.
- `POST /api/plugin/scan/status` updates task shipping fee and order status to `pending_payment`.
- Manual scan trigger writes `scan_idle_counter` to the configured `scan_every_idle_runs`, defaulting to `5`.

Background tests:

- When idle action is `scan`, background fetches scan jobs.
- Available shipping fee is posted back to `/api/plugin/scan/status`.
- Pending shipping produces no status update and closes the tab.

## Non-Goals

- Do not implement `pending_bundle` scanning in this phase.
- Do not implement payment or receipt actions.
- Do not add a separate scan scheduler.
- Do not disable or restructure transaction-start scheduling.
