# Plugin Parallel Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three independent plugin scheduler lines: bid pool, A/B monitor loop, and serial C/D/E/F/G workflow loop.

**Architecture:** Keep existing business functions, but replace the single global `isRunning` gate with three line-specific guards. The server provides a batch claim API for bid tasks and exposes new config values. A/B monitoring keeps the current interval but no longer waits for no bid tasks or bid guard.

**Tech Stack:** Chrome Extension MV3 JavaScript, Express routes, SQLite config table, Ant Design admin UI, Node test files.

---

### Task 1: Server Config And Batch Bid Claim

**Files:**
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/proxy.js`
- Test: `src/server/routes/plugin.test.js`
- Test: `src/server/routes/proxy.test.js`

- [ ] Add default config constants: `DEFAULT_BID_CONCURRENCY_LIMIT = 2`, `DEFAULT_YAHOO_SHIPPING_PREF_CODE = '27'`.
- [ ] Include `bid_concurrency_limit` in plugin config responses.
- [ ] Add `GET /api/plugin/tasks?limit=N` that chooses ready tasks and atomically marks each claimed task `processing`.
- [ ] Keep `GET /api/plugin/task` for compatibility.
- [ ] Make `canIdleSync` no longer depend on `idle_bid_guard_minutes`.
- [ ] Read Yahoo shipment prefecture code from config first, env second, default third.
- [ ] Add tests for batch claim and shipment pref config.

### Task 2: Plugin Three-Line Scheduler

**Files:**
- Modify: `yahoo-plugin/background.js`
- Test: `yahoo-plugin/background.test.js`

- [ ] Add line state: `activeBidRuns`, `monitorRunning`, `workflowRunning`, `lastMonitorSyncAt`, `lastWorkflowSyncAt`.
- [ ] Add `bidConcurrencyLimit` plugin config, default `2`.
- [ ] Extract current bid execution body into `executeBidTask(task)`.
- [ ] Add `pollBidPool()` that fills available slots from `/api/plugin/tasks?limit=slots`.
- [ ] Add `syncMonitorYahooPages()` for A/B only.
- [ ] Add `runWorkflowAction()` for C/D/E/F/G only.
- [ ] Keep PIN/captcha pause only in workflow loop.
- [ ] Start all three loops from the polling tick without a global `isRunning` gate.
- [ ] Add tests proving bid work and monitor/workflow can start independently.

### Task 3: Monitor Tab Cleanup

**Files:**
- Modify: `yahoo-plugin/background.js`
- Test: `yahoo-plugin/background.test.js`

- [ ] Ensure A/B monitor tabs close after each sync.
- [ ] Ensure manual verification tabs are never closed by monitor cleanup.
- [ ] Keep workflow close routines scoped to workflow-created tabs.

### Task 4: Admin Config UI

**Files:**
- Modify: `src/admin/src/MultiBidSettings.tsx`
- Modify: `src/server/routes/admin.js`

- [ ] Add `bidConcurrencyLimit` input, default `2`.
- [ ] Add `yahooShippingPrefCode` select with Japan prefecture codes `01` through `47`.
- [ ] Save both values through the existing multi-bid config endpoint.
- [ ] Keep current fields backward-compatible.

### Task 5: Verification And Documentation

**Files:**
- Modify: `agents.md`

- [ ] Update current status with implementation details.
- [ ] Run `node yahoo-plugin/background.test.js`.
- [ ] Run `node yahoo-plugin/encoding.test.js`.
- [ ] Run `node src/server/routes/plugin.test.js`.
- [ ] Run `node src/server/routes/proxy.test.js`.
- [ ] Run admin/client build if admin config changes require it.
