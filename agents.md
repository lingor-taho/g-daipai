# g-daipai 项目状态

**最后更新**: 2026-05-27

---

## 项目概述

Yahoo 日本拍卖代拍系统：中国用户通过 Web 提交商品 URL、最高价和出价策略，Windows 服务器端 Chrome 插件轮询 API 并在 Yahoo Auction 页面自动执行竞拍、同步入札中状态和落札订单。

---

## 当前架构

```
用户浏览器 (React SPA, dev http://localhost:3035)
    │
    │ HTTP /api
    ▼
API Server (Express + SQLite, .env PORT=3034)
    │
    │ HTTP 轮询 /api/plugin/*
    ▼
Chrome Extension (yahoo-plugin/, Windows 服务器 Chrome)
    │  manifest.json + background.js + content.js
    ▼
Yahoo Auction 网站
```

生产部署通常在服务器 `C:\www\g-daipai`，本地工作区为 `D:\www\g-daipai`。

---

## 当前文件结构

```
D:/www/g-daipai/
├── yahoo-plugin/
│   ├── manifest.json        — Manifest V3
│   ├── background.js        — 任务轮询、出价执行、空闲同步入札中/落札、插件配置读取
│   ├── content.js           — 商品/入札中/落札页数据提取，出价页面操作
│   ├── background.test.js
│   └── content.test.js
├── src/
│   ├── client/              — React SPA (Ant Design Mobile)
│   │   ├── vite.config.js   — dev port 3035, proxy /api → localhost:3034
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Submit.jsx        — 提交任务，价格校验，多次出价配置
│   │       │   ├── TaskList.jsx      — 用户任务列表
│   │       │   ├── ActiveBidding.jsx — 入札中，支持最高价/高値更新
│   │       │   ├── WonItems.jsx      — 落札商品
│   │       │   └── Login.jsx
│   │       ├── utils/api.js
│   │       └── utils/bidPrice.js
│   ├── admin/               — 管理后台
│   │   ├── Tasks.tsx
│   │   ├── Orders.tsx
│   │   ├── Users.tsx
│   │   ├── MultiBidSettings.tsx — 多次出价、入札/落札空闲同步配置
│   │   ├── DataCleanup.tsx      — 清理 30 天无用数据
│   │   └── ShippingRefresh.tsx  — 按商品 ID 批量刷新运费
│   ├── server/
│   │   ├── index.js         — Express API, CORS, pending task sweep
│   │   ├── models/index.js  — better-sqlite3 同步封装 + schema 兼容列
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── task.js      — 用户任务、入札中、落札列表
│   │       ├── plugin.js    — 插件任务、状态、入札中同步、落札同步、配置
│   │       ├── proxy.js     — 商品信息抓取、服务端运费解析、内存缓存
│   │       └── admin.js
│   ├── shared/
│   └── db/init.sql
├── data/gdaipai.db          — SQLite
├── start.bat
└── agents.md
```

---

## 数据库 Schema 摘要

核心表：

- `users`: 用户、角色、上下级关系。
- `yahoo_accounts`: Yahoo 账号池预留字段，目前主要依赖服务器 Chrome 登录态。
- `tasks`: 竞拍任务，包含商品信息、当前价、即決价、税类型、最高价、用户最高价、多次出价增量、策略、状态、是否最高价入札者、结束时间。`pending_followup_max_price` 用于即时拍低价拆分场景，记录原始最高价，待商品当前价达标后自动追加 followup 任务。
- `bid_logs`: 出价日志。
- `orders`: 落札订单，`final_price` 现在只使用 Yahoo 落札页抓到的该商品价格，`won_at/won_time_text` 保存 Yahoo 落札时间。
- `bidding_items`: 插件从 Yahoo `/my/bidding` 同步的入札中商品状态，`status` 支持 `highest`、`outbid`、`stale`。
- `exchange_config`: 汇率配置。
- `config`: 全局配置，如多次出价开始时间、间隔、最低最高价、空闲同步间隔、出价保护窗口、数据清理参数。

`tasks.status` 常用值：`pending`、`processing`、`bidding`、`success`、`failed`、`cancelled`。

`tasks.strategy` 常用值：

- `direct`: 即时拍
- `multi_bid`: 多次出价
- `1min` / `2min` / `5min` / `10min`: 结束前策略

---

## 当前运行状态

| 服务 | 地址 | 状态 |
|------|------|------|
| API Server | http://localhost:3034 | 由 `.env PORT=3034` 配置 |
| React Client dev | http://localhost:3035 | Vite dev server |
| Admin | `src/admin` | Umi 管理后台 |
| Chrome Extension | `yahoo-plugin/` | 需在服务器 Chrome 中手动加载/更新 |

---

## 关键业务流程

### 商品提交

```
用户粘贴 URL/关键词 → getProductInfo()
  │
  ├─ 服务端 /api/proxy/fetch 获取商品信息和运费
  └─ 提交 /api/task/submit，保存商品信息、最高价、策略、税类型、结束时间
```

客户端提交前会校验：

- 必须有最高出价。
- 非即決出价时，最高出价必须高于商品当前价。
- 店铺含税商品会按税后可比较价格校验。
- 多次出价最高价不得低于后台“多次出价配置”的最低价，默认 `5000円`。
- 多次出价每次加价额度不得低于最高价的 `1/20`。

运费规则：

- 运费只在服务端商品信息解析时绑定到 `tasks.shipping_fee_text`。
- 插件商品快照、入札中同步、落札同步都不再更新运费。
- 历史缺失或错误运费通过后台“运费更新”按商品 ID 批量刷新。
- 服务端解析支持 `送料 落札者負担`、`送料 着払い`、`送料 無料`、固定 `XXX円`，以及 Yahoo shipment API 多物流方式取最小运费。

### 插件出价

```
background.js 每 10 秒轮询 /api/plugin/task
  │
  ├─ direct 任务立即执行
  ├─ 结束前策略按 end_time 和 lead window 执行
  └─ multi_bid 在全局开始时间后，按间隔重复尝试
```

出价前插件会打开商品页并刷新商品快照；若未进入策略窗口，会回写最新结束时间并把任务恢复为 `pending`。

`/api/plugin/task` 会同时返回 `canIdleSync`。插件只有在没有可执行任务，并且后台配置的“出价保护窗口”（默认 10 分钟）内没有即将出价的任务时，才会执行入札中/落札空闲同步。

### 入札中同步

```
插件空闲 → 打开 https://auctions.yahoo.co.jp/my/bidding
  │
  ├─ 最高額で入札中 → status=highest
  └─ 高値更新 + 再入札する → status=outbid
```

入札中同步只写入商品 ID、链接、标题、图片、当前价、入札状态、同步时间；页面显示的运费、策略、最高价等来自本系统 `tasks` 表。

用户端 `入札中` 页面现在显示全部状态：

- 蓝色：`最高价入札中`
- 红色：`高値更新` + `再入札する`
- `direct` 且被超过时，右侧显示 `再入札` 按钮，跳转提交页并预填商品 URL。

### 落札同步

```
插件空闲 → 打开 https://auctions.yahoo.co.jp/my/won
  │
  └─ 提取每个商品的 Yahoo 落札页价格和落札时间 → /api/plugin/orders/sync
```

重要规则：`orders.final_price` 只使用 Yahoo 落札页该商品展示的 `XXX円` 价格。不得再用用户最高价、当前价或任务最高价兜底为落札价。客户端落札商品页也不再 fallback 到最高价。

落札同步不再更新运费。用户端落札商品和后台订单排序都按 `won_at` 优先，缺失时再按系统时间兜底。

---

## 已修复 / 最近变更

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-05-12 | `plugin.js` route 使用 `await` 但函数未声明 `async` | 添加 `async` |
| 2026-05-12 | routes 中 `db.getOne/getAll` 缺少 `await` | 补齐 async/await |
| 2026-05-12 | 服务端抓取 Yahoo 易被反爬 | 改为服务端 HTTP + Playwright fallback，并保留内存缓存兜底 |
| 2026-05-12 | `submitTask` 不保存商品 title/image/price | 提交时保存商品信息 |
| 2026-05-12 | `截旗前` 文案不准确 | 改为 `结束前` |
| 2026-05-24 | 入札中页只显示我方最高价商品 | `/api/task/bidding` 支持 `highest/outbid`，前端显示高値更新 |
| 2026-05-24 | 即时拍被超过后缺少再入札入口 | 入札中页面为 `direct + outbid` 增加 `再入札` 按钮 |
| 2026-05-25 | 落札价错误使用用户最高价/任务价格 | `final_price` 改为只使用 Yahoo 落札页抓到的价格 |
| 2026-05-25 | 客户端允许最高价低于/等于当前价提交 | 提交前阻断并提示当前价 |
| 2026-05-27 | 插件商品缓存和运费来源不统一 | 删除 `/api/proxy/cache`，插件不再写商品缓存，落札同步不再更新运费 |
| 2026-05-27 | 空闲同步可能挤占临近出价 | `/api/plugin/task` 增加出价保护窗口，默认 10 分钟内有任务时禁止空闲同步 |
| 2026-05-27 | 历史运费错误缺少修复入口 | 后台新增“运费更新”，按商品 ID 批量走服务端解析并更新任务运费 |
| 2026-05-27 | 多次出价最低价仍有硬编码风险 | 后台“多次出价配置”增加最低最高价参数，前后端统一读取，默认 `5000円` |
| 2026-05-27 | 后台订单排序与用户端不一致 | 后台订单改为按 Yahoo 落札时间 `won_at` 优先倒序 |
| 2026-05-27 | 即时拍商品当前价<1000 时无法直接出价>10000 | 客户端弹窗提示拆分两步出价；首单以 9000 提交并存 `pending_followup_max_price`，入札中/快照同步发现当前价≥1000 时自动以原最高价补一个 `direct` 即时拍（`client_request_id=followup-{id}` 幂等） |

---

## 当前风险 / 待做

| 优先级 | 事项 | 说明 |
|--------|------|------|
| 🔴 紧急 | 生产 Yahoo 落札页价格抽取需要实测 | 需确认实际 `/my/won` DOM 不会抽到错误容器或其他金额 |
| 🟡 中期 | 查询 worker 与出价 worker 隔离 | 已增加出价保护窗口；后续如查询订单操作变重，可考虑同一插件不同角色，或两个 Chrome Profile 分别负责出价/查询 |
| 🟡 中期 | 落札后实际运费更新 | 当前运费只来自商品提交时的服务端解析，落札后“落札者負担”更新为实际金额的逻辑尚未开发 |
| 🟡 中期 | 多次出价完整生产验证 | 需真实 Yahoo 登录态和临近结束商品测试 |
| 🟡 中期 | 订单管理页面完善 | Admin Orders 已有基础列表，业务流程未完整 |
| 🟢 低 | Yahoo 账号池管理 | 表和 UI 有雏形，实际调度仍主要依赖 Chrome 登录态 |

---

## 验证命令

常用回归：

```powershell
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\server\routes\proxy.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
Set-Location ..\admin
npm run build
```

---

## 服务器更新命令

生产服务器项目目录通常为 `C:\www\g-daipai`：

```powershell
Set-Location C:\www\g-daipai
git fetch origin
git reset --keep origin/master
git rev-parse --short HEAD
git status --short
```

服务端代码、前端构建或插件代码更新后：

- API Server 需要按当前部署方式重启。
- 前端如使用构建产物，需要重新 build/发布。
- Chrome 插件代码更新后，需要在 Chrome 扩展页重载插件。

---

## 关键路径

- **插件目录**: `D:/www/g-daipai/yahoo-plugin/`
- **客户端目录**: `D:/www/g-daipai/src/client/`
- **API 服务**: `D:/www/g-daipai/src/server/index.js`
- **数据库**: `D:/www/g-daipai/data/gdaipai.db`
- **Schema**: `D:/www/g-daipai/src/db/init.sql`
- **后台运费更新**: `D:/www/g-daipai/src/admin/src/ShippingRefresh.tsx`
- **服务端商品/运费解析**: `D:/www/g-daipai/src/server/routes/proxy.js`
- **插件调度/空闲同步**: `D:/www/g-daipai/yahoo-plugin/background.js`
- **Spec**: `D:/www/g-daipai/docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-v2-design.md`

---

## 清理记录

- ✅ `/api/proxy/cache` — 已删除；插件不再向服务端写商品缓存
- ✅ `src/server/routes/product.js` — 已删除（旧 Playwright 代理接口）
- ✅ `docs/superpowers/plans/2026-05-11-yahoo-auction-proxy-plan.md` — 已删除
- ✅ `docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-design.md` — 已删除
- ✅ `src/worker/` — 已删除
