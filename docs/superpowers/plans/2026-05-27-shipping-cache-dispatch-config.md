# Shipping Cache Dispatch Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shipping fee data service-owned, protect near-term bidding from idle sync, unify configurable multi-bid minimum price, and add admin shipping refresh.

**Architecture:** Server routes own product fetching, shipping parsing, bidding dispatch decisions, and admin configuration. The Chrome extension only executes bidding and syncs bidding/won state without writing product cache or shipping. Admin pages expose configuration and manual shipping repair.

**Tech Stack:** Express, SQLite, Chrome Extension MV3, React/Umi Admin, React mobile client.

---

### Task 1: Server Rules and Admin APIs

**Files:**
- Modify: `src/server/routes/plugin.js`
- Modify: `src/server/routes/admin.js`
- Modify: `src/server/routes/proxy.js`
- Modify: `src/server/routes/task.js`

- [ ] Add `idle_bid_guard_minutes` and `multi_bid_min_price` to config reads/writes with defaults 10 and 5000.
- [ ] Make `/api/plugin/task` return `canIdleSync` plus guard metadata.
- [ ] Remove `/api/proxy/cache`.
- [ ] Add admin shipping refresh endpoint that fetches product info by ID and updates matching task rows.
- [ ] Sort admin orders by `COALESCE(o.won_at, o.created_at)`.

### Task 2: Extension Ownership Cleanup

**Files:**
- Modify: `yahoo-plugin/background.js`
- Modify: `src/server/routes/plugin.js`

- [ ] Stop extension product cache writes and remove `PRODUCT_DATA`/`FETCH_PRODUCT` cache server writes.
- [ ] Stop `/api/plugin/orders/sync` from updating `tasks.shipping_fee_text`.
- [ ] Let idle sync run only when server says `canIdleSync`.

### Task 3: Admin and Client UI

**Files:**
- Modify: `src/admin/src/MultiBidSettings.tsx`
- Create: `src/admin/src/ShippingRefresh.tsx`
- Modify: `src/admin/src/layouts/AdminLayout.tsx`
- Modify: `src/admin/.umirc.ts`
- Modify: `src/client/src/pages/Submit.jsx`

- [ ] Add multi-bid minimum and idle guard fields.
- [ ] Add Shipping Refresh page with multiline product IDs and per-item result table.
- [ ] Use plugin config minimum price in client validation and display text.

### Task 4: Verification and Docs

**Files:**
- Modify tests as needed.
- Modify: `AGENTS.md` or `agents.md`

- [ ] Update tests for removed cache endpoint, dispatch guard, config defaults, and minimum price.
- [ ] Run route tests, extension tests, and frontend/admin builds.
- [ ] Update project status docs.
