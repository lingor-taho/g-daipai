# g-daipai 项目状态

**最后更新**: 2026-06-11

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
│   │   ├── ManualOrderImport.tsx — 手动落札导入，日期范围、最多翻页、候选订单用户分配
│   │   ├── ShippingRefresh.tsx      — 按商品 ID 批量刷新运费
│   │   ├── ProductTypeRefresh.tsx   — 按商品 ID 批量刷新商品类型
│   │   ├── OrdersResync.tsx         — 按商品 ID 批量刷新落札商品
│   │   └── ProductDataDelete.tsx    — 按商品 ID 批量删除任务、订单、日志、入札缓存
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

### 移动端适配

后台现在按屏幕宽度响应式切换：

- 桌面端（`>=768px`）保持原来的左侧菜单和 20px 内容间距。
- 手机端（`<768px`）隐藏左侧菜单，底部固定单行横向滚动导航：任务、账号、配置、清理、批量、导入、特殊、订单。
- 手机端顶部高度压缩为 52px，显示后台标题、Yahoo 登录状态、当前用户和退出按钮。
- 手机端内容区全宽，padding 改为 10px，并预留底部导航安全距离。
- 订单管理页手机端操作区改为纵向/换行布局，表格保留横向滚动，不强行压缩列。
- 系统配置页已分流程拆 Card，手机端保持单列表单；付款任务的最小/最大任务数在手机端自动上下排列。
- 数据批处理 Tabs 在手机端允许横向滚动。

### 菜单折叠（移动端优化）

后台支持菜单折叠功能，适配移动端查看：

- **展开状态**（210px）：显示完整菜单名称，无滚动条
- **折叠状态**（50px）：只显示菜单第一个字，最大化内容区域

菜单映射：

| 完整名称 | 折叠显示 |
|---------|---------|
| 任务报表 | 任 |
| 账号管理 | 账 |
| 系统配置 | 系 |
| 清理数据 | 清 |
| 数据批处理 | 批 |
| 导入订单 | 导 |
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
| 2026-06-08 | 出价失败后即时落札兜底可能误把关联商品写成成功订单 | 插件出价执行报错时不再立即打开 `/my/won` 做 `confirmWonBeforeFail` 兜底，失败直接标记 `failed`；后续空闲落札同步只抽取同一商品容器内存在 `取引連絡` 链接的记录，避免页面底部推荐/关联商品被误同步为落札订单 |
| 2026-06-08 | 后台订单管理商品信息和运费显示不够直观 | 商品 ID 后新增“商品名称”（前 20 字，多余 `...`）和“落札时间”；移除单独“同捆运费”列，有同捆运费时在“运费”列显示 `原运费->同捆运费`，如 `780円->0円` |
| 2026-06-09 | `落札者負担` 商品抓取过慢 | 商品页已能构造 Yahoo shipment API URL 时最多只尝试一次 shipment API；如果未返回有效金额，直接保留页面解析到的 `落札者負担`，不再继续 Playwright 重复兜底 |
| 2026-06-09 | 点击 `取引連絡` 后出现 Chrome/Google PIN 浮层导致交易开始卡住 | PIN 页检测支持 `login.yahoo.co.jp/config/login?auth_lv=1...`；PIN 输入改为优先通过 Chrome debugger 发送真实数字键事件；验证码页继续人工录入日文并点击 `続ける`，正确后自动复用上次 PIN 完成二次 PIN |
| 2026-06-09 | 用户端显示网站汇率数值 | 提交页不再展示 `网站汇率` 数值或加载文案；汇率仍保留为内部人民币辅助出价换算和可用性判断使用 |
| 2026-06-09 | 商城即決商品 `q1175609593` 失败显示“低于当前价” | 即決不是最高价出价，而是按页面固定价格点击购买/落札；buyout 任务的价格字段仅用于展示/记录，不再参与 `current_price > max_price` 或税后合计金额高于用户最高价等普通出价失败判断 |
| 2026-06-09 | 商城购买确认页误点 PayPay `特典を確認する` 导致广告页反复打开 | 后台付款流程和即決购买流程都改为只从真正可点击元素中匹配完整文本严格等于 `確認する` 的按钮/链接，优先 `<a>確認する</a>`；`q1175609593` 走的是 `content.js` 即決购买流程，广告链接完整文本是 `特典を確認する`，不再因相似文案被误点 |
| 2026-06-09 | 商城即決最终确认弹窗反复点击前一页 `確認する` 导致超时 | `確認する` 精确匹配只用于购买内容确认页；最终弹窗 `購入を確定する` 作为 buyout 最终提交按钮单独识别，点击一次后等待 `購入が完了しました / ご購入ありがとうございます` 等完成文案，不再递归回去重复点前一页按钮 |
| 2026-06-09 | 商城即決最终确认按钮被重复提交 | 后台 pending final 二次检查等待从 3 秒改为 10 秒；`content.js` 对 buyout 最终 `上記に同意のうえ購入を確定する` 加同页幂等保护，点过一次后只等待完成结果，后续检查不再重复点击同一个最终购买按钮 |
| 2026-06-09 | 商城即決最终弹窗按钮完整文案不是单独 `購入を確定する` | `content.js` 新增专用 `findBuyoutFinalPurchaseButton()`，最终弹窗只从可点击元素中匹配包含 `購入を確定する` 的提交按钮；前一页 `確認する` 仍只由购买内容确认页专用逻辑处理，普通即決 `落札する` 兜底保留 |
| 2026-06-09 | 商城即決成功页 `/order/thank-you` 未识别导致显示“失败：系统原因”且 tab 不关闭 | `content.js` 把 `/order/thank-you` 明确识别为 buyout 成功页；真实页文案为 `購入が完了しました！`，识别成功后后台会按正常成功流程关闭任务 tab |
| 2026-06-09 | 商城即決无同捆勾选框时自动付款完成但订单应付款未计算 | 最终不新增自动付款标记；该类订单按商城正常流程空状态→待支付→结算→待结算→支付，支付页若已付款会以 `already_paid/success` 更新为 `pending_shipment`（待发货）。关键修正是商城 `落札者負担` 允许按 0 运费结算 |
| 2026-06-09 | 待发货订单结算后误进入支付流程风险 | 支付入口继续只允许 `pending_settlement` 且有应付款的订单；后台支付请求接口如果没有命中任何 `pending_settlement` 订单，不再写 `payment_requested=1`，避免待发货订单误触发付款任务 |
| 2026-06-09 | 后台批处理订单状态更新缺少“待发货” | “数据批处理 / 订单状态更新”下拉新增 `待发货`，后端 `order-status-refresh` 白名单允许 `pending_shipment`，用于手动修正已付款的商城即決订单 |
| 2026-06-09 | 商城即決待发货订单运费 `落札者負担` 导致不能勾选结算 | 后台结算规则增加商城例外：`product_type=store` 且运费文本为 `落札者負担` 时允许结算，并按 0 运费计算；普通商品仍不允许用 `落札者負担` 结算 |
| 2026-06-09 | 插件 JS 中存在不可恢复乱码字符 | 清理 `background.js` 中已坏掉的 `�/锟斤拷` 字符串，改为英文稳定错误/日志和 `\u5186`；新增 `yahoo-plugin/encoding.test.js`，扫描 `content.js/background.js`，发现 `�` 或 `锟斤拷` 立即失败，避免后续继续混入不可恢复乱码 |
| 2026-06-09 | 普通付款页未点击 `確認する` 就关闭，提示 `payment expected amount unavailable` | 根因不是 PayPay `特典を確認する` 广告按钮，而是付款前金额校验遇到无金额运费文本时直接失败。业务规则确认：`無料`、`着払い` 对所有商品都按 0 运费计算；`落札者負担` 只作为商城商品特殊规则按 0 运费计算。确认商品 `x1232305352` 是 `着払い`，插件付款校验已对齐该规则。新增截图场景测试，确认 PayPay 特典金额 `51,000円` 不会覆盖真实付款合计 `56,000円` |
| 2026-06-09 | 需要导入服务器 Chrome 手动落札订单 | 后台新增独立菜单“导入订单”，位置在“数据批处理”下方；页面支持默认昨天到今天、最多翻页默认 10、创建读取批次、候选订单可搜索选择归属用户、确认后写入 `tasks/status=success` 和 `orders/order_status=NULL`。插件在 D 扫描流程最前面优先执行导入批次，从 `/my/won` 最新列表翻页到日期范围之外或达到最大页数，补商品页快照运费/商品类型；正式导入后自动置 `transaction_start_requested=1`，后续从现有交易开始流程继续 |
| 2026-06-10 | 服务器上累积多个 Yahoo/Chrome PIN 窗口，且过期 PIN 页输入无动作 | `background.js` 把 `login.yahoo.co.jp/config/login?auth_lv=1...` 纳入 PIN 页识别；空闲非出价任务开始前如果已有 PIN 页，会暂停入札/落札/交易/扫描/付款/收货等 idle 流程，只保留一个 PIN tab 并关闭重复 PIN tab，出价任务仍按原轮询优先执行；后台提交 PIN 后，插件会先刷新 PIN 页、等待约 2 秒，再通过 Chrome debugger 发送数字键，避免超时错误页吞掉输入 |
| 2026-06-10 | PIN 页刷新后没有填入后台输入的 PIN | 后台提交 PIN 后仍会先刷新 PIN 页并等待约 2 秒；PIN 输入统一由 Chrome debugger 处理，后续已调整为真实键盘优先，避免刷新后的 Chrome PIN 浮层不接收普通脚本输入 |
| 2026-06-10 | PIN 成功后进入验证码，验证码后又出现新 PIN 页导致反复要求输入 PIN | 手动验证跳转不再只盯当前 tab；验证码/PIN 提交后会扫描本轮新开的 Yahoo 验证 tab，并优先切到新 PIN tab。若同一轮已有后台 PIN，会继续复用该 PIN 处理验证码后的二次 PIN，不再把它当成新的独立 PIN 挑战 |
| 2026-06-10 | 验证码阶段没有 PIN tab，空闲任务又打开新的 PIN 页造成循环 | 新增手动验证流程锁：只要出现 PIN 或验证码 tab，就标记 `manualVerificationFlowActive`；在 PIN/验证码整轮流程结束、没有任何验证 tab 前，所有入札/落札/交易/扫描/付款/收货等非出价 idle 任务都暂停，避免验证码页面期间重新触发新的 PIN |
| 2026-06-10 | Chrome 密码管理工具 PIN 浮层不接收 `Input.insertText` | PIN 输入改为默认模拟真实键盘：每个数字通过 Chrome debugger 发送 `rawKeyDown -> char -> keyUp`；`Input.insertText` 只作为真实键盘失败或页面仍停留 PIN 时的备用路径 |
| 2026-06-10 | Chrome debugger 真实键盘事件仍无法输入 Google 密码管理工具 PIN 浮层 | 新增服务端系统级输入接口 `POST /api/plugin/manual-pin/type`，由 Windows API Server 调用 `powershell.exe -STA` 执行 Win32 鼠标/键盘事件：先点击 PIN 输入区域，再用 `keybd_event` 逐位输入数字；插件刷新并激活 PIN tab 后优先调用该接口，失败时才退回 Chrome debugger 输入 |
| 2026-06-10 | PIN tab 打开但不一定在最前台，系统级输入可能发错窗口 | PIN 系统级输入前，插件会把 PIN tab 所在 Chrome 窗口恢复为 normal 并聚焦，再将目标 tab 设为 active/highlighted，短等后再次聚焦窗口，并把当前 tab 标题传给服务端用于优先激活正确 Chrome 窗口 |
| 2026-06-10 | PIN 输入失败时可能空 PIN 直接回车导致 Yahoo passkey 登录失败 | 服务端系统级 PIN 输入不再发送 Enter，也不再使用 `SendKeys.SendWait($pin)`；改为点击 PIN 框后只逐位模拟数字键，让 Chrome PIN 浮层自行校验，避免“未输入数字但回车提交空 PIN” |
| 2026-06-10 | PIN 输入成功进入验证码后立刻又回到 PIN 页 | 修复验证跳转选择优先级：如果当前 tab 已经是 `login.yahoo.co.jp/ncaptcha` 验证码页，即使旁边还有旧的 active PIN tab，也继续停留并处理当前验证码；只有新开的 PIN tab 才优先用于验证码通过后的二次 PIN |
| 2026-06-10 | 到达文字验证码页后 tab 被关闭，又重新打开新的 PIN 页 | `closeTabsForTransactionFlow()` / `closeTabsForScanFlow()` 清理交易/扫描临时 tab 时会二次读取 tab URL，跳过 `PIN/文字验证码` 手动验证 tab；即使验证码 tab 已记录在 `_gdaipaiCreatedTabIds` 中，也不再被 finally 清理关闭 |
| 2026-06-10 | 验证码页保留后仍新开 PIN，后台继续要求输入 PIN | 空闲入口发现已打开 `login.yahoo.co.jp/ncaptcha` 时，不再只暂停或优先处理 PIN；会激活验证码 tab 并调用 `handleManualVerificationIfPresent()` 截图提交 `type=captcha` 挑战到后台，覆盖旧 PIN 提示，同时阻断后续非出价 idle 任务继续打开新 PIN |
| 2026-06-10 | 验证码页出现后数分钟内后台仍停留 PIN 提示 | `syncIdleYahooPages()` 先处理已打开的 PIN/验证码 tab，再检查 `lastIdleSyncAt` 空闲同步间隔；手动验证不再被 idle 间隔节流挡住，避免验证码页已存在但插件不截图、不覆盖后台 PIN 提示 |
| 2026-06-10 | 后台菜单和订单参数位置需要调整 | 后台“用户账号管理”和“服务器账号”合并为“账号管理”，页面用 Tabs 展示两个功能；手机底部菜单改为单行横向滚动；订单管理顶部银行手续费/手续费/大金额费用参数移动到“特殊用户设置”页顶部，保存接口和功能不变 |
| 2026-06-10 | 付款失败后台提醒过长 | `/api/plugin/payment/status` 保存 `payment_alert_message` 前会摘要化错误，只保留商品 ID 和核心原因；过滤 `url/controls/candidates/synthetic/trusted` 等调试字段。类似 `action=review; wait=payment next page did not appear` 会显示为 `确认付款后页面未跳转`，便于手机端查看 |
| 2026-06-10 | 商品 `j1232680017` 付款点击确认后仍停留在 review 页 | 根因是 review 页存在 `ストアからの確認事項`，需要先点该区块右侧 `変更`，在编辑页把所有 checkbox 勾选后点击红色 `変更する` 返回 review 页，再继续点击右侧 `確認する`。插件付款流程已在 review 确认前增加该前置步骤，每个订单本轮只处理一次，避免重复进入确认事项页面 |
| 2026-06-10 | 店铺确认事项按钮按文本/区块扫描仍可能找不到或 JS click 不生效 | 根据真实 DOM 固定优先使用 `#cartopt a[data-cl-params*="_cl_link:cartopt"]` 点击 review 页 `変更`，使用 `#confirm a[data-cl-params*="_cl_link:update"]` 点击确认事项页红色 `変更する`；如果普通 JS click 后未进入下一页/未返回 review，会用 Chrome debugger 按元素中心点补一次真实鼠标点击，避免页面迅速关闭前实际没有完成变更 |
| 2026-06-10 | 店铺确认事项页面仍快速关闭，疑似未实际点击 `変更` | 店铺确认事项改为 Chrome debugger 真实鼠标点击优先：先按 `#cartopt` 的 `変更` 中心点真实点击进入编辑页；编辑页先只勾选所有 checkbox，不再先 JS 点击提交，再按 `#confirm` 的 `変更する` 中心点真实点击。若该子流程失败，本轮付款 tab 暂不关闭，便于现场观察停留页面；后台失败原因也按店铺确认事项细分显示 |
| 2026-06-10 | 店铺确认事项 review 页停留，`変更` 没进入编辑页 | 付款页状态识别新增 DOM 标记：`#cartopt` 直接判定存在店铺确认事项，`#confirm a[data-cl-params*="_cl_link:update"]` 判定编辑页。点击 `#cartopt` 后如果 15 秒未进入编辑页，会再执行一次主页面 DOM 点击同一按钮并继续等待，失败时保留 tab 并返回 `store confirmation edit page did not appear after trusted+js click` 方便定位 |
| 2026-06-10 | 查看源代码里没有 `変更`，说明按钮由 Yahoo 前端后渲染 | 模拟确认：源 HTML 只有 `ストアからの確認事項`，没有 `変更`；插件不能在 document complete 后立刻找按钮。店铺确认事项点击点现在会最多等待 15 秒，直到实时 DOM 出现 `#cartopt` 或标题 header/container 附近的 `変更` 后再点击；若状态里已有店铺确认事项，不再先要求识别到右侧 `確認する` |
| 2026-06-10 | 店铺确认事项 review 页 `変更` 按钮仍不稳定 | 不再依赖 review 页点击 `変更`；发现店铺确认事项后，插件直接按商品 ID 导航到 `https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId={productId}`。到变更页后等待 `#confirm a[data-cl-params*="_cl_link:update"]`，勾选所有 checkbox，再点击红色 `変更する` 返回付款确认页 |
| 2026-06-10 | 店铺确认事项变更页已打开但 checkbox 没有被勾选 | 变更页 checkbox/`変更する` 也是 Yahoo 前端后渲染；插件现在会等待最多 15 秒直到至少出现 1 个 `input[type="checkbox"]` 和提交按钮。不再要求 checkbox input 本身可见，隐藏 input 也会处理：点击 label/容器和 input，使用原生 checked setter 设置为 true，并派发 `input/change` 事件，覆盖 React 受控组件场景 |
| 2026-06-10 | 店铺确认事项 checkbox 已勾选但没有提交 `変更する` | 变更页提交改为 DOM 提交优先：勾选后直接对 `#confirm a[data-cl-params*="_cl_link:update"]` 执行 focus、mouse、click 和 Enter 键事件，并以返回 review/下一步页面作为成功条件；如果未返回，再用 Chrome debugger 真实鼠标点击按钮中心点兜底 |
| 2026-06-10 | 店铺确认事项页面一出现就勾选，Yahoo 前端状态未初始化导致提交仍认为未选择 | 变更页处理拆成只读等待、勾选、延迟、提交 4 步：先等 `document.readyState=complete`、checkbox/`変更する`/页面文本稳定且无骨架加载约 1.8 秒，再触发 checkbox；若 checkbox 已视觉选中，会先重置再最终选中，避免 DOM checked 与 React 内部状态不一致。勾选后等待 1.2 秒再单独点击 `変更する` |
| 2026-06-10 | 店铺确认事项 checkbox 视觉勾选但按钮仍不可提交，手工取消再勾选可提交 | checkbox 勾选改为 Chrome debugger 真实鼠标点击：读取每个 `input[type="checkbox"]`/label 的屏幕坐标后发送 `mouseMoved/mousePressed/mouseReleased`。若 checkbox 已显示选中，会先真实点击取消再真实点击选中，强制 Yahoo 前端收到与人工操作一致的交互事件；JS 设置 checked 仅保留为 debugger 不可用时兜底 |
| 2026-06-10 | 后台订单管理需要跨页自动选中和 CSV 导出 | 订单管理表格复选框不再限制状态，结算/支付状态检查延后到按钮点击时处理；首次勾选订单时按该订单用户跨页选中 `won_at` 从昨天到今天的所有订单，并缓存跨页订单数据。新增导出 CSV，字段为落札日期、用户名、商品链接、商品标题、落札价、运费、总价；导出只看原始 `shipping_fee_text`，遇到 `落札者負担/着払い` 弹窗输入本次导出运费，不写数据库且不使用同捆运费 |
| 2026-06-10 | 用户端管理员/代理切换用户下拉不支持搜索 | `src/client/src/components/UserNav.jsx` 将原 `Picker` 切换为 `Popup + SearchBar + List`，点击“当前账号”后弹出可搜索用户列表，按用户名和用户等级过滤；选中后继续复用原 `acting-user-change`、localStorage 和页面刷新逻辑 |
| 2026-06-11 | 后台订单管理同捆商品缺少组背景色 | 订单管理表格按 `bundle_group_id` 给同捆商品行标浅色背景；同一组保持同色，当前页相邻同捆组在两种浅色间交替，便于和 Google 表格一样区分同捆组 |
| 2026-06-11 | 系统配置中初始化订单状态入口风险较高，Google 表格页签名不可配置 | 后台“系统配置 / 交易开始任务”彻底取消“初始化订单状态”功能：前端按钮和后端 `/api/admin/transaction-start/reset-orders` 接口均移除。Google 表格配置新增“Google工作表名称”，保存到 `config.google_sheets_sheet_name`，后端追加/查找 Google 表格时优先使用该配置，未配置时继续兼容 `GOOGLE_SHEETS_SHEET_NAME` 和默认 `-代拍表-` |
| 2026-06-11 | 后续开发计划重新确认 | 生产环境暂未发现 `/my/won` 落札同步、默认信用卡付款、交易 tab 关闭问题；出价/查询 worker 隔离和批处理危险操作收口先保留以后讨论。PIN/验证码仍待继续处理：当前进入验证码页面后没有把验证码图片返回后台，并且还会再次打开 PIN 页面。待收货补表格页面说明不再写死 `-代拍表-`，改为读取当前 Google 工作表名称配置 |
| 2026-06-11 | 增加自动化回归入口 | 根目录新增 `npm run regression` / `npm run test:regression`，串行执行 Google Sheets 配置测试、后台订单测试、插件路由测试、Yahoo 插件 content/background/encoding 测试，以及后台和用户端生产构建，用于发布前确认现有流程没有被改坏 |
| 2026-06-11 | 导入订单点击“读取落札商品”报 `invalid config key` | 根因是早期实现会在 `createManualOrderImportBatch()` 创建批次后写 `scan_idle_counter=999` 以便插件优先执行导入扫描，但 `saveConfigValue()` 白名单只允许付款相关 key。已放行导入流程需要的配置 key；后续导入改为独立 idle 调度优先级后，不再写 `scan_idle_counter=999`，避免订单管理显示扫描计数异常 |
| 2026-06-11 | 导入订单等待插件读取但扫描 Flag 增加后仍未执行 | 导入读取从“普通 scan action 内优先执行”提升为后端 idle 调度优先级：只要存在 `manual_order_import_batches.status='requested'` 的批次，`/api/plugin/idle-action/next` 就直接返回 `scan` action，且优先于交易开始、扫描时间窗口和扫描计数；现有插件收到 scan 后仍按原逻辑先执行导入，导入无任务才执行普通扫描。创建导入批次不再修改普通扫描计数 |
| 2026-06-11 | 后台订单管理缺少导入任务状态可视化 | `/api/admin/idle-flags` 新增返回手动导入批次计数：待读取 `requested`、读取中 `scanning`、待确认 `ready`；订单管理顶部状态条在“扫描计数”后显示“导入flag：待读取 x，读取中 y，待确认 z”，便于判断导入是否已被插件领取 |
| 2026-06-11 | 导入订单读取失败 `normalizeVisibleText is not defined` | 根因是 `content.js` 的 `findWonHistoryNextPageUrl()` 使用 `normalizeVisibleText()` 判断 `/my/won` 下一页链接，但该 helper 只定义在 `extractOrderHistory()` 局部作用域内；导入扫描调用 `extractOrderHistory()` 后继续调用翻页函数时抛 ReferenceError。已将 `normalizeVisibleText()` 提升为 content 顶层共享函数，并新增测试覆盖落札历史下一页链接提取 |

---

## 2026-06-10 PIN 窗口处理修复

### 已实现内容

- `isLikelyManualPinTab()` 现在识别 `login.yahoo.co.jp/config/login?auth_lv=1&done=...`，避免图 3 这类 PIN 页被全局扫描漏掉。
- `syncIdleYahooPages()` 在执行任何空闲非出价工作前先检查已打开的 PIN tab；发现 PIN tab 时暂停本轮 idle 工作，并关闭重复 PIN tab，只保留一个窗口供后台输入 PIN。
- `handleManualVerificationIfPresent()` 拿到后台 PIN 后，先刷新当前 PIN 页并等待约 2 秒，再调用 debugger 输入逻辑，避免图 1 的“请求已超时”页面无法接收 PIN。
- PIN 输入路径默认模拟真实键盘，每个数字发送 `rawKeyDown -> char -> keyUp`；若真实键盘发送失败或短时间内仍停留在 PIN 页，再用 `Input.insertText` 作为备用，不依赖后台再次提交。
- 验证码/PIN 提交后的跳转会扫描同一轮新开的 Yahoo 验证 tab；如果验证码后出现新的 PIN tab，插件会切过去并复用本轮已有 PIN，避免后台反复弹新的 PIN 输入要求。
- 空闲非出价任务入口现在使用 `manualVerificationFlowActive` 流程锁；只要当前仍有 PIN 或验证码 tab，就不再执行新的 idle action，直到整轮手动验证流程结束。
- Chrome 密码管理工具 PIN 浮层属于浏览器级安全 UI，Chrome debugger 键盘事件可能无法穿透；插件现在优先调用 API Server 的系统级 Win32 输入。生产要求 API Server 与服务器 Chrome 运行在同一 Windows 交互桌面会话中，否则系统级鼠标/键盘事件无法投递到 Chrome。
- 系统级 PIN 输入前会强制前置目标 Chrome 窗口和 PIN tab：`windows.update({ focused: true, state: 'normal' })` + `tabs.update({ active: true, highlighted: true })`，并把当前 tab 标题传给服务端优先匹配窗口。
- 服务端 `manual-pin/type` 脚本会激活目标 Chrome 窗口，点击 PIN 输入区域，使用 Win32 `keybd_event` 逐位输入 PIN 数字；不发送 Enter，避免空输入直接提交导致 passkey 登录失败。
- `findManualVerificationTransitionTab()` 现在区分“新开的 PIN”和“旧 active PIN”：验证码通过后新开 PIN 仍会优先处理；但当前 tab 已经进入验证码时，不会被旧 PIN tab 抢回。
- 交易/扫描/付款 finally 清理 tab 时，手动验证页不再按普通 Yahoo 登录 tab 关闭；关闭前会通过 `chrome.tabs.get(id)` 再确认当前 URL，若是 `login.yahoo.co.jp/ncaptcha` 或 PIN 页则保留，避免验证码页被关掉后重新触发 PIN。
- 空闲入口发现验证码 tab 时会优先进入验证码处理，发后台 `type=captcha` 图片挑战并等待人工输入；只有没有验证码 tab 时才保留单个 PIN tab 并暂停其他非出价任务。
- PIN/验证码检查顺序高于 `lastIdleSyncAt` 空闲同步节流；即使刚执行过一次 idle，同一轮出现验证码也会立即提交后台图片。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\encoding.test.js
PowerShell 只解析不执行 `buildWindowsSendKeysScript()` 生成脚本
```

## 2026-06-08 落札误同步修复

### 已实现内容

- 插件出价执行报错后不再调用 `confirmWonBeforeFail()` 立即打开 `/my/won` 兜底确认；失败直接写入 `failed`，便于从失败原因排查真实出价问题。
- `/my/won` 落札同步抽取时，只接受同一商品容器内存在 `取引連絡` 链接的记录；页面底部推荐商品、关联商品、最近落札推荐等没有 `取引連絡` 的商品链接会被跳过。
- 后台“数据批处理”新增 `删除商品数据` Tab，接口为 `POST /api/admin/product-data-delete/run`。
- 删除范围：输入商品 ID 对应的 `tasks`、`orders`、`bid_logs`、`order_status_change_logs`、`bidding_items`；用于清理误同步造成的假成功任务/订单。

### 最近验证命令

```powershell
node yahoo-plugin\encoding.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

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
- **后台导入订单**: `D:/www/g-daipai/src/admin/src/ManualOrderImport.tsx`
- **后台运费更新 Tab**: `D:/www/g-daipai/src/admin/src/ShippingRefresh.tsx`
- **后台商品类型更新 Tab**: `D:/www/g-daipai/src/admin/src/ProductTypeRefresh.tsx`
- **后台落札商品更新 Tab**: `D:/www/g-daipai/src/admin/src/OrdersResync.tsx`
- **后台删除商品数据 Tab**: `D:/www/g-daipai/src/admin/src/ProductDataDelete.tsx`
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
- 后台曾新增“初始化订单状态”按钮；2026-06-11 已彻底取消该功能，前端按钮和后端 `/api/admin/transaction-start/reset-orders` 接口均已移除。
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

## 2026-06-05 用户端商品拍卖次数抓取

### 已实现内容

- 用户端提交任务页获取 Yahoo 商品信息时，服务端现在会解析商品拍卖次数 / 入札件数：
  - 优先读取 `pageData.items.bids`、`bidCount`、`bid_count` 等结构化字段。
  - 其次识别 Yahoo 页面链接文本里的 `0<!-- -->件</a>` / `12件</a>` 这类入札履历数量。
- `/api/proxy/fetch` 返回 `bidCount`。
- 提交任务页商品卡片在“当前合计金额”下一行显示小锤子图标 + `拍卖次数：X件`，0 次也会正常显示。
- `/api/task/submit` 保存 `bid_count` 到 `tasks.bid_count`；历史数据库启动时会自动补齐该列。
- 用户端提交最高价校验已按拍卖次数更新：
  - `bid_count=0`：最高价的税前价只需 `>= 当前税前价`，支持无人出价商品按起拍价提交。
  - `bid_count>0`：最高价的税前价必须 `>= 当前税前价 + Yahoo 最低加价`。
  - Yahoo 最低加价阶梯：`<5000=100`、`5000-9999=250`、`10000-49999=500`、`>=50000=1000`。
  - 示例：当前税前 `5500円` 且已有出价时，最低加价 `250円`，最低提交最高价为 `5750円`。
- 服务端 `/api/task/submit` 也增加同样兜底校验，防止绕过前端直接提交低于 Yahoo 最低加价的价格。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
node src\server\routes\task.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-09 取引連絡 PIN 与文字验证码处理

### 已实现内容

- 点击 `取引連絡` 后如果跳到 `login.yahoo.co.jp/config/login?auth_lv=1...`，插件会识别为 Yahoo/Chrome PIN 验证页，即使页面 DOM 里没有可操作输入框也会提醒后台输入 PIN。
- PIN 输入不再只依赖网页 input；优先通过 Chrome debugger 向当前 tab 发送真实数字键事件，适配 Google 密码管理器 PIN 浮层“直接键盘输入数字”的场景。
- PIN 输入后短轮询页面跳转；如果没进入验证码页或交易页，会再次提醒后台输入 PIN，并显示“上次 PIN 码可能错误，请重新输入 PIN 码”。
- 文字验证码页保持人工处理：后台显示截图，人工输入图中日文后，插件填入蓝色 `続ける` 按钮上方输入框并点击 `続ける`。
- 验证码通过后如果再次回到 PIN 页，插件自动复用上次成功输入的 PIN，再次键盘输入，完成后继续原 `取引連絡` 流程。
- 后台人工验证提示现在会显示插件传来的 `message`，用于展示 PIN 错误重试提示。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-08 用户端网站汇率与人民币辅助出价

### 已实现内容

- 新增用户端接口 `GET /api/task/website-rate`，从中国银行外汇牌价页面抓取 `日元` 的 `现汇卖出价`，按 `现汇卖出价 / 100 + 0.002` 计算网站汇率，并四舍五入保留 4 位小数。
- 网站汇率只保存在服务端内存缓存中，缓存 3 小时，不写入数据库，不复用后台订单结算汇率，也不影响订单应付款公式。
- 用户端提交页加载时会先读本地 `localStorage` 的网站汇率缓存；本地缓存缺失或过期时，静默请求 API。日元模式始终可用，汇率失败只影响人民币辅助输入。
- 提交页 `最高出价` 增加 `日元 / 人民币` 切换，默认日元；人民币模式下按 `Math.floor(人民币 / 网站汇率)` 转为日元后再走原有提交逻辑。
- 人民币只用于页面换算和展示，提交给 `/api/task/submit` 的仍是日元 `max_price`，后续任务、插件出价、落札同步、订单结算都不感知人民币。
- 个人商品也新增 `实际出价` 展示；人民币模式示例：`实际出价：100人民币 ≈2,247日元`。商城税前价会显示含税后的人民币和日元，例如 `实际出价：110人民币 ≈2,472日元`。
- 2026-06-09 追加调整：用户端不再展示 `网站汇率` 数值、加载文案或相关字样；汇率继续静默获取并仅作为人民币辅助出价换算和按钮可用性判断使用。
- 新增设计文档：`docs/superpowers/specs/2026-06-08-website-bid-rate-design.md`。
- 新增实施计划：`docs/superpowers/plans/2026-06-08-website-bid-rate.md`。

### 最近验证命令

```powershell
node src\server\routes\task.test.js
node src\client\src\utils\bidPrice.test.mjs
node src\client\src\pages\Submit.display.test.mjs
Set-Location src\client
npm run build
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

---

## 2026-06-05 付款页確認する按钮延迟加载修复

### 问题现象

- 付款任务进入 `購入手続き` 页面后，右侧订单金额下方红色 `確認する` 按钮有时因为 Yahoo 网络或页面脚本加载慢，短时间内还没有渲染出来。
- 旧逻辑在当前页面快照里没有 `hasReviewButton` 时会直接报错，导致付款任务卡在该页面并失败。

### 已修复内容

- `yahoo-plugin/background.js` 新增当前付款页状态等待逻辑：同一 tab 最多等待 15 秒，每 0.5 秒重新读取一次付款页状态。
- 当付款页已打开但 `確認する` 尚未出现时，插件会等待按钮加载完成后再点击，不再立即报 `payment entry button not found` / `payment review button not found`。
- 保持后续流程不变：点击 `確認する` 后进入最终确认页，再按后台配置随机等待 `1-X` 秒后点击 `購入を確定する`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-08 商城同捆已付款补录

### 已实现内容

- 后台订单管理新增隐藏入口：双击 `订单状态` 单元格，可打开 `商城同捆已付款补录` 弹窗；页面不新增显眼按钮。
- 2026-06-08 追加修复：订单状态内容本身也绑定双击事件，并且非商城商品双击会提示“商城商品才支持同捆补录”，避免表格单元格事件没有触发时表现为无响应。
- 弹窗字段：
  - 主商品ID：默认使用当前双击订单商品 ID。
  - 子商品ID：支持全角逗号 `，` 和半角逗号 `,` 分隔。
  - 同捆运费：整数日元。
- 新增接口 `POST /api/admin/orders/store-bundle-backfill`。
- 补录结果：
  - 主商品 `order_status = pending_shipment`（待发货），`bundle_shipping_fee_text = 输入运费`。
  - 子商品 `order_status = bundle_completed`（同捆完了），`bundle_shipping_fee_text = 0円`。
  - 全组写入同一个新的 `bundle_group_id`。
- 校验规则：
  - 主商品和子商品都必须存在落札订单，且必须是商城商品。
  - 主商品不能同时作为子商品。
  - 不限制同一用户；不同用户同捆允许。
  - 拒绝 `completed`、`cancelled`、`pending_receipt` 状态订单。
- 状态日志 source 使用 `admin_store_bundle_backfill`，后台状态来源显示为 `商城同捆补录`。
- 新增设计文档：`docs/superpowers/specs/2026-06-08-store-bundle-backfill-design.md`。

### 最近验证命令

```powershell
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-06 同捆扫描输入按钮未点击修复

### 问题现象

- 商品 `s1113817953` 是同捆主商品，本地数据库仍为 `pending_bundle`，同组商品也仍为 `pending_bundle`。
- `/api/plugin/scan/jobs` 能取到该商品，并且该商品排在扫描队列第一位，说明问题不是服务端没有下发扫描任务。
- 订单没有 `order_status_change_logs`，说明插件没有成功回写 `bundle_shipping_fee_text` 或同捆状态变化。

### 根因判断

- 用户提供的真实 HTML 显示按钮为 `<a class="libBtnBlueL" ...>取引情報を入力する</a>`。
- 该页面同时可能包含 `出品者がまとめて取引に同意しました` 和 `出品者から配送方法の連絡が届いています` 文案，旧识别会优先返回 `main_agreed`。
- `main_agreed` 分支会先尝试点击 `閉じる`；但该 HTML 是页面内普通按钮，不是弹窗，没有 `閉じる`，所以流程直接退出，没有继续点击 `取引情報を入力する`。
- 该失败只写入 Chrome 扩展 console，不会写入数据库，因此后台看不到错误字段。

### 已修复内容

- `yahoo-plugin/content.js`：如果页面已经存在可点击的 `取引情報を入力する`，优先返回 `input_required`，不再先走 `main_agreed -> 閉じる`。
- `yahoo-plugin/content.js` / `background.js`：放宽 `取引情報を入力する` 按钮识别，允许中间有空白，并兼容 `role=button`、`onclick`、`tabindex`、`data-cl-params` 等 Yahoo 可点击容器。
- `yahoo-plugin/content.js` / `background.js`：保留同捆后续 `決定する / 確認する` 兼容。
- 新增回归测试：基于 `s1113817953` 页面 HTML，存在 `<a class="libBtnBlueL">取引情報を入力する</a>` 时必须识别为 `input_required` 并点击该链接。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 交易信息输入后置き配 OK 弹窗处理

### 业务规则确认

- 点击 `取引情報を入力する` 后，Yahoo 可能弹出 `置き配場所（玄関前）が初期設定されました` 窗口。
- 该窗口不只出现在同捆商品，普通商品等其他交易信息输入流程也可能出现。
- 如果弹出该窗口，需要先点击 `OK`，再继续后面的 `決定する / 確認する / 確定する` 或付款流程。
- 如果不弹出，保持原流程不变。

### 已修复内容

- `yahoo-plugin/content.js`：新增 `detectPlacementDefaultModal()`，识别 `置き配場所...初期設定されました` + `OK` 按钮。
- `yahoo-plugin/content.js`：同捆/交易动作新增 `placementOk`，可点击弹窗中的 `OK`。
- `yahoo-plugin/background.js`：同捆扫描点击 `取引情報を入力する` 后，如果先出现 `canPlacementOk`，会先点 `OK`，再继续后续操作。
- `yahoo-plugin/background.js`：普通交易开始的 `completeBidderPaysShippingTransaction()` 也会先处理 `OK` 弹窗。
- `yahoo-plugin/background.js`：付款流程 `completePaymentTransactionInfoInput()` 点击 `取引情報を入力する` 后，也会处理 `OK` 弹窗，覆盖非同捆商品。
- 新增回归测试覆盖 content 侧弹窗识别/点击，以及付款流程 `transactionInfoInput -> placementOk -> transactionDecide`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 用户端商城税后出价最低加价修正

### 问题现象

- 商城商品选择 `税后价` 出价时，最低可出价提示里的当前价已经按税后价显示，但最低加价仍使用 Yahoo 税前加价。
- 示例：税前当前价 `4,500円`、税后当前价 `4,950円` 时，旧提示为 `当前税后价4,950円+最低加价100円=最低5,050円`。

### 业务规则确认

- 商城商品选择 `税前价`：最低加价保持 Yahoo 税前阶梯，例如 `4,500円 + 100円 = 4,600円`。
- 商城商品选择 `税后价`：最低加价也要按税后口径显示，即税前最低加价 `* 1.1`，例如 `4,950円 + 110円 = 5,060円`。

### 已修复内容

- `src/client/src/utils/bidPrice.js`：`getMinimumBidInputRequirement()` 在商城 `tax_after` 模式下，将展示用最低加价转换为税后口径。
- `src/client/src/utils/bidPrice.test.mjs`：新增 `currentPrice=4500`、`tax_after` 时 `increment=110`、`requiredPrice=5060` 的回归测试，并更新 `5000` 税前当前价对应的税后加价预期为 `275`。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-06 商城商品同捆付款单品处理

### 业务规则确认

- 付款流程中，商城商品即使页面提示可同捆购买，也不走本系统普通商品同捆逻辑。
- 商城商品同捆付款按一般商城商品单品付款处理，不写同捆运费、不改同捆订单状态。
- 图1普通商城付款页：点击红色 `購入手続きする`，进入后续普通商品支付步骤 A。
- 图2商城同捆提示页：如果有弹出框，先点击 `閉じる`；然后不要点红色 `まとめて購入手続きする`，必须点击下面的 `単品で購入手続きする`，再进入后续普通商品支付步骤 A。

### 已修复内容

- `yahoo-plugin/background.js`：付款页状态新增 `hasStoreBundlePurchaseNotice`、`hasPaymentCloseButton`、`hasSinglePurchaseProcedureButton`。
- `yahoo-plugin/background.js`：进入付款流程后，如果检测到商城同捆购买提示弹窗，先点击 `閉じる`。
- `yahoo-plugin/background.js`：付款入口按钮优先级改为 `単品で購入手続きする` > `Yahoo!かんたん決済で支払う` > `購入手続きする`，避免误点红色 `まとめて購入手続きする`。
- 新增回归测试覆盖商城同捆付款页动作顺序：`paymentClose -> singlePurchaseProcedure -> review -> finalize`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 待发货扫描发货后追加 Google 代拍表

### 业务规则确认

- 扫描流程中，`待发货(pending_shipment)` 商品发现已发货后，订单状态更新为 `待收货(pending_receipt)`，同时追加 Google 表格。
- 表格地址：`https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0`。
- 操作页签：`-代拍表-`。
- 追加字段顺序：
  - `落札日期`
  - `用户名`
  - `商品链接`
  - `商品标题`
  - `落札价`
  - `运费`
  - `同捆运费`
  - `总价`
  - `应付款`
  - `订单状态`
- 普通商品总价：`落札价 + 运费`。
- 同捆商品总价：`落札价 + 同捆运费`。
- 有同捆运费的商品组，需要把同组商品连续插入，并给整组商品行设置背景色；不同同捆组按组 ID 使用不同浅色，便于区分。

### 实现说明

- `src/server/models/index.js` 新增兼容列 `orders.google_sheet_appended_at`，用于防止扫描重试重复追加。
- `src/server/services/googleSheets.js` 新增 Google Sheets API 客户端：
  - 默认 spreadsheet id：`1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4`
  - 默认 sheet name：`-代拍表-`
  - 支持环境变量：
    - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`
    - 或 `GOOGLE_APPLICATION_CREDENTIALS`
    - 或 `GOOGLE_SHEETS_CLIENT_EMAIL` + `GOOGLE_SHEETS_PRIVATE_KEY`
    - 可选覆盖：`GOOGLE_SHEETS_SPREADSHEET_ID`、`GOOGLE_SHEETS_SHEET_NAME`
- 注意：服务端 API 写表不能直接复用插件 Chrome 已登录的 Google cookie。需要把目标表格共享给服务账号邮箱；如果未配置 Google 凭据，扫描状态更新不受影响，但会跳过表格追加。
- `src/server/routes/plugin.js` 在 `scan_pending_shipment_shipped` 成功后调用表格追加：
  - 普通订单只追加当前订单。
  - 如果当前订单属于有 `bundle_shipping_fee_text` 的同捆组，则一次性取整组未追加订单，连续追加并标色。
  - 表格追加成功后写入 `google_sheet_appended_at`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
```

---

## 2026-06-06 普通商品付款多运费选择修复

### 问题现象

- 商品 `u1231877298` 抓取商品信息时取到最低运费 `185円`。
- Yahoo 普通商品付款输入页存在多个配送方法时，页面默认选中的配送方法可能不是系统抓取的最低运费，例如默认 `230円`。
- 旧付款流程直接点击右侧 `確認する`，没有先确认配送方法是否与订单运费一致，导致付款金额可能按 Yahoo 默认运费继续。

### 已修复内容

- `yahoo-plugin/background.js` 的付款页状态读取新增 `shippingOptions` 和 `selectedShippingAmountJpy`，只从 `配送方法` 区域识别配送 radio，避免误选上方 `コンビニ / PayPay / 銀行振込` 等付款方式。
- 普通商品付款流程在点击 `確認する` 前新增 `ensurePaymentShippingOption()`：
  - 如果当前选中配送金额与订单 `effectiveShippingFeeText / shippingFeeText` 一致，继续原流程。
  - 如果不一致，并且页面存在相同金额的配送选项，则自动选中对应 radio，例如从默认 `230円` 切换到 `クリックポスト 185円`。
  - 切换后重新读取页面状态，再执行原有付款金额校验和后续 `確認する -> 購入を確定する` 流程。
- 新增回归测试覆盖付款页配送选项识别，以及“默认运费 230円、订单运费 185円”时需要触发切换的判断。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 用户端最低出价提示修复

### 已实现内容

- Yahoo 最低加价阶梯补充 `<1000円` 区间：当前税前价小于 `1000円` 时最低加价为 `10円`；`1000-4999円` 仍为 `100円`，其他区间不变。
- 用户端提交页最低可出价提示按商品和价格类型显示：
  - 普通商品：继续显示 `当前价 X円 + 最低加价 Y円`。
  - 商城商品 + 税前价：显示 `当前税前价 X円 + 最低加价 Y円`。
  - 商城商品 + 税后价：显示 `当前税后价 X円 + 最低加价 Y円`，最低金额按页面显示税后价计算。
- 最低可出价 Toast 文案改为等式表达，例如 `当前税后价5,500円+最低加价250円=最低5,750円`。
- 同步更新服务端任务提交兜底校验和插件多次出价阶梯，避免客户端、服务端、插件规则不一致。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
node src\server\routes\task.test.js
node yahoo-plugin\content.test.js
Set-Location src\client
npm run build
```

---

## 2026-06-06 扫描待发货状态当前进度

### 已实现内容

- `scan` 任务新增第三类取单状态：`pending_shipment`（待发货），与原 `waiting_shipping`、`pending_bundle` 分开处理。
- `orders` 新增兼容字段：`shipping_company`，用于保存物流公司；继续复用已有 `tracking_number`、`shipped_at`。
- 待发货扫描进入订单 `取引連絡` 后识别：
  - 商城未发货：`ご購入ありがとうございます。商品の発送連絡をお待ちください。`，保持待发货并执行超期提醒判断。
  - 商城已发货：`商品が発送されました。到着までお待ちください。`，抽取物流和单号，订单改为 `pending_receipt`（待收货）。
  - 商城取消：页面含 `キャンセルされました`，订单改为 `cancelled`（取消）。
  - 普通未发货：`出品者に支払い完了の連絡をしました。商品の発送連絡をお待ちください。`，保持待发货并执行超期提醒判断。
  - 普通已发货：`出品者から商品発送の連絡がありました。到着したら、受け取り連絡をしてください。`，抽取物流和单号，订单改为 `pending_receipt`（待收货）。
- 单号判断：
  - 优先从页面/取引消息中抽取 12 位数字，支持中间用 `-` 或空格分隔。
  - 抽不到单号时，用 `出品者` 名称兜底；如 `出品者： asua（9986）` 保存为 `asua`。
- 待发货超期提醒：
  - 按进入 `pending_shipment` 的状态日志时间计算，超过 7 天开始提醒。
  - 每个订单每天生成一条独立提醒，提醒 ID 为 `订单ID + 超期天数`；关闭后当天同一条不再重复。
  - 未关闭的旧提醒会保留，第二天继续新增下一条提醒；发货或取消后自动关闭该订单未关闭提醒。
  - 后台顶部新增待发货提醒栏，每条提醒可单独关闭，商品 ID 可点击跳 Yahoo。
- 用户端落札商品：
  - `cancelled` 显示红色 `取消` 标签，整行淡粉色背景。
  - `pending_receipt` 显示 `待收货`，`pending_shipment` 显示 `待发货`。
  - 有物流时显示物流和追踪号。
- 后台订单管理新增 `待收货`、`取消` 状态标签，并显示物流列。

### 待补充

- 发货后追加 Google 表格的具体表格地址、字段和认证方式尚未提供，当前仅完成订单状态与物流信息入库。
- 普通商品取消页面文案后续补充后，需要把专用文案加入 `pending_shipment` 扫描识别；当前通用 `キャンセルされました` 已可覆盖常见取消页。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\client
npm run build
Set-Location ..\admin
npm run build
```

---

## 2026-06-06 即決误报失败后的落札同步修复

### 问题现象

- 本地商品 `u1231877298` 为即決任务，插件返回 `Yahoo入札失败：オークションにアクセスできませんでした`，用户端显示“失败：系统原因”。
- 实际 Yahoo 落札列表已经有该商品，但后台“订单管理”一直没有出现。

### 根因

- `/api/plugin/orders/sync` 只匹配 `tasks.status IN ('bidding', 'success')`，失败任务即使出现在 Yahoo 落札页也会被跳过。
- 同步逻辑遇到第一条已存在订单会直接 `break`，如果某个误报失败但实际落札的商品排在已同步订单后面，也不会继续扫描到。

### 已修复内容

- 落札同步现在信任 Yahoo 落札页：匹配任务状态扩展为 `bidding/success/failed`，如果 Yahoo 已落札，会把失败任务纠正为 `success` 并创建/更新订单。
- 已存在订单只 `continue` 跳过，不再中断当前落札页遍历，避免漏掉后面的误报失败落札商品。
- 抽出 `syncYahooWonOrders()` 并增加回归测试，覆盖“已存在订单在前，failed 实际落札商品在后”的场景。
- 插件失败回写前新增二次确认：出价流程捕获失败后，会先打开 Yahoo 落札页执行一次 `/orders/sync`；如果同步结果显示有新增落札订单，则不再把任务标记为 `failed`。
- 本地数据库已用同一同步逻辑修复 `u1231877298`：任务改为 `success`，新增订单 `orders.id=15`，落札价 `350円`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 同捆扫描主商品未点击修复

### 问题现象

- 商品 `s1113817953` 是同捆主商品，数据库状态为 `pending_bundle`，同组 `bundle_group_id=bundle-20260602-s1113817953`。
- `getScanJobs()` 能取到该订单，且它在同组中排第一；`scan_idle_counter` 已被清零，说明扫描任务近期执行过。
- 订单状态日志为空，表示插件打开页面后没有回写扫描结果，也没有完成主商品操作。

### 根因

- 原同捆扫描只在 `extractBundleScanResult()` 返回 `unknown` 时才会检查并点击 `取引情報を入力する`。
- 真实页面如果先匹配成 `waiting_agreement` 或 `shipping_pending`，即使页面上已经出现主商品可点击操作按钮，旧逻辑也会直接返回，不点击、不回写。

### 已修复内容

- 同捆扫描点击条件放宽：当扫描结果为 `unknown`、`waiting_agreement` 或 `shipping_pending` 时，只要页面状态检测到 `canInputTransaction=true`，就继续点击 `取引情報を入力する` -> `決定する` -> `確定する`。
- 补充识别文案：`出品者がまとめて取引に同意しました。配送方法を確認し取引情報を入力してください。` 代表需要我方继续操作，不是等待运费；扫描结果标记为 `input_required` 并进入 `取引情報を入力する` 后续流程。
- 新增 `shouldAttemptBundleInputAction()` 并加回归测试，覆盖 `waiting_agreement + canInputTransaction` 可继续主商品操作，`child_agreed` 仍不会误点。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
```

---

## 2026-06-05 入札确认误点推荐商品修复

### 问题现象

- 服务器 Chrome 插件在 Yahoo 入札弹窗里已填入金额后，停在红色 `確認する` 弹窗，没有进入下一步确认页。
- 同时页面下方 `この商品も注目されています` 推荐区的多个商品被打开，表现为 1 秒内出现多个非任务商品 tab。
- 同一用户、同一商品、同一价格和策略可能出现不同失败：`低于当前价`、`yahoo登录失败`、`系统原因`。根因是插件执行时页面状态不同，而不是用户端缓存。

### 根因结论

- 入札流程里的按钮查找范围是整页，遇到弹窗和页面推荐区同时存在同名/相似确认控件时，可能优先命中弹窗外的可点击元素。
- 入札流程内部的 `clickElement` 只发送普通 mouse/click 事件；如果 Yahoo 的 `確認する` 是 submit 按钮或依赖 pointer/表单提交事件，普通 click 可能不稳定。
- `/api/plugin/task` 先返回任务、插件再 PATCH `processing`，旧逻辑 PATCH 时未要求任务仍处于可执行状态；如果服务器 Chrome 有重复插件实例、多个 profile 或重复轮询，同一任务可能被并发执行，放大“短时间打开多个 tab”的问题。

### 已修复内容

- `yahoo-plugin/content.js`：出价按钮匹配现在优先在可见入札/落札 modal/dialog 内查找 `確認する` 等按钮，避免误点页面推荐区或弹窗外控件。
- `yahoo-plugin/content.js`：入札流程点击按钮时补发 `pointerdown/pointerup`，并在 submit 按钮上调用 `form.requestSubmit(button)`，提升 Yahoo 弹窗确认进入下一步的稳定性。
- `src/server/routes/plugin.js`：新增 `claimTaskForProcessing()`，`status=processing` 只允许仍为 `pending` 或 `bidding + multi_bid` 的任务原子改为 `processing`；并发执行器拿不到同一任务会收到 `success:false` 并跳过。
- 新增回归测试：
  - 入札弹窗和推荐区同时有 `確認する` 时，只点击弹窗内按钮。
  - submit 类型的 `確認する` 会触发表单 `requestSubmit()`。
  - 任务 claim SQL 必须限制在可执行状态，避免重复领取。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-06 交易开始自动 flag 规则修正

### 业务规则确认

- `交易开始执行整点` 到达后，如果当天还没有执行过交易开始，服务端需要把 `transaction_start_requested` 自动更新为 `1`。
- 这个 flag 不再只代表手动点击“加入执行队列”，也代表“定时已到，等待插件空闲执行”；后台仍只展示这一个 flag。
- 5 点前等整点前手工执行交易开始，不影响到整点后自动把 flag 置为 `1` 再执行一次。
- 如果手工执行是在配置整点之后完成，则视为当天交易开始已覆盖，会写入当天执行日期，避免同一天继续自动重复执行。
- 插件完成 `transaction_start` 后仍会把 `transaction_start_requested` 清回 `0`，并写入 `transaction_start_last_run_date=当天`，避免当天重复自动执行。

### 已修复内容

- `src/server/routes/plugin.js` 新增 `ensureScheduledTransactionStartRequest()`：
  - 读取 `transaction_start_hour`、`transaction_start_requested`、`transaction_start_last_run_date`。
  - 当前整点达到配置值且当天未执行时，写入 `transaction_start_requested=1`。
- 手工按钮会把内部来源标记为 `manual`；整点自动置 flag 会把内部来源标记为 `auto`。该来源只用于判断是否带 `includeAfterCutoff` 和是否写入自动执行日期，不新增后台展示字段。
- `/api/plugin/idle-action/next` 在读取空闲 action 前会先同步自动 flag。
- `/api/admin/idle-flags` 在返回后台顶部 flag 前也会先同步自动 flag，所以后台刷新后能看到数据库 flag 变为 `1`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-05 付款红色按钮点击增强

### 问题现象

- 付款任务进入 `購入手続き` 页面后，右侧红色 `確認する` 已经显示，但插件普通 JS click 后页面没有进入下一步，随后等待超时、关闭 tab 并标记付款失败。
- 推测原因是 Yahoo 前端按钮可能使用伪按钮 / React 事件 / 特定鼠标事件，单纯 `button.click()` 或 `form.requestSubmit()` 在真实页面上不稳定。

### 已修复内容

- 付款按钮识别范围扩展到 `[role="button"]`，避免 Yahoo 使用伪按钮时漏识别。
- Yahoo 付款页红色 `確認する` 实际 DOM 可能是 `<a data-cl-params="_cl_link:confirm;_cl_position:1;">確認する</a>`，插件现在优先选择 `data-cl-params` 含 `_cl_link:confirm` 且可见、有尺寸、未 disabled 的匹配元素，避免点到隐藏模板或不可点击的同名节点。
- 2026-06-09 追加：购买确认页的目标 `確認する` 只从真正可点击元素中匹配完整文本严格等于 `確認する` 的按钮/链接，优先 `<a>確認する</a>`。不要把 `span` 子元素作为付款 `review` 候选，也不要用包含关系或相似文案判断；PayPay 广告链接完整文本为 `特典を確認する`，必须排除。注意 `q1175609593` 这类商城即決商品走 `yahoo-plugin/content.js` 的即決购买流程，不是后台付款任务的 `background.js`。
- 2026-06-09 追加：`確認する` 精确匹配只适用于购买内容确认页；后续弹窗的 `購入を確定する` 必须作为最终提交按钮单独识别，点击一次后等待购买完成文案，不能再回到前一页 `確認する` 搜索逻辑。
- 2026-06-09 追加：最终弹窗按钮完整文字可能是 `上記に同意のうえ購入を確定する`；该按钮点过一次后，`content.js` 使用 `window.__G_DAIPAI_BUYOUT_FINAL_CLICKED__` 防止同页重复点击。后台 pending final 检查间隔为 10 秒，不再 3 秒后立刻再次触发。
- 2026-06-09 追加：商城即決最终弹窗使用专用 `findBuyoutFinalPurchaseButton()`，只匹配可点击元素中包含 `購入を確定する` 的提交按钮；不要把前一页 `<a>確認する</a>` 精确匹配逻辑复用到最终弹窗。普通即決的 `落札する` 仍作为 buyout 兜底保留。
- 2026-06-09 追加：商城即決购买完成后的真实 URL 为 `/order/thank-you?auctionId=...`，页面显示 `購入が完了しました！`。该 URL 必须视为成功结果；否则后台 pending final 超时会写失败且异常分支不一定关闭 tab。
- 2026-06-09 追加：商城即決无同捆勾选框时，`確認する -> 上記に同意のうえ購入を確定する -> /order/thank-you` 只作为插件出价成功页识别，不直接改订单状态。订单仍走商城正常链路：空状态→待支付→结算后待结算→支付；支付页已付款时按 `already_paid/success` 更新为 `pending_shipment`（待发货）。商城 `落札者負担` 在后台结算中按 0 运费处理。
- 2026-06-09 追加：`pending_shipment` 只能用于后台结算计算应付款，不能进入“支付”流程。支付按钮/支付任务仍只接受 `pending_settlement`；如果支付请求没有命中 `pending_settlement` 行，不设置 `payment_requested`。
- 普通付款点击会先补发 `pointerdown/mousedown/pointerup/mouseup/click` 事件。
- 如果点击 `確認する` 后 5 秒内没有进入下一付款状态，插件会使用 Chrome debugger 的 `Input.dispatchMouseEvent` 对按钮中心点再发送一次真实鼠标点击。
- 最终确认页 `購入を確定する` 也加入同样真实鼠标点击兜底。
- 失败诊断增强：如果真实鼠标点击后仍未进入下一页，错误信息会带上 `action`、普通点击结果、真实鼠标点击结果、当前 URL、页面按钮文本列表和候选按钮的 `tagName/text/disabled/role/href/rect`，用于判断是找不到按钮、按钮不可点，还是 Yahoo 页面点击后没有响应。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-06 数据批处理待收货补表格

### 已实现内容

- 后台“数据批处理”新增 Tab：`待收货补表格`。
- 新增后台接口：`POST /api/admin/receipt-sheet-backfill/run`，用于批量处理已经是 `pending_receipt`（待收货）但还没有写入 Google 表格的订单。
- 批处理复用扫描发货后的同一套 Google 表格追加逻辑：
  - 写入 `-代拍表-` 页。
  - 字段顺序为：落札日期、用户名、商品链接、商品标题、落札价、运费、同捆运费、总价、应付款、订单状态。
  - 表格 A1:J1 为空时自动写入表头。
  - 同捆商品会按同组连续追加，并使用组背景色；相邻同捆组颜色轮换。
- 重复判断规则：
  - 系统内通过 `orders.google_sheet_appended_at IS NULL` 过滤，追加成功后写入 `google_sheet_appended_at`，避免扫描重试或后台补写重复追加。
  - 当前不会读取 Google 表格已有内容做二次去重；如果表格里有人工手动添加的旧行，系统无法识别。当前表格为空时可直接使用。
- 后台补表页为了避免 Windows/服务器编码差异导致 TSX 乱码，中文显示文本使用 Unicode 转义保存，浏览器显示仍为中文。
- 2026-06-06 字段更新：Google 表格去掉 `应付款`、`订单状态`，改为 `物流`、`单号`；当前字段顺序为：落札日期、用户名、商品链接、商品标题、落札价、运费、同捆运费、总价、物流、单号。
- Google 表格样式会在追加时自动应用：表头自动覆盖为最新字段、首行冻结、表头深色底白字加粗、A:J 自动列宽。同捆组背景色逻辑保留。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-06 待发货扫描物流字段修正

### 问题

- 服务器商品 `c1232119416` 为商城商品，订单仍停留在 `pending_shipment`，`shipping_company` 和 `tracking_number` 为空。
- 服务器查询显示该订单已有 `transaction_url=https://buy.auctions.yahoo.co.jp/order/status?auctionId=c1232119416`，说明不是交易链接缺失，而是待发货扫描进入取引页后没有稳定识别已发货物流字段。

### 已修复内容

- `yahoo-plugin/content.js` 的待发货扫描现在优先从 DOM 表格/块元素按字段名抽取物流和单号：
  - 商城商品：`配送業者` -> 物流，`伝票番号` -> 单号。
  - 普通商品：`配送方法` -> 物流，`追跡番号` -> 单号。
- 普通商品物流字段会去掉运费部分，例如 `ゆうバック（送料:880円）` 保存为 `ゆうバック`。
- 保留旧兜底逻辑：如果字段里没有单号，继续从聊天文本里找 12 位数字；仍找不到时用出品者名称兜底。
- 新增回归测试覆盖商城/普通两类 DOM 表格字段。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```
---

## 2026-06-07 后台系统配置 Google 表格地址

### 已实现内容

- 后台“系统配置”页面新增 `Google表格地址` 只读配置项。
- 地址由服务端 `/api/admin/multi-bid-config` 返回，来源为当前 Google Sheets 追加逻辑实际使用的 `GOOGLE_SHEETS_SPREADSHEET_ID`，未配置环境变量时显示默认表格：
  `https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0`
- 该字段仅用于后台显示当前导入/追加的 Google 表格地址，不改变 Google Sheets 写入逻辑；如需切换表格，仍按当前服务端环境变量配置方式处理。

### 最近验证命令

```powershell
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始最近执行摘要修正

### 问题

- 后台订单管理顶部 `最近执行` 原来只显示 `回写 X 次`，其中成功状态回写和失败错误回写都会计数。
- 交易开始插件任务失败时，系统会写入 `transaction_start_error`，但 `orders.order_status` 保持空；这会让页面看起来像“没有执行过”，实际是执行后失败。

### 已实现内容

- 后台订单管理顶部 `最近执行` 改为显示：回写总数、成功数、失败数、未更新数。
- 如果最近执行日志里有失败原因，会在摘要中展示最多 2 条错误，方便直接判断是否是 Yahoo 页面、登录态或取引页点击失败。

### 最近验证命令

```powershell
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始空状态订单取单规则修正

### 问题

- 业务规则要求交易开始处理 `orders.order_status` 为空的落札订单。
- 旧取单 SQL 额外要求关联任务 `tasks.status='success'`，自动执行时还按执行整点做 cutoff，导致部分空状态订单不会进入交易开始。

### 已修复内容

- `/api/plugin/transaction-start/jobs` 改为以订单空状态为准取单：`orders.order_status IS NULL OR orders.order_status=''`。
- 不再用 `tasks.status='success'` 或执行整点 cutoff 排除空状态订单；手动和自动交易开始都会拿到全部空状态落札订单。
- 后台订单管理把 `交易开始错误` 列移动到 `订单状态` 后面，方便直接看到空状态订单是否是交易开始失败。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始 flag 置位时间修正

### 业务规则确认

- 后台设置的 `交易开始执行整点` 不是一个 0-59 分钟的小时区间。
- 自动交易开始 flag 应在“设置整点后 1 分钟”置为 `1`：
  - 设置 `0`：`00:01` 开始置 `transaction_start_requested=1`。
  - 设置 `5`：`05:01` 开始置 `transaction_start_requested=1`。
- 到达该时间前，即使小时已经相同，也不能提前置 flag。

### 已修复内容

- `src/server/routes/plugin.js` 新增分钟级判断：`isTransactionStartReady()`，自动置 flag 改为比较当天 `transaction_start_hour:01:00`。
- `/api/plugin/idle-action/next`、`ensureScheduledTransactionStartRequest()`、`completeIdleAction()` 统一使用“整点后 1 分钟”判断。
- `/api/admin/idle-flags` 后台顶部状态同步使用同一判断，避免后台显示和插件调度不一致。
- 后台系统配置字段文案改为 `交易开始执行整点后1分钟`，输入框后缀显示 `点01分`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始自动执行槽位规则修正

### 业务规则确认

- 自动交易开始不再按“每天只能执行一次”判断。
- 自动交易开始按当前后台配置小时生成执行槽位：`YYYY-MM-DD-HH`。
- 同一个槽位只执行一次；如果当天把配置从已执行过的小时改到后面的小时，后面的小时到 `HH:01` 后还会再置 flag。
- 如果当天把配置改到一个已经过点的小时，不补跑当天，等明天该小时 `HH:01` 再置 flag。
- 手动执行不占用自动执行槽位，不影响当天后续按配置自动执行。

### 示例

- 设置 `0`：`00:01` 自动置 `transaction_start_requested=1`，执行完成记录槽位 `当天-00`。
- 同一天后面改为 `9`：`09:01` 自动再次置 `transaction_start_requested=1`，执行完成记录槽位 `当天-09`。
- 同一天 9 点后再改为 `2`：当天不补跑；第二天 `02:01` 自动置 `transaction_start_requested=1`。

### 已修复内容

- `src/server/routes/plugin.js` 新增自动执行槽位判断，使用 `transaction_start_last_run_slot` 记录已完成的自动槽位。
- 自动置 flag 会参考 `transaction_start_hour` 的配置更新时间，避免把配置改到当天已经过点的小时后立即补跑。
- 保留旧日志兼容：没有 `transaction_start_last_run_slot` 时，会从当天最近一次自动执行日志推断旧槽位，避免部署后同一配置小时重复执行。
- `/api/admin/idle-flags` 使用相同槽位规则显示后台顶部 `交易开始flag`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 付款最终确认处理中页等待修正

### 问题

- 普通商品付款最终确认页点击 `購入を確定する` 后，Yahoo 会先显示 `ただいま決済処理中です。しばらくお待ちください。` 中间过程页。
- 旧逻辑只等待 5 秒，未看到完成页就进入失败/兜底流程并关闭 tab，导致实际 Yahoo 付款成功但系统反馈支付失败。

### 已修复内容

- `yahoo-plugin/background.js` 最终确认按钮点击成功后，固定等待完成页最多 15 秒。
- 15 秒内出现处理中页不判失败，继续等待 `購入が完了しました！` / 已付款完成状态。
- 15 秒后仍未看到完成页，才按付款失败处理并关闭 tab。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-07 确认收货功能实现

### 当前状态

- 确认收货任务已实现，复用现有插件空闲任务体系，新增独立 action：`confirm_receipt`。
- 前置数据状态已有：`pending_receipt`（待收货）、`completed`（完了）。
- Google 表格已新增“读取表格行颜色并按商品 ID 匹配”的能力。

### 业务规则确认

- 后台新增确认收货启动时间，默认每天 `18:01` 执行：
  - 配置项保存前面的整点小时，默认 `18`。
  - 到设置整点后 1 分钟时，自动置 `confirm_receipt_requested=1`。
  - 同交易开始一样支持手动执行。
  - 同一自动执行槽位只执行一次；如果改到当天已过点小时，不补跑当天，等第二天该小时 `HH:01`。
- 后台新增“收货商品颜色配置”，默认黄色 `#ffff00`。
- 确认收货 Flag 为 `1` 时，只处理 `orders.order_status='pending_receipt'` 的订单。
- 处理前必须去 Google 表格找该商品所在行：
  - 按商品 ID 匹配。
  - 该行 A-J 任意一个单元格背景色命中后台配置颜色，即允许执行确认收货。
  - 商品 ID 找不到、颜色不匹配或读取表格失败时跳过，不改订单状态。
- 普通商品：
  - 打开 Yahoo `取引連絡` 页面。
  - 勾选 `商品を受け取りました。`。
  - 等 `受け取り連絡` 按钮变红/可点击后点击。
  - 出现 `すべての取引が完了しました! またYahoo!オークションをご利用ください。` 后，订单状态更新为 `completed`（完了），关闭 tab。
- 同捆商品：
  - 待收货状态只会在主商品上。
  - 主商品按普通商品流程确认收货成功后，同一 `bundle_group_id` 的所有子商品一起更新为 `completed`。
- 商城商品：
  - 不打开 Yahoo 页面，直接把订单状态更新为 `completed`，关闭/不创建 tab。
- 用户端“落札商品”页面需要把 `completed` 显示为 `完了`。

### 已实现内容

- 后台“系统配置”新增确认收货执行整点配置，默认 `18`，到 `HH:01` 自动置 `confirm_receipt_requested=1`；规则与交易开始一致，按 `YYYY-MM-DD-HH` 槽位防重复，手动执行不占自动槽位。
- 后台“系统配置”新增“收货商品颜色配置”，默认 `#ffff00`，保存时标准化为 HEX；后台订单管理顶部新增 `确认收货flag` 展示。
- 后台“系统配置”已按流程拆分为多个功能块：多次出价、入札/落札空闲同步、交易开始任务、扫描任务、付款任务、确认收货任务、Google 表格配置，避免所有配置挤在同一个区块。
- 后台新增“手动执行确认收货”按钮：`POST /api/admin/confirm-receipt/request`。
- Google Sheets 新增按商品 ID 查找行并检查 A-J 任意单元格背景色是否命中配置色的能力；未命中颜色的待收货订单会跳过，不修改订单状态。
- 插件新增 idle action：`confirm_receipt`。空闲任务链路按 `C 交易开始 -> D 扫描(计数到阈值) -> E 付款 -> F 确认收货` 执行。只要没有执行 C/D，执行 E、F 或空闲 none 后都会让扫描计数 `+1`。
- 服务端新增 `/api/plugin/confirm-receipt/jobs` 和 `/api/plugin/confirm-receipt/status`：
  - 只取 `orders.order_status='pending_receipt'` 的订单；
  - 商城商品直接更新为 `completed`；
  - 普通商品由插件打开取引页执行确认收货；
  - 同捆主商品确认成功后，同一 `bundle_group_id` 下 `pending_receipt` / `bundle_completed` 订单一起更新为 `completed`。
- 插件普通商品流程：打开取引页，勾选 `商品を受け取りました。`，点击 `受け取り連絡`，等待出现 `すべての取引が完了しました` 后回写成功并关闭 tab。
- 用户端“落札商品”页新增 `completed -> 完了` 状态显示。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
Set-Location src\client
npm run build
```

---

## 2026-06-07 付款页配送方式选择修正

### 问题

- 普通商品 `u1231877298` 本地付款失败，提醒为 `payment amount mismatch: expected 535円, found 910円`。
- 该单系统金额为 `落札价 350円 + 运费 185円 = 535円`，是正确金额。
- Yahoo 付款页实际为 `350円 + コンビニ手数料 330円 + 默认配送 230円 = 910円`。
- 生产环境默认付款方式应为 `クレジットカード`，插件不能自动改为 `銀行振込`；本地无信用卡导致的便利店手续费不作为自动切换银行的依据。

### 已修复内容

- 强化配送方式选择：多个配送方式时，按系统抓取商品时保存的运费选择对应配送 radio，例如选择 `クリックポスト 185円`。
- Yahoo 付款页初始可能只显示当前默认配送和 `変更する` 按钮；`変更する` 不是页面唯一文案，且真实 DOM 为标题 `配送方法` 所在的 `section` 下，外层 `<div role="button">` 包住配送摘要，右侧普通 `span` 文本为 `変更する`。
- 插件现在会按配送上下文匹配展开按钮：优先找标题为 `配送方法` 的 `section`，只在该 section 内查找 `変更する` 文案，并实际点击最近的 `[role="button"]` 外层；兜底时才按 `配送方法` 标题之后、下一个业务区块之前，或父级/祖先文本含配送关键词（`おてがる配送`、`送料`、`クリックポスト` 等）匹配，不会按全页面第一个 `変更する` 点击。
- 如果普通 JS 点击展开后仍未看到目标运费，插件会对配送区域的 `変更する` 中心点补一次 Chrome debugger 真实鼠标点击，再读取配送选项并选择系统保存运费，避免隐藏的 `185円` 选项未被看到就继续按默认 `230円` 校验失败。
- 折叠状态下 Yahoo 可能已经把其他运费 radio 留在隐藏 DOM 中；插件现在只把可见的配送 radio/label/行容器算作可选项。隐藏的 `185円` 不会让流程跳过展开。
- 选择运费时优先点击可见的 label/行容器，再同步触发 radio 的 `input/change`，避免只改隐藏 input 导致 Yahoo 页面金额不刷新。
- 2026-06-07 追加：展开配送时会同时触发 `変更する` span、外层 `[role="button"]` 的鼠标事件，并对 role button 补发 `Enter` / `Space` 键盘事件；如果仍失败，付款失败原因会附带 `expand=...`、`trustedExpand=...`、`visibleState=...` 诊断信息，用于确认是否定位到 section、是否成功真实点击、可见运费列表是什么。
- 2026-06-07 追加修正：付款页状态摘要可能因为前 500 字还在 `お支払い方法` 区域而没有包含 `配送方法`，旧逻辑会跳过展开配送，直接进入金额校验并报 `expected 535円, found 910円`。现在只要页面金额和系统期望金额不一致，且订单存在有效运费，就会强制尝试展开/选择配送，不再依赖 `textSample` 是否已经包含 `配送方法`。
- 2026-06-07 真实测试结论：`u1231877298` 从 `910円` 变为 `865円` 代表运费已从 `230円` 成功改为 `185円`，剩余差额 `330円` 是当前本地 Yahoo 默认 `コンビニ` 付款方式的手续费。插件不自动修改付款方式，因此本地无信用卡时仍会按金额不一致阻断付款；生产信用卡默认应无该手续费。
- 付款金额不一致错误现在会识别 `手数料330円` 这类付款方式手续费，错误中附带 `paymentMethodFee: 330円 (current payment method adds fee)`，避免继续误判为运费未选中。
- 不自动修改付款方式；付款方式保持 Yahoo 当前选中项，生产环境应使用默认信用卡。
- 选择配送方式后会等待页面金额刷新，再执行原有金额校验；金额不一致仍会阻断付款。
- 新增回归测试覆盖：配送初始折叠且默认 `230円` 时，插件会先展开配送方式，再选中系统保存的 `185円` 配送，最终以 `535円` 继续付款。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-07 普通商品待发货扫描修正

### 已实现内容

- 普通商品待发货扫描中，如果页面已显示“出品者から商品発送の連絡がありました”，但 `追跡番号` 为 `未登録（反映されるまでお待ちください）`，插件不再当作已发货处理；保持 `pending_shipment`，继续走“是否增加提醒”逻辑并关闭 tab。
- 上述规则只作用于普通商品取引页；商城商品扫描逻辑保持不变。
- 普通商品已发货但没有 12 位追踪号时，单号兜底来源由顶部 `出品者` 名称改为 `出品者情報` 区块里的 `氏名`，例如 `毛利　好之助`；只有没有该字段时才继续回退旧的出品者名称。
- 新增回归测试覆盖 `追跡番号：未登録` 和 `出品者情報 -> 氏名` 兜底。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```
---

## 2026-06-07 Yahoo PIN / 文字验证码人工协同

### 已实现内容

- 插件打开 `取引連絡` / 取引页时，如果跳到 Yahoo 人工验证页，会自动暂停当前流程并把验证需求同步到后台顶部提醒栏。
- 后台提醒栏复用 `config.manual_captcha_challenge` 存储当前验证挑战，支持两种类型：
  - `type='pin'`：只显示 PIN 输入框和“提交 PIN”按钮。
  - `type='captcha'`：显示验证码图片、输入框和“提交验证码”按钮。
- PIN 页面识别：
  - 插件会优先按 Yahoo 登录/账号验证域名和 URL 关键字判断可能的 PIN 页；
  - 再读取页面文本和输入框，匹配 `PIN`、`確認コード`、`認証コード`、`セキュリティコード`、`コード` 等文字。
- PIN 协同流程：
  - 后台顶部出现“Yahoo 需要 PIN 码验证，请输入 PIN 后继续任务”；
  - 管理员输入 PIN 后，插件轮询 `/api/plugin/manual-captcha/answer/:id` 拿到答案；
  - 插件自动填入 Yahoo PIN 输入框并点击继续/确认类按钮；
  - 如果验证码之后再次回到 PIN 页，会复用刚才的 PIN 自动再填一次，不再重复提醒管理员输入。
  - 如果 PIN 提交后仍停在 PIN 页，不会继续复用同一个 PIN，而是重新在后台提醒栏要求输入。
- 文字验证码协同流程：
  - 跳到 `https://login.yahoo.co.jp/ncaptcha...` 时，插件激活验证码 tab；
  - 使用 `chrome.tabs.captureVisibleTab` 截取可见页，并优先裁出验证码图片区域；裁剪失败时回退为整页截图；
  - 验证码图片以 data URL 写入服务端，后台 `/api/admin/idle-flags` 返回当前待处理验证码；
  - 管理员输入图中日文后，插件自动填入 Yahoo 验证码输入框并点击 `続ける`。
  - 如果验证码输入错误后 Yahoo 仍停留在验证码页面，插件下一轮会重新截图并再次发到后台提醒栏，直到验证码通过或达到循环上限。
- 验证流程最多循环 6 步，覆盖 `PIN -> 验证码 -> PIN -> 取引页` 这类链路，避免无限卡住。
- 每次 PIN / 验证码提交并成功填入后，插件会关闭对应后台提醒；验证结束后继续原来的取引页流程。
- 前台用户端新增管理员提醒栏：
  - 新接口 `/api/task/manual-verification-alert` 只对登录用户 `user_level >= 3` 且当前挑战为 `type='pin'` 时返回提醒；
  - 前台所有已登录页面顶部会显示 `后端有事情要处理！`；
  - 没有 PIN 挑战、挑战关闭、或登录用户不是前台管理员时，前台提醒栏不显示。
- 该功能是人工协同，不做自动识别验证码，也不绕过 Yahoo 验证；后续拿到真实 PIN 页面源码/截图后，仍可能需要微调输入框和按钮选择器。

### 最近验证命令

```powershell
node src\server\services\manualCaptcha.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node src\server\routes\task.test.js
node src\client\src\utils\manualVerificationAlert.test.mjs
Set-Location src\admin
npm run build
Set-Location src\client
npm run build
```
---

## 2026-06-07 Google 表格配置凭据路径显示

### 已实现内容

- 后台“系统配置 -> Google 表格配置”在 Google 表格地址下面新增只读备注字段：`Google JSON文件绝对路径`。
- 该字段来自服务端 `.env` 的 `GOOGLE_APPLICATION_CREDENTIALS`，服务端会用 `path.resolve()` 转为绝对路径后返回。
- 如果使用的是 `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` 或 `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` 这类非文件方式，则该路径为空，页面显示未配置文件路径的占位提示。
- 迁移服务器时，需要同时迁移 `.env` 配置和该 JSON 文件；Chrome 登录的 Google 账号不影响该 service account 方式的 Google Sheets API 调用。
- 2026-06-07 追加：Google 表格地址和 JSON 文件绝对路径默认锁定不可编辑；后台新增“允许修改 Google 表格配置”勾选框，勾选后才允许修改。
- 勾选后保存会把表格 ID 写入 `config.google_sheets_spreadsheet_id`，把 JSON 路径写入 `config.google_application_credentials`，并立即覆盖当前 Node 进程的 Google Sheets 运行配置。
- Google Sheets 写表和确认收货颜色匹配任务执行前会从 `config` 表加载这两个覆盖值；如果没有数据库覆盖值，则继续使用 `.env` 中的 `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_APPLICATION_CREDENTIALS`。

### 最近验证命令

```powershell
node src\server\services\googleSheets.test.js
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-06 待收货物流单号显示与抽取修正

### 已实现内容

- 待发货扫描抽取 `伝票番号` / `追跡番号` 时，只保存第一段 12 位数字，支持中间用 `-` 或空白分隔。
  - 示例：`3901-6644-7193配送状況を調べる...08096096438` 保存为 `390166447193`。
  - 如果字段值里没有 12 位单号，不再把整段字段文字保存为单号；继续走聊天 12 位单号和出品者名称兜底。
- 用户端“落札商品”列表不再显示物流和追踪号；后台订单管理仍保留物流字段用于管理查看。
- 新增回归测试覆盖带外部链接/后续文字的传票号字段。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
Set-Location src\client
npm run build
```
---

## 2026-06-06 商城即決价格税后口径修正

### 问题

- 商城商品抓取时，`currentPrice` 仍按系统内部税前口径保存并由用户端展示时乘 `1.1`，但 `buyoutPrice` 如果来自 Yahoo `pageData.items.winPrice`，之前直接返回税前值。
- 结果用户端商品卡显示当前价为税后，但即決价格仍显示税前，例如 `winPrice=250091` 被显示为 `250,091円（税込）`，正确应显示 `275,100円（税込）`。

### 已实现内容

- `src/server/routes/proxy.js`：商城商品 `tax_included` 且即決价来自 `pageData.items.winPrice` 时，返回给前端前乘 `1.1` 转为税后口径。
- `yahoo-plugin/content.js`：插件商品快照同样对 `pageData.items.winPrice` 的商城即決价乘 `1.1`，避免刷新快照时写回税前即決价。
- `currentPrice` 仍保持税前口径，沿用现有出价校验/提交逻辑。
- 新增回归测试覆盖 `price=250091`、`winPrice=250091`、页面显示税込时，`buyoutPrice=275100`。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
node yahoo-plugin\content.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-08 确认收货按钮点击修正

### 问题

- Yahoo 普通商品受取連絡页同时存在两个 `value="受け取り連絡"` 按钮：
  - 灰色 `.jsOffReceiveButton / libBtnDisL`，默认显示，点击只会 `javascript:void(0)`。
  - 红色 `.jsOnReceiveButton`，默认 `display:none`，勾选 `商品を受け取りました。` 后才显示，并带真实 `/buyer/ship?...` 跳转。
- 插件之前只按按钮文字匹配，可能点到灰色假按钮，导致页面停留在受取連絡页，后台提示 `receipt completion text not found`。

### 已实现内容

- `yahoo-plugin/background.js` 确认收货状态识别新增：
  - 识别复选框是否已勾选。
  - 识别 `受け取り連絡` 真实按钮是否可见可用。
  - 把 `.jsOffReceiveButton / libBtnDisL` 视为不可提交按钮。
- 复选框普通点击后如果按钮仍未启用，会使用 Chrome debugger 派发真实鼠标点击兜底。
- 提交按钮点击只选择可见且可用的 `.jsOnReceiveButton`，避免再点灰色假按钮。
- 新增回归测试覆盖确认收货先遇到灰色按钮、兜底勾选后再点击真实按钮的流程。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-08 出品者情報氏名兜底修正

### 问题

- 普通商品待发货扫描在没有 12 位追踪号时，会用 `出品者情報` 栏里的 `氏名` 作为单号兜底。
- 真实 Yahoo 页面可能把整个 `取引情報` 放在一个大 `div` 的 `textContent` 中，里面同时包含 `お届け情報`、`落札者情報` 和 `出品者情報`。
- 旧逻辑在这个大文本里直接匹配第一个 `氏名`，会误取 `落札者情報` / `お届け情報` 的姓名，例如 `GAO YUN`，而不是 `出品者情報` 的 `エーシー　商事`。

### 已修复内容

- `yahoo-plugin/content.js` 新增 `extractSellerInfoSectionText()`，先把文本裁剪到 `出品者情報` 区块后，再抽取该区块里的 `氏名`。
- 保持原优先级不变：有真实 12 位 `伝票番号` / `追跡番号` 时仍优先使用真实单号；只有没有单号时才使用 `出品者情報 -> 氏名` 兜底。
- 新增回归测试覆盖：同一个大 `取引情報` 文本块里同时存在 `落札者情報 氏名: GAO YUN` 和 `出品者情報 氏名: エーシー　商事` 时，兜底结果必须是 `エーシー　商事`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```

---

## 2026-06-08 用户端完了状态样式调整

### 已实现内容

- 用户端 `落札商品` 页面中，订单状态 `completed -> 完了` 的标签保持默认绿色；整条商品行背景改为淡蓝色，和取消订单整行淡红色同一逻辑。
- 仅调整用户端展示样式，不改变订单状态值和后台订单管理样式。

### 最近验证命令

```powershell
Set-Location src\client
npm run build
```

---

## 2026-06-08 商品页登录误判修正

### 问题

- 商品 `f1232542390` 本地出价时，Yahoo 商品页打开后没有跳转登录页，也没有执行出价，任务直接失败为 `需要登录 Yahoo`。
- 根因是 `executeBidV3()` 在商品页执行前扫描整页文本，只要页面里出现 `ログイン...必要` / `ログインしてください` 这类普通提示文案，就提前返回登录失败。
- 业务判断确认：`https://auctions.yahoo.co.jp/jp/auction/{商品ID}` 商品页本身不应做登录失败判断；如果真的未登录，Yahoo 会跳到 `login.yahoo.co.jp` 或账号验证域名，不会停留在商品页。

### 已修复内容

- `yahoo-plugin/content.js` 新增 `isYahooLoginPageUrl()`，出价执行入口只在当前 URL 为 `login.yahoo.co.jp` / `account.edit.yahoo.co.jp` 时返回 `需要登录 Yahoo`。
- 商品页即使包含登录提示文案，也继续走正常出价按钮查找和点击流程。
- 保留 `detectYahooLoginStatus()` 对 `/my/won`、入札中、交易页、扫描页等同步流程的登录状态上报逻辑，不影响后台顶部 Yahoo 登录状态显示。
- 新增回归测试覆盖：商品页文本含 `ログインが必要` 时，不能在出价执行入口直接返回 `需要登录 Yahoo`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```

---

## 2026-06-08 运费优先 Yahoo shipment API

### 问题

- 部分商城商品页面说明里有卖家自定义运费表，程序按页面文字解析时可能取到第一行地区运费，例如 `v1232498111` 取到北海道 `1,570円`。
- 同一商品通过 Yahoo shipment API 按当前默认地区 `prefCode=27` 返回真实配送方式 `佐川急便（宅配便） 910円`。

### 已修复内容

- `src/server/routes/proxy.js` 商品抓取改为：只要能从页面构造 Yahoo shipment API URL，就优先调用 shipment API。
- shipment API 返回有效金额时，覆盖页面说明/表格解析出来的运费。
- shipment API 参数缺失、请求失败或无有效金额时，仍回退到原有页面解析结果。
- HTTP 抓取和 Playwright 兜底抓取都应用相同优先级。
- 新增回归测试覆盖：页面说明表先出现 `1,570円`，但 shipment API 返回 `910円` 时，最终运费必须是 `910円`。
- 2026-06-09 追加优化：`落札者負担` 被识别为有效兜底结果；如果 shipment API 已尝试但超时或没有有效金额，直接返回 `落札者負担`，不再继续 Playwright + shipment API 重复兜底，避免类似 `j1230839418` 抓取耗时被多次超时放大。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
```

### 真实验证

- `v1232498111` 当前服务端抓取结果：`shippingFeeText=910円`。

---

## 2026-06-08 商城税前价最低出价校验修正

### 问题

- 商城商品选择 `税前价` 输入最高出价时，前端先把输入税前价换算成税后实际出价，再在提交校验里把税后价折回税前。
- 折回函数会按 10 円向下取整，导致用户输入 `10093` 税前价时，实际用于最低出价校验的值变成 `10090`。
- 例如商品当前税前价 `9841`、已有入札最低加价 `250`，最低可出价应为 `10091`；用户输入 `10093` 本应通过，但旧逻辑误报低于最低可出价。

### 已修复内容

- `src/client/src/utils/bidPrice.js` 新增 `getMinimumBidComparableInputPrice()`。
- 商城商品 `税前价` 模式下，最低出价校验直接使用用户输入的税前日元，不再进行“税前 -> 税后 -> 税前”的二次换算。
- `税后价` 模式和普通商品逻辑保持原有口径。
- 新增回归测试覆盖：`currentPrice=9841`、`bidCount>0`、税前输入 `10093` 时，应满足最低 `10091`。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```
---

## 2026-06-08 税后折税前不再按 10 円取整

### 问题

- 商城商品含税金额折回税前金额时，旧逻辑使用 `Math.floor((price / 1.1) / 10) * 10`，会额外按 10 円向下取整。
- Yahoo 出价金额允许末尾为 1 円等非 10 円档金额，因此该取整会把有效价格压低。
- 例：`11103 / 1.1 = 10093.636...`，正确系统税前价应为 `10093`，旧逻辑会变成 `10090`。

### 已实现内容

- 前台提交页、服务端任务提交、插件 followup 任务、入札中同步的“税后折税前”逻辑统一改为 `Math.floor(price / 1.1 + 1e-6)`。
- 不再做 `/10` 后再 `*10` 的 10 円档取整。
- `2460` 含税即決价对应的系统税前出价从 `2230` 调整为 `2236`。
- 新增/更新回归测试覆盖：`11103 -> 10093`，以及入札中同步和 followup 创建时不再变成 `10090`。

### 最近验证命令
```powershell
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\client\src\utils\bidPrice.test.mjs
node src\client\src\utils\submitValidation.test.mjs
Set-Location src\client
npm run build
```
