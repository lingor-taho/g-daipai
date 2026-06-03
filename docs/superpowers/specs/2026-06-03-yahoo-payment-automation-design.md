# Yahoo Payment Automation Design

## Scope

This phase implements the payment automation framework around the existing idle action pipeline. It covers admin settlement/payment controls, global payment flag handling, payment queue APIs, reminder display, status transitions, and plugin scheduling hooks.

Yahoo page-specific payment clicks and final DOM recognition rules are intentionally left for a later detail phase after real page screenshots/HTML are provided. The framework must be ready to plug those rules in without changing the admin and queue model.

## Chosen Approach

Use a global payment flag plus a server-side payment queue.

- `payment_requested=1` means payment automation is allowed to run.
- Eligible payment jobs are orders with `order_status='pending_settlement'` and a non-empty payable amount.
- Payment errors clear the flag and show a global admin reminder.
- Orders remain in `pending_settlement` when payment fails or when they were not reached in the current batch.

This keeps payment explicitly operator-triggered. It avoids automatically paying every settled order just because it exists.

## Order Statuses

Existing statuses remain:

- `pending_payment`: 待支付. Eligible for settlement.
- `bundle_completed`: 同捆完了. Eligible for settlement, but not eligible for payment.
- `pending_settlement`: 待结算. Eligible for payment.
- `completed`: 完了. Existing manually refreshed final status.

Add:

- `pending_shipment`: 待发货. Payment succeeded or Yahoo already shows the order is paid.

## Settlement Rules

Admin settlement auto-selection changes from "non-bidder-pays shipping" to:

- `order_status='pending_payment'`
- `order_status='bundle_completed'`

Settlement keeps the existing finance calculation and special-user override model.

Status after settlement:

- `pending_payment` becomes `pending_settlement`.
- `bundle_completed` remains `bundle_completed`.

This lets bundled child orders receive payable amounts while staying out of the payment queue.

## Payable Amount Rules

The existing formula remains:

```text
payable = (final_price + shipping_fee + bank_fee_jpy) * rate + handling_fee_cny + large_amount_fee_cny
```

The existing special-user logic remains:

- `rate_adjustment` adjusts the submitted settlement rate.
- `bank_fee_jpy` overrides the global bank fee when set.
- `handling_fee_cny` overrides the global RMB handling fee when set.
- `large_amount_fee_cny` overrides the global large-amount fee when set.
- Empty special-user fields continue using global defaults.

Shipping fee source changes to an effective shipping fee:

```text
effective_shipping_fee_text = orders.bundle_shipping_fee_text || tasks.shipping_fee_text
```

This means bundled main orders use the bundled shipping amount and bundled child orders usually use `0円`. All orders, including bundled child orders, still apply the full standard formula and special-user overrides.

## Payment Button Rules

The admin "支付" button is separate from "结算".

The payment button may only select orders where:

- `order_status='pending_settlement'`
- `total_amount_cny IS NOT NULL`

Clicking "支付":

- keeps or sets selected orders to `pending_settlement`;
- writes `payment_requested=1`;
- does not immediately mark orders as paid.

The plugin changes order status only after Yahoo payment execution or after detecting the order is already paid.

## Global Reminder Bar

The admin layout adds a global reminder bar at the top of the content area.

It is hidden unless `payment_alert_message` has content.

When visible:

- text is red;
- message contains the failed product ID and reason, for example `付款失败：商品ID xxx，原因：yyy`;
- it includes a "清除并继续任务" button.

Clicking "清除并继续任务":

- clears `payment_alert_message`;
- writes `payment_requested=1`;
- hides the reminder after refresh/poll;
- lets the same failed order re-enter the queue if it is still `pending_settlement`.

No per-order payment error field is added in this phase.

## Payment Config

The existing system config page adds:

- `payment_job_limit`: 付款流程执行任务数. Default `3`.
- `payment_page_stay_seconds`: 付款页面停留时间. Default `3`.

Both values are positive integers.

## Idle Action Scheduling

The existing idle pipeline remains:

1. plugin confirms no executable bidding task and `canIdleSync=true`;
2. plugin syncs Yahoo bidding page;
3. plugin syncs Yahoo won page;
4. plugin asks `/api/plugin/idle-action/next`;
5. plugin runs at most one follow-up action;
6. plugin calls `/api/plugin/idle-action/complete`.

Idle action priority becomes:

1. `transaction_start`
2. `scan`
3. `payment`
4. future `receipt`
5. `none`

`payment` is returned only when:

- `payment_requested=1`

The payment flag is not cleared just because one batch finishes. After a successful batch, `payment_requested` stays `1` so a later idle cycle can fetch the next batch.

When a later payment job fetch finds no remaining orders matching `order_status='pending_settlement'` and `total_amount_cny IS NOT NULL`, the plugin reports an empty payment result to `POST /api/plugin/payment/status`, and the server clears `payment_requested=0`. This allows later receipt automation to run.

## Payment Job API

Add plugin-facing endpoints:

- `GET /api/plugin/payment/jobs`
- `POST /api/plugin/payment/status`

`GET /api/plugin/payment/jobs` returns at most `payment_job_limit` jobs where:

- `orders.order_status='pending_settlement'`
- `orders.total_amount_cny IS NOT NULL`
- linked `tasks.status='success'`

Sort order:

```sql
ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC
```

Job payload includes:

- order ID
- product ID
- product URL
- product title
- product type
- transaction URL
- payable CNY
- final price
- effective shipping fee text
- bundle group ID if present

`POST /api/plugin/payment/status` supports:

- success/already-paid: update the order to `pending_shipment` and set `updated_at`;
- failure: set `payment_requested=0`, write `payment_alert_message`, and leave all current and remaining orders in `pending_settlement`;
- empty queue: set `payment_requested=0` only when no remaining `pending_settlement` orders with payable amount exist.

## Plugin Payment Runner

When idle action is `payment`, the plugin:

1. fetches payment jobs;
2. if no jobs are returned, reports empty queue and stops;
3. processes jobs sequentially;
4. waits a random/page dwell period based on `payment_page_stay_seconds` before clicking the final payment button;
5. on success or already-paid, reports success and closes related tabs;
6. on any unexpected condition, reports failure, closes related tabs, and stops the batch.

Failure behavior is intentionally conservative:

- no retry inside the same run;
- no fallback clicking;
- no attempt to continue later jobs after failure;
- no per-order error state.

## Yahoo Page Detail Phase

The following are deferred until real Yahoo page evidence is provided:

- normal item payment entry and button selectors;
- store item payment entry and button selectors;
- already-paid detection text/DOM;
- successful payment confirmation text/DOM;
- unexpected condition detection;
- screenshots and HTML samples for tests.

The deferred work should be implemented inside the payment runner and content script without changing the queue and admin design above.

## Testing

Server tests:

- settlement uses effective bundled shipping fee first;
- settlement preserves special-user overrides;
- `bundle_completed` settlement keeps `bundle_completed`;
- `pending_payment` settlement becomes `pending_settlement`;
- payment request sets `payment_requested=1`;
- payment jobs only return `pending_settlement` orders with payable amount;
- payment jobs sort by won time ascending;
- payment success changes status to `pending_shipment`;
- payment failure clears flag and writes reminder;
- empty payment queue clears flag only when no remaining `pending_settlement` orders with payable amount exist.

Admin tests/build:

- order selection rules for settlement and payment;
- global reminder bar renders only when message exists;
- config fields save and load;
- admin build passes.

Plugin tests:

- idle action returns `payment` only when payment flag is set and higher-priority actions are not ready;
- payment runner stops on first failure;
- empty queue clears payment flag;
- success marks one job complete and continues to the next job.

## Non-Goals

- Do not implement Yahoo payment page selectors in this first framework phase.
- Do not add per-order payment error persistence.
- Do not make payment run automatically just because `pending_settlement` orders exist.
- Do not change receipt automation beyond leaving scheduling room after payment flag clears.
