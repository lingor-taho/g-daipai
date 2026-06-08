# Website Bid Rate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-only RMB helper rate for submit-page bid input while preserving all backend and plugin JPY task logic.

**Architecture:** A small server service fetches and caches the BOC JPY cash sell rate in memory. The client submit page preloads the calculated website rate into localStorage, lets users switch between JPY and RMB input, and submits only converted JPY values through the existing API.

**Tech Stack:** Express, axios, React, Ant Design Mobile, localStorage, existing Node test scripts.

---

### Task 1: Server Website Rate Service

**Files:**
- Create: `src/server/services/websiteRate.js`
- Modify: `src/server/routes/task.js`
- Test: `src/server/routes/task.test.js`

- [ ] Add pure helpers for BOC JPY row parsing, website-rate calculation, cache validity, and the cached fetch wrapper.
- [ ] Add `GET /api/task/website-rate` before the dynamic `/:id` route.
- [ ] Export helpers for tests.
- [ ] Add route/service tests for parsing, rounding, cache hit, and cache expiry.

### Task 2: Client RMB Conversion

**Files:**
- Modify: `src/client/src/utils/api.js`
- Modify: `src/client/src/utils/bidPrice.js`
- Modify: `src/client/src/utils/bidPrice.test.mjs`
- Modify: `src/client/src/pages/Submit.jsx`

- [ ] Add `getWebsiteRate()` API helper.
- [ ] Add pure conversion/display helpers in `bidPrice.js`.
- [ ] Preload website rate on submit page mount with a 3-hour localStorage cache.
- [ ] Add JPY/RMB switch UI beside `最高出价`.
- [ ] Convert RMB input to JPY before validation, low-price split, multi-bid defaults, and `submitTask`.
- [ ] Always show `实际出价`, including normal products.

### Task 3: Documentation and Verification

**Files:**
- Modify: `agents.md`

- [ ] Record the new website-rate behavior and verification commands.
- [ ] Run `node src\server\routes\task.test.js`.
- [ ] Run `node src\client\src\utils\bidPrice.test.mjs`.
- [ ] Run `npm run build` in `src\client`.
