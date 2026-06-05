# g-daipai 项目状态

**最后更新**: 2026-06-05

---

## 项目进度与接手信息维护约定

本文件用于记录继续本项目所需的进度、业务规则、架构状态、真实页面结论、部署注意事项和验证结果。后续每次出现重要改动、阶段规划或关键业务确认时，必须同步更新本文件，方便后续接手时直接了解当前状态。

更新原则：

- 代码实现完成后，补充“已实现内容 / 最近修复 / 最近验证命令”。
- 新阶段开始前，补充“当前状态 / 业务规则确认 / 下一步计划”。
- 真实页面测试发现问题时，补充“当前真实测试问题”和建议排查方向。
- 如果功能被临时停用，必须记录停用开关、原因、恢复条件和生产注意事项。
- 更新内容优先追加到对应日期小节；没有合适小节时，新建 `YYYY-MM-DD 功能名当前进度` 小节。
- 同步更新顶部 `最后更新` 日期。

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
│   │       │   ├── Submit.jsx        — 提交任务，价格校验，多次出价配置，仅即決商品自动锁定即決
│   │       │   ├── TaskList.jsx      — 用户任务列表，提交页内嵌 6 个状态统计卡片
│   │       │   ├── ActiveBidding.jsx — 入札中，支持最高价/高値更新
│   │       │   ├── WonItems.jsx      — 落札商品
│   │       │   ├── Statistics.jsx    — 近 30 天落札税后总金额柱状图和 CSV 导出
│   │       │   └── Login.jsx
│   │       ├── utils/api.js
│   │       ├── utils/bidPrice.js
│   │       ├── utils/taskStats.js
│   │       └── utils/wonStats.js
│   ├── admin/               — 管理后台（支持移动端查看）
│   │   ├── layouts/AdminLayout.tsx — 后台布局，支持菜单折叠（展开 210px / 折叠 50px）
│   │   ├── Tasks.tsx
│   │   ├── Orders.tsx       — 订单管理，含用户名、运费、银行手续费、手续费(RMB)、大金额费用
│   │   ├── SpecialUserSettings.tsx — 特殊用户参数设置，按用户覆盖订单费用参数
│   │   ├── Users.tsx
│   │   ├── MultiBidSettings.tsx — 多次出价、入札/落札空闲同步配置
│   │   ├── DataCleanup.tsx      — 清理 30 天无用数据
│   │   ├── DataBatch.tsx        — 数据批处理顶部 Tabs 容器
│   │   ├── ShippingRefresh.tsx      — 按商品 ID 批量刷新运费
│   │   ├── ProductTypeRefresh.tsx   — 按商品 ID 批量刷新商品类型
│   │   └── OrdersResync.tsx         — 按商品 ID 批量刷新落札商品
│   ├── server/
│   │   ├── index.js         — Express API, CORS, pending task sweep
│   │   ├── models/index.js  — better-sqlite3 同步封装 + schema 兼容列
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── task.js      — 用户任务、入札中、落札列表、近 30 天落札统计
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
- `tasks`: 竞拍任务，包含商品信息、当前价、即決价、税类型、商品类型、最高价、用户最高价、多次出价增量、策略、状态、是否最高价入札者、结束时间。`product_type` 标记 `normal` 普通商品或 `store` 商城商品；`pending_followup_max_price` 用于即时拍低价拆分场景，记录原始最高价，待商品当前价达标后自动追加 followup 任务。
- `bid_logs`: 出价日志。
- `orders`: 落札订单，`final_price` 现在只使用 Yahoo 落札页抓到的该商品价格，`won_at/won_time_text` 保存 Yahoo 落札时间。
- `bidding_items`: 插件从 Yahoo `/my/bidding` 同步的入札中商品状态，`status` 支持 `highest`、`outbid`、`stale`。
- `user_finance_overrides`: 特殊用户费用参数，按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用。
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
- 非即決出价时，最高出价的税前价必须 >= 商品当前税前价（支持起拍价出价）。
- 店铺含税商品会按税后可比较价格校验。
- 多次出价最高价不得低于后台“多次出价配置”的最低价，默认 `5000円`。
- 多次出价每次加价额度按 Yahoo 阶梯校验：最高价 `<5000円` 最低 `100円`，`5000-9999円` 最低 `250円`，`10000-49999円` 最低 `500円`，`>=50000円` 最低 `1000円`。

运费规则：

- 运费只在服务端商品信息解析时绑定到 `tasks.shipping_fee_text`。
- 插件商品快照、入札中同步、落札同步都不再更新运费。
- 历史缺失或错误运费通过后台“运费更新”按商品 ID 批量刷新。
- 服务端解析支持 `送料 落札者負担`、`送料 着払い`、`送料 無料`、固定 `XXX円`，以及 Yahoo shipment API 多物流方式取最小运费。

商品类型规则：

- 商品价格后显示 `（税0円）` 时标记为普通商品：`product_type=normal`。
- 商品价格后显示 `（税込）` 时标记为商城商品：`product_type=store`。
- 用户端抓取商品后会显示商品类型，并在提交任务时保存到 `tasks.product_type`。
- 历史缺失商品类型通过后台“商品类型更新”按商品 ID 批量刷新，只更新商品类型，不更新运费。

### 插件出价

```
background.js 每 10 秒轮询 /api/plugin/task
  │
  ├─ direct 任务立即执行
  ├─ 结束前策略按 end_time 和 lead window 执行
  └─ multi_bid 在全局开始时间后，按间隔重复尝试
```

出价前插件会打开商品页并刷新商品快照；若未进入策略窗口，会回写最新结束时间并把任务恢复为 `pending`。

插件单个任务执行增加 30 秒总超时保护：如果商品 tab 打开、页面注入、确认页或出价消息长时间无响应，会自动关闭任务 tab、将任务标记为 failed，并释放队列继续执行后续任务。超时错误写入稳定英文 `Task execution timeout after 30s; task tab closed`，前后端统一归类为“失败：响应超时”。Yahoo 页面出现 `入札に失敗しました / オークションにアクセスできませんでした` 弹窗时，也会识别为终止失败并关闭 tab。

多次出价任务在已出价后仍会继续按间隔执行；如果后续同步发现 `current_price > max_price`，或再次执行时下一口加价后金额超过用户最高价，会标记为 failed，不再一直停留在“已出价”。

`/api/plugin/task` 会同时返回 `canIdleSync`。插件只有在没有可执行任务，并且后台配置的“出价保护窗口”（默认 10 分钟）内没有即将出价的任务时，才会执行入札中/落札空闲同步。

### 入札中同步

```
插件空闲 → 打开 https://auctions.yahoo.co.jp/my/bidding
  │
  ├─ 最高額で入札中 → status=highest
  └─ 高値更新 + 再入札する → status=outbid
```

入札中同步只写入商品 ID、链接、标题、图片、当前价、入札状态、同步时间；页面显示的运费、策略、最高价等来自本系统 `tasks` 表。同一商品多次提交时，用户端“入札中”按商品 ID 聚合，策略、最高价、运费等展示字段取最后提交的任务。

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

落札同步不再更新运费。用户端落札商品和后台订单排序都按 `won_at` 优先，缺失时再按系统时间兜底。同一商品多次提交时，用户端“落札商品”的落札价、落札时间仍取实际落札订单，策略、最高价、运费等展示字段取最后提交的任务。

### 用户端统计页面

用户端菜单当前顺序：

```
提交任务 → 入札中 → 落札商品 → 统计页面
```

已去掉独立“任务列表”菜单，但提交任务页底部仍内嵌最近任务列表。提交任务页状态卡片保留 6 个：总任务、队列中、已出价、成功、出价失败、已终止；已去掉“执行中”卡片。

统计页面 `/stats` 显示近 30 天每日落札商品税后总金额柱状图：

- 柱体金额：每日落札商品税后总金额。
- 手机点击柱体、PC 鼠标移入柱体显示当天落札数量和金额。
- CSV 导出字段：商品id、商品名称、落札价、运费、落札时间。

---

## 后台管理

### 菜单折叠（移动端优化）

后台支持菜单折叠功能，适配移动端查看：

- **展开状态**（210px）：显示完整菜单名称，无滚动条
- **折叠状态**（50px）：只显示菜单第一个字，最大化内容区域

菜单映射：

| 完整名称 | 折叠显示 |
|---------|---------|
| 任务报表 | 任 |
| 用户账号管理 | 用 |
| 服务器账号 | 服 |
| 系统配置 | 系 |
| 清理数据 | 清 |
| 数据批处理 | 批 |
| 特殊用户设置 | 特 |
| 订单管理 | 订 |

移动端效果（375px 手机）：
- 展开：内容区 165px（44%）
- 折叠：内容区 325px（87%）
- 内容增加 97%，占比提升 43%

### 订单管理

订单管理页面字段：

- **用户名**：下单用户
- **商品 ID**：可点击跳转 Yahoo 商品页；后面显示商品类型标识，商城商品为红色 `商`，普通商品为绿色 `普`，缺失时显示 `-`
- **运费**：支持 4 种形式（無料、着払い、落札者負担、固定金额）
- **落札金额**：Yahoo 落札页抓取的价格
- **银行手续费**：日元，可在页面配置
- **手续费(RMB)**：人民币，可在页面配置
- **大金额费用**：人民币，可在页面配置，落札商品税后金额 >= 30,000円 时生效，默认 0
- **汇率**：可在页面配置
- **特殊用户设置**：订单管理页按钮进入，按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用；未填写字段继续使用订单管理默认值
- **应付款**：自动计算

应付款公式：
```
应付款 = (落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB) + 大金额费用
```

示例：
```
落札金额：20,000円
运费：1,000円
银行手续费：500円
汇率：0.05
手续费(RMB)：15元
大金额费用：0元（税后落札金额未达到 30,000円）
应付款 = (20000 + 1000 + 500) * 0.05 + 15 + 0 = 1090元
```

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
| 2026-05-27 | 即时拍商品税前价<1000 时无法直接出价>10000 | 客户端弹窗提示拆分两步出价；首单以 9000 提交并存 `pending_followup_max_price`，入札中/快照同步发现税前价≥1200 时自动以原最高价补一个 `direct` 即时拍（`client_request_id=followup-{id}` 幂等）。修复含税商品 followup 任务 max_price 折算、direct noStatus 死循环 |
| 2026-05-27 | 价格口径混乱（税前/税后） | 统一口径：`current_price`/`max_price` 始终税前，`user_max_price` 始终税后。修复 `getComparableCurrentPrice`、拆分判断、ActiveBidding 显示、`failPricedOutPendingTasks` SQL、content.js `validateCurrentPrice`、`syncBiddingItems` 入札中价格折算 |
| 2026-05-27 | 落札页价格抓取错误（吃到标题商品代码） | `extractOrderPrice` 新增 `findPriceElementText` 从 DOM 叶子节点查找纯价格元素，避免 textContent 跨元素拼接造成数字粘连（F26171 + 23,100円 → 2,617,123,100） |
| 2026-05-27 | 落札商品重复同步浪费性能 | `/api/plugin/orders/sync` 改为增量同步：从最新往老遍历，碰到第一条已有订单就 break。新增 `tasks.force_orders_resync` 列 + 后台"落札商品更新"页面，支持批量标记强制刷新 |
| 2026-05-28 | 起拍价无法出价 | 修改提交校验：最高价的税前价 >= 商品目前的税前价即可提交（支持起拍价出价）。修改前要求 > 当前价，导致起拍价商品无法出价 |
| 2026-05-28 | 后台订单管理字段不全 | 订单管理增加：用户名、运费（4种形式）、银行手续费(日元)、手续费(RMB)。应付款公式改为：(落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB) |
| 2026-05-28 | 后台菜单无法折叠，移动端体验差 | 后台布局增加菜单折叠功能，参考 YouTube 样式，点击左上角三横线图标可展开/收起侧边栏。折叠时宽度 50px，只显示菜单第一个字（任/用/服/系/清/运/落/订），适配移动端查看。去除菜单滚动条，界面更简洁 |
| 2026-05-28 | 用户端缺少近 30 天落札统计 | 新增 `/stats` 统计页面和 `/api/task/won-stats`，展示每日落札税后总金额柱状图，支持手机点击/PC hover 查看每日数量，并支持 CSV 导出商品id、商品名称、落札价、运费、落札时间 |
| 2026-05-28 | 用户端菜单和提交页状态卡片不够简洁 | 用户端去掉“任务列表”菜单，菜单改为“提交任务、入札中、落札商品、统计页面”；提交页统计卡片去掉“执行中”，保留其他 6 个卡片 |
| 2026-05-28 | 只有即決没有普通出价的商品会走错普通出价流程 | `proxy.js` 解析 `bidButtonGroup`，仅存在“今すぐ落札”且没有普通入札按钮时返回 `buyoutOnly=true`；提交页自动勾选并锁定即決、最高出价锁定为即決价；服务端收到 `buyout_only=true` 时强制 `bid_mode=buyout`；插件测试覆盖“今すぐ落札 → 落札する”链路 |
| 2026-05-28 | 订单管理缺少大金额费用和特殊用户单独参数 | 订单管理新增“大金额费用”，默认 0，仅税后落札金额 >= 30,000円 时计入；公式改为 `(落札金额 + 运费 + 银行手续费) * 汇率 + 手续费 + 大金额费用`。新增“特殊用户设置”页面，可按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用 |
| 2026-05-29 | Yahoo 入札失败弹窗可能卡住插件队列 | `content.js` 识别 `入札に失敗しました / オークションにアクセスできませんでした` 并返回失败关闭 tab；`background.js` 增加 30 秒任务级超时，tab 长时间无响应时自动关闭并标记 failed，避免 `isRunning` 一直占住导致后续任务无法执行 |
| 2026-05-30 | 缺少商品类型字段和历史补齐入口 | 新增 `tasks.product_type`，服务端按价格后 `（税0円）/（税込）` 判断普通/商城商品；用户端商品卡片显示商品类型；后台新增“商品类型更新”，支持按商品 ID 批量补齐 |
| 2026-05-30 | 后台订单管理商品类型不直观，商品 ID 易换行 | 订单管理商品 ID 后增加类型标识：红色 `商`、绿色 `普`、缺失 `-`；表格启用横向滚动并设置数据不换行 |
| 2026-05-30 | 落札商品更新说明误写会覆盖运费 | 后台“落札商品更新”说明改为“也会重新覆盖（落札价、落札时间）” |
| 2026-05-31 | 后台批处理菜单分散 | “运费更新 / 商品类型更新 / 落札商品更新”合并为“数据批处理”，页面顶部 Tabs 切换 3 个功能 |
| 2026-05-31 | 订单结算状态文案混用 | 订单管理勾选后点击“结算”改为 `pending_settlement`，显示“待结算”；`pending_payment` 继续保留为“待支付”供其他流程使用 |
| 2026-05-31 | 用户端列表分页和同商品多任务展示混乱 | 用户端“入札中”“落札商品”改为每页 10 条；同商品多次提交时，策略、最高价、运费等展示字段取最后提交的任务 |
| 2026-05-31 | 多次出价超最高价可能停留在已出价 | `current_price > max_price` 自动失败规则扩展到 `bidding + multi_bid`，避免已出价多次出价任务卡住 |
| 2026-05-31 | 多次出价最低加价规则不符合 Yahoo 阶梯 | 最低加价改为 Yahoo 阶梯：`<5000=100`、`5000-9999=250`、`10000-49999=500`、`>=50000=1000` |
| 2026-05-31 | 30 秒超时错误乱码导致显示系统原因 | 插件超时错误改为英文 `Task execution timeout after 30s; task tab closed`；旧乱码超时也归类为“失败：响应超时” |

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
node src\server\routes\admin.orders.test.js
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
- **后台数据批处理**: `D:/www/g-daipai/src/admin/src/DataBatch.tsx`
- **后台运费更新 Tab**: `D:/www/g-daipai/src/admin/src/ShippingRefresh.tsx`
- **后台商品类型更新 Tab**: `D:/www/g-daipai/src/admin/src/ProductTypeRefresh.tsx`
- **后台落札商品更新 Tab**: `D:/www/g-daipai/src/admin/src/OrdersResync.tsx`
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

---

## 2026-06-01 交易开始功能当前进度

> 注意：本节为后续接手排查用。当前 `agents.md` 文件在终端中可能显示为乱码，但本节内容以当前需求为准。

### 当前状态

- 分支：`codex/transaction-start`。
- 已新增交易开始相关设计文档：`docs/superpowers/specs/2026-06-01-yahoo-transaction-start-design.md`。
- 已新增实施计划：`docs/superpowers/plans/2026-06-01-yahoo-transaction-start-plan.md`。
- 交易开始已按 2026-06-05 业务确认重新开启：`yahoo-plugin/background.js` 中 `TRANSACTION_START_ENABLED` 生产默认开启。
- 已在本地数据库把当天自动交易开始标记关闭：`transaction_start_requested=0`，`transaction_start_last_run_date=当天`。
- 停用原因：真实 Yahoo 页面测试时交易开始流程仍存在 tab 跟踪和按钮点击问题，继续运行会反复打开 Yahoo tab。

### 已实现内容

- `orders` 新增兼容字段：`transaction_url`、`bundle_group_id`、`transaction_started_at`、`transaction_start_error`。
- `/my/won` 落札同步尝试抽取每个商品的 `取引連絡` 链接，保存到 `orders.transaction_url`。
- 后台配置页已改为“入札、落札、交易开始、扫描、付款、收货配置”。
- 后台新增“手动执行交易开始”按钮：`POST /api/admin/transaction-start/request`。
- 后台新增“初始化订单状态”按钮：`POST /api/admin/transaction-start/reset-orders`。
- 后台订单管理页新增 `交易开始flag`、`扫描flag`、`交易开始错误`，并显示新状态 `等待运费`、`待同捆`。
- 插件空闲同步流程已预留交易开始、扫描、付款、确认收货；扫描/付款/确认收货尚未实现。

### 业务规则确认

- “初操作”和“交易开始”是同一个业务名称，后续统一使用“交易开始”。
- 交易开始只处理 `orders.order_status` 为空的落札订单。
- 商城商品：不用打开 Yahoo 取引页，直接 `pending_payment`（待支付）。
- 普通商品：必须先进入 `取引連絡` 页面判断是否同捆。
- 普通商品如果没有同捆：
  - 运费不是 `落札者負担`：订单状态改为 `pending_payment`（待支付），关闭 tab。
  - 运费是 `落札者負担`：订单状态改为 `waiting_shipping`（等待运费），关闭 tab。
- 普通商品如果有同捆：
  - 关闭 Yahoo 同捆提示弹窗。
  - 抽取同捆列表商品 ID。
  - 用页面 `X件（落札数量：X）` 校验抽取数量。
  - 点击 `まとめて取引を依頼する` 或 `まとめて取引をはじめる`。
  - 到确认页点击 `決定する`。
  - 看到完成文案后，把同组所有订单标为 `pending_bundle`（待同捆）并写同一个 `bundle_group_id`。
  - 标记待同捆应发生在完成文案确认后、关闭 tab 前。

### 当前真实测试问题

真实 Yahoo 页面上仍有未解决问题：

1. 普通未同捆商品进入 `取引連絡` 后，状态能变化但 tab 没有可靠关闭。
2. 同捆商品页面点击 `閉じる` 后停在“まとめて取引”图1页面。
3. `まとめて取引を依頼する` 按钮页面 HTML 中存在类似 `まとめて取引を依頼する</button>`，但插件点击逻辑仍没有稳定触发跳转。
4. 曾出现重复开 tab；目前已尝试通过记录新增 tab 和关闭本次流程 tab 缓解，但未在真实页面确认完全可靠。
5. 曾出现 `bundle decide button not found`，原因推测是 `まとめて取引を依頼する` 点击后 Yahoo 新开/切到确认页 tab，而 background 仍在旧 tab 找 `決定する`。
6. `/my/won` 按商品 ID 找 `取引連絡` 时需要避免匹配到外层大容器，否则可能点错商品。

### 下一步计划

交易开始重新启用前，建议先做诊断版，不要继续盲改点击逻辑：

1. 旧计划要求保持 `TRANSACTION_START_ENABLED = false`；2026-06-05 已按最新业务确认改为生产默认开启，后续如再遇到真实页面异常再临时熔断。
2. 增加单商品诊断接口/按钮，只对指定商品 ID 执行一次交易开始，且不循环处理全部订单。
3. 在 `content.js` 的图1页面输出诊断信息：候选按钮数量、`tagName`、`textContent`、`value`、`disabled`、`href`、`onclick`、`role`、`getBoundingClientRect()`、点击前后 URL、点击前后 tab 数量。
4. 点击 `まとめて取引を依頼する` 后，background 必须确认当前 tab URL 是否变化、是否新开 tab、新 tab 是否为确认页、确认页是否存在 `決定する`。
5. 普通非同捆商品状态更新后，必须关闭本次流程创建或打开的所有 Yahoo 交易相关 tab。
6. 同捆流程失败时，应把同组商品加入本轮 processed 集合，避免同一组反复打开。
7. 2026-06-05 已把 `TRANSACTION_START_ENABLED` 恢复为生产默认开启。

### 最近验证命令

以下命令在当前改动过程中曾通过：

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-02 扫描功能当前进度

### 当前状态

- 分支：直接在 `master` 开发；之前临时分支已清理，只保留 `master` / `origin/master`。
- 扫描任务复用现有空闲调度 `action: 'scan'`，后台“手动执行扫描”只把扫描 flag 更新为 5，不改变原调度架构。
- 不再新增或修改计划文件；后续功能直接按确认后的业务规则实现代码。

### 已实现内容

- `orders` 新增兼容字段：`bundle_shipping_fee_text`，用于同捆运费。
- 后台订单管理新增“同捆运费”列，仅后台展示；用户端和其他费用计算仍使用原 `shipping_fee_text`。
- 后台订单状态新增显示：
  - `waiting_shipping`：等待运费
  - `pending_bundle`：待同捆
  - `bundle_completed`：同捆完了
- `scan` 任务现在会获取：
  - `waiting_shipping`（等待运费）
  - `pending_bundle`（待同捆）
- `waiting_shipping` 扫描规则：
  - 只从 `支払い金額` 的括号内容里提取 `送料：xxx円`，不能取括号前总金额。
  - 有真实送料时，更新订单运费并改为 `pending_payment`。
  - 如果页面仍显示 `送料決定後、確定します。`，保持 `waiting_shipping` 不变。
- `pending_bundle` 扫描规则：
  - 页面显示 `まとめて取引を依頼中です。出品者からの連絡をお待ちください。`：不更新，关闭 tab。
  - 子商品弹窗 `出品者が、この商品を含めたまとめて取引に同意しました。取引内容をご確認ください。`：不更新，关闭 tab。
  - 主商品弹窗 `出品者がまとめて取引に同意しました。出品者から配送方法の連絡が届いています。確認し取引情報の入力へ進んでください。`：先点 `閉じる` 后继续判断。
  - 如果页面显示配送方法金额，如 `配送方法 定形郵便（110円）`：主商品 `bundle_shipping_fee_text=110円` 且 `order_status=pending_payment`；同组其他商品 `bundle_shipping_fee_text=0円` 且 `order_status=bundle_completed`。
  - 如果取引ナビ付款信息显示 `支払い金額 ... 送料：1,620円`：按同捆主商品处理，提取 `送料` 的金额，不取总金额。
  - 如果没有具体运费，会点击 `取引情報を入力する` -> `決定する` -> `確定する`；最终仍是 `送料決定後、確定します。` 时，保持 `pending_bundle` 不变。
  - 如果弹窗显示卖家希望单品交易：同组所有订单清空 `order_status`、`bundle_group_id`、`bundle_shipping_fee_text`，让后续交易开始按单品重新处理。

### 最近修复

- 同捆主商品成功后 tab 残留的根因不是完全没写关闭，而是原关闭范围只包含当前 `tab.id` 和已记录的 `_gdaipaiCreatedTabIds`；Yahoo 流程中新开/切换但未被记录的交易页可能漏关。
- 已新增扫描专用清理：扫描开始前记录已有 tab，结束时关闭本次扫描中新出现的 Yahoo 交易相关 tab。
- 主商品成功或同捆失败后，本轮扫描会跳过同一个 `bundle_group_id` 的剩余旧 job，避免同组子商品在本轮继续打开页面。

### 最近验证命令

以下命令在当前扫描改动过程中通过：

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\task.test.js
node src\server\routes\proxy.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\admin
npm run build
Set-Location ..\client
npm run build
```

---

## 2026-06-03 付款功能当前进度

### 当前状态

- 分支：`codex/payment-automation`。
- 已实现付款框架：后台结算/支付入口、全局付款 flag、付款提醒栏、付款配置、服务端付款队列、插件空闲调度付款分支。
- Yahoo 付款页面具体点击和成功/已结款 DOM 判断处于安全暂停状态，等待真实页面图片和 HTML 后补充。

### 已实现规则

- 结算自动勾选 `pending_payment` 和 `bundle_completed`。
- `pending_payment` 结算后进入 `pending_settlement`。
- `bundle_completed` 结算后保持 `bundle_completed`，不进入付款流程。
- 结算金额优先使用 `bundle_shipping_fee_text`，否则使用 `shipping_fee_text`。
- 特殊用户费用覆盖逻辑保持不变。
- 支付按钮只允许 `pending_settlement` 且应付款不为空的订单。
- `payment_requested=1` 时插件才执行付款队列。
- 本批成功后 flag 保持 1；直到没有剩余 `pending_settlement` 且应付款不为空的订单时才清 0。
- 付款失败时只显示全局提醒并暂停 flag，订单保持 `pending_settlement`。

---

## 2026-06-04 普通商品付款细节当前进度

### 当前状态

- 已按真实页面截图补充普通商品付款点击流程。
- 普通商品付款已实现；商城商品付款细节已在 2026-06-05 根据截图补充。
- 插件代码更新后，生产服务器 Chrome 扩展必须手动重载 `yahoo-plugin/` 才会生效。

### 已实现规则

- 打开订单 `transaction_url` 后先判断是否已支付。
- 页面出现 `出品者に支払い完了の連絡をしました。商品の発送連絡をお待ちください。` 时，按已支付处理，订单状态改为 `pending_shipment`（待发货），关闭 tab。
- 普通商品入口支持三种页面类型；其中前两种不需要前置操作，第三种需要先输入取引情報：
  - `Yahoo!かんたん決済で支払う`
  - `購入手続きする`
  - `取引情報を入力する` -> `決定する` -> 弹窗 `確定する`，完成后回到 `Yahoo!かんたん決済で支払う` 页面，再进入相同支付步骤。
- 进入购买手续页后，点击右侧订单金额下方 `確認する`。
- 点击前会校验页面显示支付金额是否等于 `final_price + effectiveShippingFeeText`；不一致则失败，不继续付款。
- 进入确认页后，点击 `上記に同意のうえ 購入を確定する` / `購入を確定する`。
- 最终确认页先按后台 `payment_page_stay_seconds` 取 `1-X` 秒随机停留，再点击最终确认。
- 完成页出现 `購入が完了しました！` 时，订单状态改为 `pending_shipment`，关闭 tab。
- 出现任何未知页面、金额不一致或按钮缺失，均按失败处理：写付款提醒栏、`payment_requested=0`、关闭 tab；处理中页只作为中间页继续等待完成页。

### 最近验证命令

以下命令在当前普通商品付款改动过程中通过：

```powershell
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\task.test.js
node src\server\routes\proxy.test.js
node src\client\src\utils\bidPrice.test.mjs
```

---

## 2026-06-04 用户策略权限当前进度

### 当前状态

- 后台“用户账号管理”新增“可用出价策略”选项。
- 用户端提交任务页会按当前操作账号权限限制策略选择。
- 服务端 `/api/task/submit` 增加兜底校验，防止绕过前端直接提交不允许的策略。

### 已实现规则

- `users.bid_strategy_scope` 新增兼容字段，默认 `all`。
- 后台可选：
  - `全部都可以拍`：允许即时拍、多次出价、结束前 1/2/5/10 分钟。
  - `只能即时拍`：仅允许 `direct` 即时拍；即決模式也按即时拍处理。
- 前台登录用户等级为管理员（`user_level=3`）时不受被代拍用户策略限制；例如管理员选择只能即时拍的用户 A 代拍，仍可提交全部策略。
- `/api/auth/acting-users` 返回当前可操作账号的 `bid_strategy_scope`。
- 用户端账号切换时保存当前账号策略权限。
- 用户端提交页：
  - `只能即时拍` 用户只显示 `即时拍（立即）`。
  - 如果当前策略已是其他策略，会自动切回 `direct`。
  - 提交时再次检查，避免旧状态提交。
- 服务端提交页：
  - `direct_only` 用户提交 `multi_bid` 或结束前策略会返回 `403` 和 `该用户只能使用即时拍策略`。

### 最近验证命令

以下命令在当前策略权限改动过程中通过：

```powershell
node src\server\routes\task.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\plugin.test.js
node src\server\routes\proxy.test.js
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
Set-Location src\admin
npm run build
Set-Location ..\client
npm run build
```

---

## 2026-06-04 即时拍误判商品已结束排查

### 问题现象

- 生产服务器出现同一商品两条即时拍任务：
  - 较早提交任务显示 `失败：商品已结束`。
  - 稍后重新提交的同商品任务正常进入 `已出价`。
- 本地没有该生产数据，无法直接查询原始 `tasks.error_msg/end_time`。

### 排查结论

- 前台 `失败：商品已结束` 有两个来源：
  - 服务端 `expireOverduePendingTasks()` 写入 `Auction ended before plugin execution`。
  - 插件打开商品页后，`ensureTaskReadyByCurrentEndTime()` 根据商品页快照 `snapshot.endTime` 判断已结束。
- 同商品后续即时拍可以再次提交是当前规则允许的：`direct` 即时拍不属于“禁止重复提交”的自动策略；失败任务不会阻止后续重新提交。
- 本次代码中发现一个可导致误判的风险：`content.js` 的商品快照结束时间提取最后会从整页 body 文本抓第一个日期。Yahoo 页面若先出现出品日期、广告日期或其他非结束日期，插件可能把该日期当作结束时间，从而把任务标记为商品已结束。

### 已修复内容

- `yahoo-plugin/content.js`：
  - 商品快照 `endTime` 只接受明确结束时间来源：`endDate` meta、JSON-LD `priceValidUntil`、`time[datetime]`、`data-end-time`、结束时间相关节点里的完整日期。
  - 删除整页 body 第一个日期兜底，避免把非结束日期当成结束时间。
- `yahoo-plugin/background.js`：
  - 插件根据商品页快照判定已结束时，错误信息改为稳定英文 `Auction ended according to product page snapshot`，便于后续和服务端过期扫描区分。
  - 当时按前置要求保持 `TRANSACTION_START_ENABLED = false`；2026-06-05 已按最新业务确认恢复为生产默认开启。
- `yahoo-plugin/content.test.js`：
  - 新增测试：body 中普通日期不得作为 `endTime`。
  - 新增测试：明确 meta 结束时间仍可正常提取。

### 生产排查建议

如需确认截图中那条失败任务的真实来源，在生产服务器执行：

```powershell
Set-Location C:\www\g-daipai
@'
const db = require('./src/server/models');
const rows = db.db.prepare(`
  SELECT id, user_id, product_id, current_price, max_price, strategy, status,
         error_msg, end_time, created_at, updated_at
  FROM tasks
  WHERE product_id = 'r1232049114'
  ORDER BY id ASC
`).all();
console.log(JSON.stringify(rows, null, 2));
'@ | node
```

### 最近验证命令

以下命令在当前修复中通过：

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-04 统计页面金额口径修正

### 当前规则

- 用户端“统计页面”的近 30 天合计金额和每日柱状图金额，直接汇总 `orders.final_price`。
- `orders.final_price` 是 Yahoo 落札页抓取的最终落札金额；商城商品落札金额已是最终金额，不再按 `tax_included` 额外乘 `1.1`。
- 统计金额不包含运费、银行手续费、手续费 RMB、大金额费用，也不使用订单管理页的应付款。

### 已修复内容

- `/api/task/won-stats` 每日金额 SQL 从按 `t.tax_type = 'tax_included'` 额外乘 `1.1`，改为 `SUM(COALESCE(o.final_price, 0))`。
- 更新 `src/server/routes/task.test.js`，明确统计 SQL 不应包含 `tax_included` 或 `final_price * 1.1`。

### 最近验证命令

```powershell
node src\server\routes\task.test.js
node src\client\src\utils\wonStats.test.mjs
```

---

## 2026-06-05 商城订单空状态排查与修复

### 问题现象

- 生产截图显示后台订单中有 3 个商城商品（商品 ID 后红色 `商`），但 `订单状态` 为空，没有自动变成 `待支付`。
- 顶部状态显示：`交易开始flag: 0`，`扫描计数: 4 / 5`，`最近执行：自动 2026-06-04 00:00:45，取到 2 单，商城直接待支付 0 单，插件任务 2 单`。
- 表格里的 `最后操作时间` 是订单落札同步/更新订单的时间，不等于交易开始执行时间。

### 根因结论

- 商城商品变为 `pending_payment` 的逻辑在服务端 `/api/plugin/transaction-start/jobs` 内执行。
- 之前 `yahoo-plugin/background.js` 中 `TRANSACTION_START_ENABLED = false` 时，插件遇到 `idleAction.action === 'transaction_start'` 会完全跳过交易开始 jobs 接口。
- 这会导致普通商品真实 Yahoo 交易开始被安全停用的同时，商城商品的“服务端直接待支付”也被一起跳过。
- 扫描任务只处理 `waiting_shipping` 和 `pending_bundle`，不会处理 `order_status` 为空的商城订单，所以扫描计数到 5 也不会让这些商城订单变状态。

### 已修复内容

- 按最新业务确认，`TRANSACTION_START_ENABLED` 生产默认已改为开启：普通商品交易开始和商城商品直达待支付都会执行。
- 当空闲 action 为 `transaction_start` 时，插件会调用 `/api/plugin/transaction-start/jobs`；商城订单由服务端直接更新为 `pending_payment`，普通商品 jobs 由插件打开 Yahoo 取引页执行。
- 保留测试注入关闭普通交易开始的能力：`runTransactionStartJobs({ processNormalJobs: false })` 只刷新服务端商城状态，不打开普通商品交易 tab，用于以后需要临时熔断普通交易开始时保护商城订单。
- 新增插件回归测试：
  - `runTransactionStartJobs({ processNormalJobs: false })` 会请求 jobs 接口，但不会打开交易 tab。
  - 空闲调度遇到 `transaction_start` 且普通交易开始关闭时，仍会请求 jobs 接口并完成该 idle action。

### 生产处理注意事项

- 部署本次插件代码后，必须在服务器 Chrome 扩展页手动重载 `yahoo-plugin/`。
- 重载后可点击后台“手动执行交易开始”的“加入执行队列”，下一次插件空闲同步会处理空状态订单：商城直接改为 `待支付`，普通商品进入 Yahoo 交易开始流程。
- 自动执行也会在次日交易开始整点后处理前一天晚于上次交易开始同步到 `orders` 的订单。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-05 付款任务随机化与等待点调整

### 业务规则确认

- 后台 `付款流程执行任务数` 改为范围配置：最小 X 到最大 X 个，例如 `2-5`。
- `payment_requested=1` 时，服务端每次从该范围内随机取一个整数作为本批付款任务数量，例如 `2/3/4/5`，再按落札时间顺序取对应数量的 `pending_settlement` 订单。
- `付款页面停留时间(秒)` 含义改为最大停留秒数 X。
- 插件进入最终确认页（存在 `上記に同意のうえ 購入を確定する` / `購入を確定する`）后，先随机停留 `1-X` 秒，再点击最终确认按钮；不允许 0 秒。
- 点击最终确认后出现 `ただいま決済処理中です。しばらくお待ちください。` 属于中间页，插件继续等待完成页，不按失败处理。
- 看到 `購入が完了しました！` 等完成文案后，订单状态改为 `pending_shipment`，关闭 tab。

### 已修复内容

- `src/admin/src/MultiBidSettings.tsx`：
  - 付款任务数改成 `paymentJobLimitMin` / `paymentJobLimitMax` 两个输入。
  - 付款页面停留时间最小值保持 `1` 秒。
- `src/server/routes/admin.js`：
  - 后台配置接口读写 `payment_job_limit_min` / `payment_job_limit_max`，并继续写 `payment_job_limit` 作为旧配置兼容。
  - 校验最小任务数不得大于最大任务数。
- `src/server/routes/plugin.js`：
  - `/api/plugin/payment/jobs` 按配置范围随机生成本批 limit，并返回 `limitMin/limitMax/limit`。
  - 未配置新字段时，继续用旧 `payment_job_limit` 作为固定数量。
- `yahoo-plugin/background.js`：
  - 最终确认页点击前随机等待 `1-X` 秒。
  - 图3处理中页不再作为失败状态，等待后续完成页。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-05 后台付款提醒栏商品 ID 链接

### 已修复内容

- 后台顶部付款提醒栏（`payment_alert_message`）中的商品 ID 现在会渲染为可点击链接。
- 链接目标为 `https://auctions.yahoo.co.jp/jp/auction/{商品ID}`，点击后新窗口打开 Yahoo 商品页。
- 支持 `商品ID p123456789` 或提醒文本中出现的拍卖 ID 自动识别。

### 最近验证命令

```powershell
Set-Location src\admin
npm run build
```

---

## 2026-06-05 商城商品付款流程补充

### 业务规则确认

- 商城商品付款不再禁用。
- 付款任务打开商城商品 `取引連絡` / `transaction_url` 后，如果进入 `buy.auctions.yahoo.co.jp/order/status?...` 页面并出现红色 `購入手続きする`，插件点击该按钮。
- 点击 `購入手続きする` 后，后续进入普通商品付款步骤 A，继续复用普通商品付款流程；如果先出现 `Yahoo!かんたん決済で支払う`，会继续点击该入口，再进入确认金额 -> `確認する` -> `購入を確定する` -> 等待完成页。
- `購入が完了しました！` 是付款成功页面，普通商品和商城商品都适用；订单状态改为 `pending_shipment`（待发货），关闭 tab。
- 商城状态页出现 `ご購入ありがとうございます。商品の発送連絡をお待ちください。`，表示之前已经付款；订单状态改为 `pending_shipment`（待发货），关闭 tab。

### 已修复内容

- `yahoo-plugin/background.js` 移除 `productType=store` 付款禁用逻辑。
- 付款页面状态解析抽出为 `buildPaymentPageStateFromSnapshot`，便于覆盖真实截图文案。
- 成功识别补充：
  - `購入が完了しました！` -> `complete=true`
  - `ご購入ありがとうございます。商品の発送連絡をお待ちください。` -> `alreadyPaid=true`
- 商城入口 `購入手続きする` 使用现有 `purchaseProcedure` 点击动作；付款入口链支持连续处理 `購入手続きする` -> `Yahoo!かんたん決済で支払う` -> `確認する`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```
