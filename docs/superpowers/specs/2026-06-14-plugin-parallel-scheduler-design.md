# Plugin Parallel Scheduler Design

Date: 2026-06-14

## Goal

Refactor the Chrome extension scheduler so bidding, Yahoo monitoring, and order workflows can run in parallel without blocking each other or mixing tabs.

The current implementation uses a single global `isRunning` gate and an idle-sync path. That makes A/B monitoring and C/D/E/F/G order work wait behind bidding, and the bid guard window can suppress monitoring even though monitoring does not operate on the same product pages.

## Target Execution Lines

Use three independent scheduler lines:

1. Bid pool
   - Runs product bidding tasks.
   - Supports configurable concurrency.
   - Default concurrency: `2`.

2. Monitor loop
   - Runs A/B monitoring:
     - A: bidding page sync.
     - B: won page sync.
   - Keeps the existing sync interval.
   - Removes the bid guard window from monitor eligibility.
   - Opens its own tabs and closes them after each sync.

3. Workflow loop
   - Runs C/D/E/F/G order workflows.
   - Stays serial inside this line.
   - PIN/captcha lock applies only to this line.

## Workflow Priority

Keep the existing workflow priority, with manual import first:

```text
G manual order import
C transaction start
D scan
E payment
F confirm receipt
none
```

Reason: manual import creates or updates orders that may then need transaction start, scan, payment, or receipt handling. Running import first lets the imported work continue through the existing order flow as soon as possible.

## PIN And Captcha Lock

PIN/captcha handling should only block the workflow loop.

Bidding and A/B monitoring can continue while a workflow PIN/captcha is active, provided they do not:

- Reuse the PIN/captcha tab.
- Close the PIN/captcha tab.
- Mutate the workflow manual verification state.

System-level PIN input can still focus Chrome. The workflow loop must own that action and should pause itself until the manual verification flow is resolved.

## Bid Concurrency

Add a backend system config value:

```text
bid_concurrency_limit
```

Default: `2`.

The plugin should maintain a bid worker pool up to this limit. Each bid run must have isolated context:

```text
bidRunId
taskId
productId
tabId
createdTabIds
timeout
status
```

Status updates, timeout handling, and tab closing must use the run context. Avoid relying on global `currentTask` or a single global task tab.

The server task API should support atomic batch claiming or repeated atomic single-claim calls until the pool is full. A task claimed by one worker must not be returned to another worker.

## Monitor Loop

Rename the old idle-sync behavior conceptually to monitor sync for A/B.

Rules:

- Keep `idle_sync_interval_minutes` as the monitor interval unless renamed later.
- Remove `idle_bid_guard_minutes` from A/B eligibility.
- Open the bidding sync tab and close it after extraction.
- Open the won sync tab and close it after extraction.
- Do not depend on there being no bid task.

## Workflow Loop

C/D/E/F/G should no longer be driven by "plugin is idle". Instead, it should run from its own loop on a controlled interval.

The existing action selection can be reused:

```text
/api/plugin/idle-action/next
```

but the implementation should be renamed or wrapped later because it will no longer mean idle-only work.

The workflow loop remains serial:

- Only one C/D/E/F/G action runs at a time.
- PIN/captcha lock blocks only this loop.
- Existing transaction, scan, payment, confirm receipt, and import logic remain ordered and serial.

## Tab Ownership

Every opened tab must be owned by a specific scheduler line and run context.

Recommended metadata:

```text
owner: bid | monitor | workflow
runId
taskId or orderId or batchId
purpose
createdAt
```

Closing rules:

- Bid workers close only tabs they own.
- Monitor closes only its A/B tabs.
- Workflow closes only tabs from its workflow run.
- Manual verification tabs are excluded from generic close routines.

This is required before enabling bid concurrency; otherwise one worker can close another worker's page or update the wrong task.

## Shipment Prefecture Config

Move the hard-coded shipment API prefecture code out of `YAHOO_SHIPPING_PREF_CODE || '27'`.

Add a backend system config value:

```text
yahoo_shipping_pref_code
```

Default: `27` Osaka.

The admin system config page should expose a select control with Japan prefecture codes:

```text
01 Hokkaido
02 Aomori
03 Iwate
04 Miyagi
05 Akita
06 Yamagata
07 Fukushima
08 Ibaraki
09 Tochigi
10 Gunma
11 Saitama
12 Chiba
13 Tokyo
14 Kanagawa
15 Niigata
16 Toyama
17 Ishikawa
18 Fukui
19 Yamanashi
20 Nagano
21 Gifu
22 Shizuoka
23 Aichi
24 Mie
25 Shiga
26 Kyoto
27 Osaka
28 Hyogo
29 Nara
30 Wakayama
31 Tottori
32 Shimane
33 Okayama
34 Hiroshima
35 Yamaguchi
36 Tokushima
37 Kagawa
38 Ehime
39 Kochi
40 Fukuoka
41 Saga
42 Nagasaki
43 Kumamoto
44 Oita
45 Miyazaki
46 Kagoshima
47 Okinawa
```

The server proxy should read the config value first, then fall back to environment variable, then default to `27`.

## Implementation Notes

This should be implemented as a scheduler refactor, not a small conditional change.

Key risk areas:

- Current global `isRunning`.
- Current global `currentTask`.
- Managed task tab maps that assume one active bid task.
- Workflow close routines that scan related tabs.
- Manual verification state and Chrome focus handling.
- Server task claiming semantics.

## Acceptance Criteria

- Bidding can run while A/B monitoring is syncing.
- Bidding can run while workflow loop is blocked on PIN/captcha.
- A/B monitoring can run while workflow loop is blocked on PIN/captcha.
- C/D/E/F/G never run concurrently with each other.
- G import runs before C/D/E/F when requested import batches exist.
- Two bid tasks can run concurrently by default without tab or status mix-up.
- Admin can configure bid concurrency and shipment prefecture.
- A/B tabs close after each sync.
- Existing order workflow behavior remains serial and state-safe.
