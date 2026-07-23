# g-daipai 项目说明与当前计划

**最后更新**: 2026-07-22

本文件是后续接手本项目的主说明和计划记录。只保留当前仍有用的架构、业务规则、生产注意事项、验证命令和下一步计划；已解决且无后续价值的流水记录不要继续堆在这里。

---

## 维护约定

- 每次重要改动后，更新本文件的“当前状态 / 当前主计划 / 最近重要变更 / 验证命令”。
- 真实生产问题只记录结论、影响范围、修复方式和后续注意，不记录冗长排查过程。
- 已确认解决且不再影响后续设计的问题，可以从“当前主计划”移除。
- 新计划优先放在本文件“当前主计划”；复杂计划再另存到 `docs/superpowers/plans/`。
- 修改数据库、插件支付/交易/扫描、任务状态流转前，必须先确认本文件中的业务边界。

---

## 项目概述

Yahoo 日本拍卖代拍系统。中国用户通过 Web 提交商品 URL、最高价和出价策略；Windows 服务器上的 Chrome 扩展轮询 API，在 Yahoo Auction 页面自动执行竞拍、同步入札中状态、同步落札订单，并处理交易开始、付款、扫描物流和确认收货等订单流程。

生产侧已连续运行稳定；当前后续重点是三表模型收尾、用户本地商品缓存提速，以及 Windows Chrome 小窗口下 PIN/文字验证码截图稳定性。

---

## 当前架构

```text
用户浏览器 / React Client
    |
    | HTTP /api
    v
API Server / Express + SQLite
    |
    | HTTP polling /api/plugin/*
    v
Chrome Extension / yahoo-plugin on Windows Chrome
    |
    v
Yahoo Auction
```

常用地址与目录：

- 本地工作区：`D:\www\g-daipai`
- 生产目录通常为：`C:\www\g-daipai`
- API：`http://localhost:3034`
- 用户端静态服务：`http://localhost:3035`
- Chrome 扩展目录：`yahoo-plugin/`

---

## 主要代码位置

- `yahoo-plugin/background.js`: 插件轮询、出价池、订单工作流、付款/交易/扫描/确认收货。
- `yahoo-plugin/content.js`: Yahoo 页面解析、商品/入札中/落札数据提取、页面点击操作。
- `src/server/routes/task.js`: 用户任务提交、任务列表、落札商品、用户统计。
- `src/server/routes/plugin.js`: 插件任务领取、状态回写、订单同步、诊断上报。
- `src/server/routes/admin.js`: 后台任务/订单/报表/批处理/配置。
- `src/server/models/index.js`: SQLite schema 初始化与兼容列维护。
- `src/server/services/productRepository.js`: `products` 商品快照归一化、写入、回填相关逻辑。
- `src/client/src/pages/Submit.jsx`: 用户提交商品与出价配置。
- `src/client/src/utils/bidPrice.js`: 用户端价格换算、出价展示与校验辅助。
- `scripts/check-product-read-paths.js`: 检查是否还有直接读取旧 `tasks` 商品快照字段的路径。
- `scripts/check-product-health.js`: 检查 `products` 商品展示核心字段完整性。
- `scripts/check-product-parity.js`: 检查三表关系与商品快照一致性。

---

## 数据模型现状

目标模型：

```text
products.product_id 1 --- N tasks.product_id
products.product_id 1 --- 0/1 orders.product_id
orders.task_id      N --- 0/1 tasks.id
```

当前状态：

- `products` 已作为商品快照表引入。
- 运行查询已大量改为 `products` 优先、旧 `tasks` 字段回退。
- `orders.product_id` 已用于订单和商品关系。
- 生产侧暂时不急于删除 `tasks` 中的旧商品快照字段。
- 下一阶段要做的是“读写边界硬化”和“删冗余字段前的迁移准备”，不是直接删字段。

长期字段职责：

- `products`: 商品 URL、标题、图片、当前价、即决价、入札数、税类型、商品类型、运费文本、结束时间等商品快照。
- `tasks`: 用户出价意图、策略、最高价、任务状态、出价执行状态和错误。
- `orders`: 落札事实、成交价、交易 URL、付款/发货/收货状态和结算字段。

旧冗余字段候选：

- `tasks.product_url`
- `tasks.product_title`
- `tasks.product_image_url`
- `tasks.current_price`
- `tasks.buyout_price`
- `tasks.bid_count`
- `tasks.tax_type`
- `tasks.product_type`
- `tasks.shipping_fee_text`
- `tasks.end_time`

这些字段最终应从 `tasks` 删除，但必须先完成当前主计划中的审计、payload 边界硬化、生产备份和迁移验证。

---

## 当前主计划

### 1. 三表模型收尾和冗余字段删除

目标：让 `products` 成为商品快照唯一权威来源，`tasks` / `orders` 不再承担商品快照字段职责。

执行顺序：

1. 字段依赖审计
   - 增强并运行 `scripts/check-product-read-paths.js`。
   - 覆盖插件 payload、后台订单页、Google Sheet、debug API、报表、批处理。
   - 确认没有新代码直接依赖 `tasks.current_price`、`tasks.tax_type`、`tasks.end_time` 等旧字段。

2. 插件 payload 边界硬化
   - API 返回明确的商品字段名，例如 `product_current_price`、`product_tax_type`、`product_end_time`、`product_shipping_fee_text`。
   - `yahoo-plugin/background.js` 内部逐步改用明确字段，不再把 `task.current_price` 这类名字当商品快照来源。
   - 短期可以保留兼容 fallback，但新增逻辑必须使用 `product_*` 字段。

3. 迁移脚本准备
   - 写生产迁移脚本或明确 SQLite table rebuild 步骤。
   - 迁移前必须停止服务并备份数据库。
   - 迁移脚本要先 dry-run 输出将删除字段、现有表结构、数据行数和回滚说明。

4. 最终删除冗余字段
   - 删除前再次运行健康检查和读路径检查。
   - 删除后跑完整回归。
   - 更新 `src/db/init.sql`、`src/server/models/index.js` 和相关测试，确保旧字段不会被重新创建。

验收命令：

```powershell
node scripts/check-product-read-paths.js
node scripts/check-product-health.js
node scripts/check-product-parity.js
node scripts/encoding-guard.js
npm run regression
```

### 2. 用户本地商品缓存提速

目标：用户提交商品时，重复查询同一 Yahoo 商品能更快展示商品信息；缓存只做用户体验加速，不替代服务器 `products` 权威数据。

建议方案：

1. 抽象用户端商品信息入口
   - 在客户端集中封装 `getProductInfo(url)` 或等价方法。
   - 提交页只调用这个入口，不直接散落调用 `/api/proxy/fetch`。

2. 增加本地缓存
   - 缓存 key 使用标准化 auction id。
   - value 保存商品快照、抓取时间、来源和版本。
   - 先用 `localStorage` 即可；数据量变大后再考虑 IndexedDB。

3. TTL 策略
   - 进行中商品短缓存，例如 1-5 分钟。
   - 临近结束商品更短或强制刷新。
   - 已结束/已落札商品可长缓存。
   - 用户提交任务前仍以后端/插件实际页面为准，不能只信缓存。

4. 查询优先级
   - 先读本地缓存，命中且未过期就立即展示。
   - 同时后台刷新服务器抓取结果。
   - 刷新成功后更新页面和缓存。
   - 刷新失败时，如果缓存仍可用，提示使用缓存展示；提交时让服务端继续校验。

验收重点：

- 第二次打开同一商品明显更快显示。
- 缓存不会让过期价格绕过提交校验。
- 店铺含税、普通个人、即决商品、多次出价校验保持不变。

建议验证：

```powershell
node src/client/src/utils/bidPrice.test.mjs
node src/server/routes/task.test.js
npm run build --prefix src/client
node scripts/encoding-guard.js
```

### 3. Windows Chrome 小窗口下 PIN/文字验证码截图稳定性

目标：服务器 Windows Chrome 即使窗口被缩小、视口较小或验证码区域不在当前可视范围内，后台也能稳定显示 Yahoo 文字验证码，并保证后续 PIN 的 Win32 真实键盘输入仍落在正确窗口。

已确认现象和边界：

- 生产后台收到的 `imageDataUrl` 可能是尺寸、格式均有效但内容全白的 PNG；不是后台跨域、Base64 截断或 `<img>` 渲染失败。
- 当前 `captureManualCaptchaImage()` 只在激活窗口后固定等待 `500ms`，随后优先调用 `Page.captureScreenshot`，且使用 `captureBeyondViewport: false`。
- Chrome 窗口缩小后，验证码可能处于可视视口之外，或 Windows 合成器尚未完成绘制；CDP 仍会返回非空截图数据，现有逻辑会直接把白图当成功结果上报。
- 现有测试只覆盖“存在 PNG/Base64 数据”，尚未覆盖全白/低对比度截图、较小视口和窗口状态恢复。
- PIN 的 Win32 `SendKeys` 依赖 Chrome 窗口可见、置前并聚焦；验证码截图修复不能在 PIN 输入前过早恢复或最小化窗口。

后续建议方案：

1. 进入人工验证码流程时记录 Chrome 原窗口状态和 bounds，临时置前并最大化。
2. 将验证码元素 `scrollIntoView({ block: 'center' })`，等待页面完成绘制后再截图。
3. CDP 截图启用 `captureBeyondViewport: true`，同时保留页面图片/canvas 直接提取作为优先或备用路径。
4. 对截图做全白/低对比度检测；检测失败时等待后自动重试 2-3 次，不能仅凭非空 Base64 判定成功。
5. 验证码和紧随其后的 PIN 流程全部结束后，再恢复原窗口状态和 bounds。
6. 增加小视口、首次白图后重试成功、连续白图降级、PIN 输入前保持窗口可见，以及流程结束恢复窗口状态的回归测试。

本项当前只记录方案，尚未修改 `yahoo-plugin/background.js` 或生产插件。

建议验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 4. 普通商品同捆“决定后下一页未出现”假失败观察

当前先记录现象，暂不修改代码；等待下次出现同类错误时结合当时页面和诊断再次确认。

已知案例：

- 2026-07-19，普通商品同捆主商品 `e1236939416`，同组共 6 件。
- 第一次执行报错 `bundle decide next page did not appear`。
- 同一时刻的 `plugin_diagnostics` 显示交易 tab 已为 `complete`，且页面状态为 `complete: true`、`canDecide: false`、`canConfirm: false`。
- 这说明 Yahoo 侧同捆申请很可能已经成功，插件只是在点击“决定”后的等待窗口内没有及时识别完成状态，属于结果确认超时/假失败，而不是已确认的 Yahoo 业务失败。
- 后续系统内出现主商品和子商品分别进入 `pending_payment` 的状态分裂；经“普通商品同捆修复”把 `e1236939416`、`f1236933661`、`u1236935016`、`l1236934445`、`o1236939253`、`x1236919391` 归为同组，再由扫描读取到同捆运费 `600円` 后恢复正常：主商品 `pending_payment`，其余 5 件 `bundle_completed`。

当前优先工作假设：

- 该现象大概率与同捆商品数量较多有关。既有 2-3 件的同捆未出现此问题；本次 6 件商品时，Yahoo 在点击“决定”后可能需要更长时间完成后台确认和页面状态渲染，超过插件当前固定等待时间后形成假超时。
- 下次确认需要同时记录同捆件数和实际完成耗时，用更多样本验证该关联；在确认前仍将“商品较多导致 Yahoo 确认变慢”视为优先排查方向，而不是已经完全证实的唯一原因。

后续修复优先顺序（本次暂不实施）：

1. 先延长商品较多时的同捆操作等待时间：同捆数量达到 3 件以上时，在现有超时基础上按每件商品增加约 2 秒，例如 6 件同捆额外增加约 12 秒。
2. 下次复现时观察动态延长后的等待是否能够稳定读取 Yahoo 完成状态。
3. 如果延长超时后仍会假失败，再实施“结果未知不直接判失败、冻结整组、重新打开 Yahoo 页面核实完成事实”的二次确认方案。

下次复现时优先保留和核对：

1. 点击“决定”前页面列出的商品 ID、件数和当前按钮状态。
2. 报错瞬间及随后 15-30 秒内的 URL、`tab.status` 和 `GET_BUNDLE_TRANSACTION_ACTION_STATE` 结果。
3. Yahoo 页面是否已经显示“まとめて取引を依頼中です / 出品者からの連絡をお待ちください”。
4. 是否发生页面异步重绘、content script 短暂无响应、新 tab 打开或原 tab URL 未变化。
5. 报错后是否继续逐件领取同组子商品，以及各订单首次状态回写时间。

在再次确认前的人工处理边界：遇到相同错误先到 Yahoo 核实同捆是否已经申请成功；如果 Yahoo 已成功，不重复点击申请，使用现有“普通商品同捆修复”恢复整组关系后再扫描。

---

## 核心业务规则

### 任务状态

`tasks.status` 常用值：

- `pending`: 等待插件领取。
- `processing`: 已被插件领取执行中。
- `bidding`: 已出价或等待后续同步确认。
- `success`: 已落札成功。
- `failed`: 出价或流程失败。
- `cancelled`: 取消或不可继续。

### 出价策略

`tasks.strategy` 常用值：

- `direct`: 即时拍。
- `multi_bid`: 多次出价。
- `1min` / `2min` / `5min` / `10min`: 结束前出价。
- `manual_import`: 手动导入，用户侧显示为 `导入`。

### 价格与税

- Yahoo 商城商品页面价格通常按税前价处理，含税展示和校验由系统计算。
- `tax_type=tax_included` 表示商城含税商品。
- `tax_type=tax_zero` 表示个人商品或税 0 商品。
- `product_type=store` 表示走 Yahoo ストア订单/付款流程；`product_type=normal` 表示走普通取引ナビ流程。
- `product_type` 和 `tax_type` 不要互相强推。存在 `product_type=store` 且 `tax_type=tax_zero` 的“ストア但税 0/不含税表现”商品；只有 `tax_type=tax_included` 才能触发 1.1 含税换算。
- 提交给插件和任务的最高价仍以日元为准。
- 人民币只用于页面换算和展示，不进入插件出价逻辑。

### 多次出价

- 多次出价有最低最高价配置，默认 `5000円`。
- 加价阶梯按 Yahoo 规则校验：
  - `< 1000`: `10円`
  - `< 5000`: `100円`
  - `< 10000`: `250円`
  - `< 50000`: `500円`
  - `>= 50000`: `1000円`

### 订单状态

`orders.order_status` 常用值：

- `pending_payment`: 待付款。
- `waiting_shipping`: 等待卖家给运费。
- `pending_bundle`: 同捆流程中。
- `bundle_completed`: 同捆完成。
- `pending_settlement`: 待结算。
- `pending_shipment`: 待发货。
- `pending_receipt`: 待收货。
- `completed`: 完成。
- `cancelled`: 取消。

### 落札同步事实来源

Yahoo `/my/won` 落札页是落札事实来源。只要落札页出现某商品，就说明 Yahoo 侧已经拍到；插件前面的出价/即决流程即使因为消息通道、tab、timeout 或系统错误把任务标成 `failed`，落札同步也必须能把该商品对应任务纠正为 `success` 并生成/更新订单。

实现边界：

- `/api/plugin/orders/sync` 匹配对应 `tasks.product_id` 时，不应只限制 `bidding/success`。
- 允许从 `failed/processing/bidding/success` 纠正为 `success`。
- `cancelled` 仍作为人工/业务取消边界，默认不自动复活。
- 最终成交价、成交时间和交易 URL 以 `/my/won` 当前行解析结果为准。

### 插件调度

当前插件有三条执行线：

- 出价并行池：通过 `/api/plugin/tasks?limit=N` 批量领取任务，默认并发数 2。
- A/B 监控同步：同步 `/my/bidding` 和 `/my/won`。
- C/D/E/F/G 订单工作流：手动导入、交易开始、扫描、付款、确认收货。

工作流优先级：

```text
G manual_order_import -> C transaction_start -> D scan -> E payment -> F confirm_receipt -> none
```

PIN/验证码暂停只影响订单工作流，不应阻塞出价并行池和 A/B 监控。

---

## 生产注意事项

- 生产 Chrome 扩展更新后，需要在服务器 Chrome 中手动 reload。
- 用户端生产服务不要用 Vite dev server 对公网提供访问。生产启动应使用 `start.bat` 构建 `src/client/dist` 后由 `scripts/serve-client-dist.js` 服务静态文件，并继续将 `/api` 代理到 `http://localhost:3034`。
- `Failed to fetch` 通常表示插件访问不到 `http://127.0.0.1:3034` 或 `http://localhost:3034`，优先检查 API watcher/server 是否运行。
- Chrome MV3 的 `No SW` 是 service worker 生命周期噪声，现已做精确抑制，不应和业务失败混淆。
- 不要用宽泛 tab cleanup 关闭 `auctions.yahoo.co.jp/jp/auction/...` 商品页，否则可能误关并行出价 tab。
- 交易/扫描/付款真实输入 fallback 使用 `chrome.debugger` 时，应记录 `plugin_diagnostics`，方便后台 Reports 查询。
- 生产删字段或重建 SQLite 表前，必须停服务、备份数据库并准备回滚。

---

## 诊断与报表

插件诊断接口：

```text
GET /api/plugin/diagnostics?productId=...
GET /api/plugin/diagnostics?type=trusted_input
```

后台 Reports 当前包括：

- `chrome.debugger` trusted-input 使用统计。
- 出价失败 diagnostics，包括 timeout、系统错误和执行阶段。
- 近 5 天按用户统计的响应超时/系统原因失败。

常见诊断类型：

- `trusted_input`: 真实输入 fallback。
- `bid_failure`: 出价失败、超时或页面异常。
- `scan`: 扫描卡住或无法推进。
- `payment`: 付款失败。

---

## 最近重要变更摘要

### 2026-07-23 Google 表格写入失败重试和后台提醒

Google Sheets 所有请求在遇到网络错误、HTTP 429 或 5xx 时会等待 1 秒后再重试 1 次；其他 4xx 配置或权限错误不自动重试。待收货订单写表最终仍失败时，服务端会在 `config.google_sheet_alerts` 中保存对应主订单的提醒；普通订单显示自身商品 ID，同捆订单只显示触发整组写表的主商品 ID，同一主订单重复失败只保留并更新一条提醒。

后台顶部每 5 秒随现有 idle flags 轮询显示 Google 表格写入失败提醒，内容包括商品 ID 和最终错误；“跳转批处理”会打开“数据批处理”并直接选中“待收货补表格”，其后的 X 图标会从服务端持久化提醒列表中删除该提醒。数据批处理页支持通过 `?tab=receiptSheetBackfill` 精确选择补表标签。

验证：
```powershell
node --check src/server/services/googleSheets.js
node --check src/server/routes/plugin.js
node --check src/server/routes/admin.js
node src/server/services/googleSheets.test.js
node src/server/routes/plugin.test.js
node src/admin/src/AdminLayout.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-22 后台消息读取改为查询订单并增加状态筛选

后台菜单和页面标题由“消息读取”改为“查询订单”，路由和原有消息抓取、查看、发送能力保持不变。查询区域在落札时间后新增订单状态下拉，默认查询全部，可按待支付、等待运费、待同捆、同捆完了、待结算、待发货、待收货、完了和取消九种现有状态筛选，并可与用户名、商品 ID、落札时间及分页组合使用。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-19 商城即决完成页延迟稳定后关闭出价 Tab

商城即决商品跳转到 `buy.auctions.yahoo.co.jp/order/thank-you` 时，Chrome 可能因页面进入 back/forward cache 连续关闭两次扩展消息通道。第一次断线后的即时检查有时仍停留在购买确认页，原逻辑第二次断线后会直接进入失败处理；等失败诊断读取页面时，Yahoo 完成页其实已经稳定出现，导致任务被误标失败且完成页 tab 残留。

修复：出价异常最终落库前，如果异常属于消息通道关闭，且商城即决 tab 的最终 URL 或页面内容已经明确为购买完成，则按完成事实恢复任务为 `bidding`，关闭受管任务 tab，并跳过 `bid_failure` 假诊断。回归测试覆盖第一次检查仍在 review 页、第二次断线后最终检查才出现 thank-you 页的真实时序，同时把测试商品结束时间更新到未来，确保用例确实执行出价链路。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-18 消息读取列表显示订单追踪号

后台“消息读取”列表在“订单状态”后新增“追踪号”列，直接显示订单 `orders.tracking_number`；没有单号时显示 `-`。消息列表接口同步返回该字段，原有消息抓取、发送和筛选逻辑不变。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 多次/定时出价达到最高价后停止并限定价格状态范围

商城多次出价商品 `d1237049950` 在 Yahoo 已显示“あなたが最高額入札者です / 自動入札上限 8,000円”，且任务税前最高价也是 `8,000円` 后，旧逻辑仍按“当前价 + 每次加价”计算下一轮，未先判断 Yahoo 自动出价上限已经达到任务上限，因而再次点击入札。修复后，多次出价在商品页检测到当前用户为最高额出价者、且自动出价上限大于等于任务税前最高价时，立即以 `multi-max-already-set` 成功结束本轮并关闭出价 tab，不再点击入札。服务端把“任务最高价已经成功提交/Yahoo 已确认”视为该任务的出价执行结束：只要该任务 `bid_logs` 中最高成功提交价达到 `tasks.max_price`，无论当前是否仍为最高额出价者，都直接从候选 SQL、调度二次检查和最终领取更新中排除，不再为了判断上限反复打开商品页；后台“下一条待执行”也使用同一排除条件，任务列表的“下次执行时间”显示为空，不再随刷新变化。`bidding` 状态继续保留给入札中/被超价/落札监控。作为额外边界，尚无最高价提交记录但当前仍为最高额出价者且商品当前价已达到任务最高价时，也停止派发。例如任务 `166` 当前价 `28,500円`、任务/已提交上限 `29,000円` 时，现在插件候选和后台待执行列表都会直接排除。

结束前 `1min / 2min / 5min / 10min` 策略增加同样的停止边界：执行时如果 Yahoo 已显示当前用户为最高额出价者，且自动出价上限大于等于该定时任务最高价，则以 `timed-max-already-set` 成功结束且不点击出价；如果现有自动上限仍低于任务最高价，则继续按定时任务提高上限。定时任务成功后状态进入 `bidding`，本来就不会像 `multi_bid` 一样被出价队列周期重领。即时拍保持现有显式行为：用户主动新建即时拍时允许再次提交以调整旧自动上限；低价规则创建的后续即时拍也必须能把初始上限提高到用户原最高价。即决流程不使用当前价/含税总额拦截，手动导入不进入出价队列。

多次出价/普通出价的“税込合計金額”读取同时取消整页正文 fallback。现在只允许从当前价格输入框所属的出价表单/确认弹窗、明确的出价 form，或精确“税込合計金額”标签附近的有限祖先区域读取；找不到结构化出价区域就返回 0，不再把推荐商品区的 `9,075円` 当成本商品含税总额。商品当前价仍使用本商品 `pageData`、服务器税前快照和商品主信息区域。“あなたが最高額入札者です / 自動入札上限”也不再从整页正文判断，只读取页面顶部明确状态区域或精确状态文案附近的有限祖先区域，卖家说明和推荐区不参与最高价停止判断。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 用户任务列表双击复用再入札

用户端提交任务页内嵌的任务列表支持双击任务中的商品 ID 再次入札。双击后会把该任务的 Yahoo 商品地址自动回填到“商品ID / 商品链接 / 商品名称”输入框，并直接复用提交页现有的商品信息抓取流程展示商品卡片；无需再手动复制商品 ID 或点击“获取商品信息”。标题、价格、状态和任务空白区域不触发此动作；界面不显示双击提示文字。独立任务列表页双击商品 ID 时会跳转到提交页并触发相同流程，“入札中”页原有“再入札”按钮也改为共用同一商品地址/提交地址辅助逻辑。

验证：
```powershell
node src/client/src/pages/TaskList.display.test.mjs
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/client/src/pages/Submit.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 出价当前价校验限定本商品脚本数据

生产商品 `o1236247041` 的任务最高价为税前 `40,000円`、用户含税上限为 `44,000円`，Yahoo 页面当前价为税前 `38,000円` / 含税 `41,800円`。普通即时拍校验曾直接把页面脚本中的含税当前价 `41,800円` 与税前任务最高价 `40,000円` 比较，导致在点击出价前误报“低于当前价”。

初次修复改成优先读取宽泛可见价格节点后，又在普通商品 `b1193713249` 命中了“相关推荐”商品的 `3,200円`，把本商品实际当前价 `3,000円` 的三条任务错误拦截。最终修复：普通即时拍和定时出价只使用本商品 Yahoo `pageData.items.price` 与服务器税前商品快照做当前价校验，不再使用可能命中推荐卡片的宽泛可见价格选择器；脚本解析改为先遍历整页寻找本商品 `pageData`，找不到后才允许通用解析使用 JSON-LD，避免脚本顺序让商城含税展示价抢先返回。用户含税上限仍由后续含税总额校验独立保护，即决商品和多次出价逻辑不变。

商品信息解析同时按 Yahoo 新版商城/个人商品 DOM 收紧：稳定锚点使用 `#itemTitle`、主信息区域内精确的 `dt=現在/即決`、`#itemPostage`、`#itemStatus` 和 `#bidButtonGroup`，随机 class 不作为边界。服务端和插件都不再从整页正文、任意价格 class、任意 `data-price` 或推荐商品区兜底读取商品当前价/即决价；优先使用本商品 `pageData` / `__NEXT_DATA__`，DOM fallback 也只在从 `#itemTitle` 到状态/按钮的商品主区域内解析。多次出价仅在 Yahoo 已明确显示“需要重新出价”时允许读取出价交互区的价格节点，仍不扫描全文价格。附件中的商城和个人商品 HTML 已分别验证标题、当前价、即决价、税类型、入札数、运费和即决-only 判定。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node src/server/routes/proxy.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-13 出价成功判定限定在 Yahoo 完成页

商品页上的商品说明、ストア通知或卖家介绍可能包含“入札しました”或“落札が完了しましたら”等说明性文字。插件不再根据商品详情页初始整页文字判定出价成功；普通出价进入 `/jp/auction/{商品ID}/bid/done` 完成页后，才允许直接根据成功文案或“最高額入札者”判定成功，商城即决仍以 `/order/thank-you` 作为完成事实。对少数不改变 URL 的 Yahoo 页面内更新流程，仅当插件已经点击本轮提交动作、且成功文字在点击前不存在而在点击后新出现时才允许判成功。这样可避免卖家说明中的条件句让插件在点击出价按钮前直接误报 `bidding`。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-12 入札页同步增加五分钟整轮超时

插件常规监控抓取 `/my/bidding` 时，除原有单页 30 秒加载等待外，整轮分页同步新增 5 分钟硬超时。网络卡顿或分页长时间无法完成并超过 5 分钟时，本轮入札同步会报错并自动关闭对应 tab；`syncMonitorYahooPages` 的 `finally` 会继续释放 `monitorRunning`，不阻塞下一轮监控重新运行。正常完成时仍按原逻辑抓取全部可见分页，落札页同步逻辑不变。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-12 普通商品同捆状态修复批处理

数据批处理新增“普通商品同捆修复”独立页，用于 Yahoo 端已经成功申请同捆、但系统因落札时间差导致同组订单分别停在 `pending_payment` / `pending_bundle` 的状态错位。管理员按顺序输入多个商品 ID，第一项作为主商品；服务端校验同一用户、普通商品、未结算、允许修复的早期状态和原组无遗漏后，在事务中为整组生成新的 `bundle_group_id`，统一改为 `pending_bundle`，清空旧同捆运费和交易开始错误，并写入 `admin_normal_bundle_repair` 状态审计。

自动交易开始回写也同步硬化：插件已经在 Yahoo 成功提交同捆并回传完整商品 ID 时，允许把同组内提前进入 `pending_payment` / `waiting_shipping` 的订单纠正为 `pending_bundle`，避免以后再次产生同类错位；其他交易开始状态回写仍只更新空状态订单。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/server/routes/plugin.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-10 个人商品发送后等待新消息渲染再抓取

个人商品发送消息原本在点击 Yahoo `送信` 后立即进入消息提取；Yahoo 消息列表异步更新较慢时，第二次发送后可能仍抓到发送前的旧列表，例如已显示 `111`，发送 `222` 后自动更新仍只有 `111`。调用顺序虽然是发送后抓取，但缺少发送完成后的页面可见性等待。

修复：个人商品与商城商品一样，发送点击后必须等待本次消息文本出现在 Yahoo 消息区域，确认可见后才执行聊天记录抓取和服务端覆盖。个人商品等待超时会把发送任务标记失败，并保留 pending 抓取任务供下一轮重试，不再用旧消息列表冒充本次自动更新结果。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的个人商品发送后等待回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-10 空订单状态支持消息抓取和发送

刚落札订单在后续订单工作流尚未推进前，`orders.order_status` 可能暂时为空。后台消息读取列表原本会显示这类订单和“消息更新”按钮，但消息抓取/发送共用的服务端校验使用 `NOT IN ('cancelled', 'bundle_completed')`，SQLite 会把空状态排除并返回 `order not found`。

修复：消息抓取和发送现在明确允许 `order_status IS NULL`，仍拒绝 `cancelled` 和 `bundle_completed`；新订单后续状态流转逻辑保持不变。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node --check src/server/routes/admin.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-10 消息读取兼容同捆提示页

后台消息读取/发送任务打开 Yahoo 交易页后，会先执行消息专用的安全导航，再提取或发送消息。普通商品遇到“可以同捆”“卖家同意同捆主商品”或“卖家要求单品交易”等同捆提示时，只点击提示区域内精确的 `閉じる`；商城商品遇到“まとめて購入手続き”提示时，先关闭提示，再点击 `単品で購入手続きする` 进入单品页面。导航完成的判定是普通/商城消息列表或商城消息发送区域出现，不会继续点击确认、付款或购买完成按钮。

同捆子商品不单独读取消息：后台继续隐藏 `bundle_completed` 子订单的消息更新入口，服务端也拒绝为这类子订单创建读取或发送任务；如果异常任务打开了带 `この商品を確認する` 的同捆子商品选择页，插件会停止并返回明确错误，不会点击 `まとめて取引を確認する`，也不会跳到主商品会话。消息抓取和消息发送共用相同的前置导航。因为新增了最多 12 秒的同捆导航等待，单个消息任务总超时从 30 秒调整为 45 秒。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/admin.orders.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的普通同捆关闭、商城两步入口和同捆子商品停止回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 商城消息无记录也可打开聊天框

商城交易页消息读取逻辑与普通商品保持同一业务语义：普通商品按 `#messagelist`，商城商品按新版 `section / ul.sc-c46fd2ce-0 / dl / dd / time / textarea` 结构读取。只要 Yahoo 页面存在交易消息/发送区域，就应视为抓取成功，后台时间可点击，弹窗内可继续输入并发送消息；不能因为当前没有历史聊天 `dl` 就返回 `message list not found`。

修复：商城消息提取在未找到 `dl/dd/time` 消息列表时，会继续识别消息区的 `textarea` 和 `#msg button`，返回空消息占位并写入最新更新时间，后台弹窗仍显示发送输入框。提取边界必须限定在 Yahoo 页面 `メッセージ` 下方的聊天/发送区域，不能把上方 `取引情報`、`配送情報`、`購入日時`、`注文番号` 等交易信息容器当作消息内容保存。插件打开交易页后提取消息增加短轮询，最多等待 8 秒，避免商城消息区异步渲染慢时过早写入 `message list not found`。法律链接列表仍不会作为聊天内容保存。

发送边界：普通商品仍按原 `#messagelist`、`#textarea`、`#submitButton` 路径处理；商城商品检测到 `#msg button` 后，只在该按钮附近的消息表单内查找 `textarea`，把后台弹窗输入框内容填入 Yahoo 的 `メッセージを入力してください。` 输入框后点击同一消息表单的 `送信`，避免误填页面其他输入框。普通 JS 提交路径也必须先 `scrollIntoView` + focus textarea，再写入文本并触发 `input/change`，随后 `scrollIntoView` + focus `送信` 按钮再触发 pointer/mouse/click。商城消息区是异步渲染，发送也必须像抓取一样等待消息输入框/发送按钮渲染出来，当前最多轮询 8 秒；发送后不能只因为程序化 click 成功就判定成功，必须在 Yahoo 消息区看到刚发送的文本。若商城 React 页面未接受程序化 click，插件会用 `chrome.debugger` 聚焦 textarea、真实插入文本并真实鼠标点击 `送信` 作为 fallback。发送成功后继续等待消息区渲染并抓取最新聊天内容回写，仍遵守“本次结果覆盖旧消息、不保留旧消息”的规则。

后台显示规则：消息抓取只能由“消息更新”按钮或发送消息动作显式触发，消息列表查询本身不得创建 pending 任务。没有发起过消息抓取的订单，时间列保持 `-`，即使历史脏数据里残留 `fetch_status='failed'` 和 `fetch_error`，服务端也不再把 failed/error 返回给前端；只有存在 `fetch_requested_at`、`fetch_started_at`、消息更新时间或消息内容的真实抓取/消息记录，才显示抓取失败信息。

消息保存规则：每次显式抓取的结果都覆盖旧消息，不保留旧消息。若插件或旧版本误回写了只包含 `取引情報`、`配送情報`、`購入日時`、`注文番号` 等交易信息、但不包含 Yahoo 聊天结构的 HTML，服务端入库时改为空消息占位；后台弹窗渲染历史脏数据时也会隐藏这类交易信息，避免把订单信息当聊天记录展示。真正的商城聊天消息即使正文里包含订单号，只要带 `sc-c46fd2ce-0` / `sc-5ecc53ec` / `dl/dd/time` 等消息结构，仍正常保留。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的商城消息空记录和异步渲染回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 消息重新抓取不再沿用旧记录

后台消息读取页点击“消息更新”后，线上 `/api/plugin/yahoo-messages/jobs` 和 `/api/plugin/idle-action/next` 均显示当前没有 pending 消息任务；结合代码确认，旧逻辑存在两个问题：一是提交抓取任务时要求 `tasks.status='success'`，但消息列表本身按订单展示，部分已有订单可能因任务状态不是 `success` 而无法排队；二是已有 `message_html` 的订单即使后续抓取失败，前端仍优先显示旧 `message_updated_at`，让用户看到旧时间并误以为没有执行。

修复：消息抓取请求现在只要求订单存在且订单未取消，不再依赖 `tasks.status='success'`。每次提交抓取任务时会清空旧 `message_html` 和 `updated_at`，确保后续只显示本次最新抓取结果；如果本次失败，消息读取页显示失败信息，不再显示旧聊天记录或旧更新时间。普通/商城消息的实际页面抓取逻辑不变，仍由插件领取 pending 任务后打开 Yahoo 交易页提取。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-09 订单结算和付款队列拆分

后台订单管理的“结算”和“支付”现在拆成两个明确步骤。点击“结算”只按当前公式写入汇率、手续费、含税成交价、应付款和 `settled_at`，不再修改 `orders.order_status`，因此不会因为批量结算就把订单自动送进插件付款队列。

点击“支付”时，只把本次勾选且已经结算、有应付款的 `pending_payment` 或既有 `pending_settlement` 订单改为 `pending_settlement`，并设置 `payment_requested=1`。`bundle_completed` 子商品和 `pending_shipment` 不会被重新提交付款；同捆子商品保持 `bundle_completed`，由插件付款 job 作为同组金额汇总的一部分计入主商品付款，避免生成重复付款任务。插件付款任务仍只读取 `pending_settlement + total_amount_cny` 的订单；因此 `pending_settlement` 现在表示“已明确提交到付款队列”。

前端边界：状态不变后，已结算的 `pending_payment`、`bundle_completed`、`pending_shipment`、`pending_settlement` 订单仍允许重新结算，方便汇率或费用输错后重算。结算成功后会同步刷新已选行缓存里的 `settled_at` 和 `payable_cny`，避免跨页自动选中的订单在马上点击“支付”时仍使用结算前缓存而误判未结算。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/Orders.display.test.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-09 商城消息抓取跳过法律链接列表

商城新版交易页消息区使用 `ul.sc-c46fd2ce-0` 包裹 `dl/dt/dd/time` 消息节点。部分页面其他位置也可能出现相同 class 的链接列表，例如“特定商取引法の表示 / ストア出店について”，旧消息抓取只取第一个 `ul.sc-c46fd2ce-0`，可能把法律链接当作聊天记录入库。

修复：插件消息抓取不再只按 class 取第一个 `ul`，而是遍历候选 `ul.sc-c46fd2ce-0` 和 `section ul`，必须同时包含 `dl` 和 `dd`，并带 `time` 或消息语义文本，才作为商城消息列表。普通商品 `#messagelist` 逻辑保持不变。后续复查确认宽泛 fallback 中保留裸 `ul` 仍可能在商城消息未命中时把法律链接保存为消息，因此 fallback 已移除裸 `ul`，只保留旧兼容的 `.acMdMsgForm` / message class/id 容器。实测附件页面 `o1235669264` 和禁发消息页面 `m1236007410` 都只有有效商城消息候选，且包含 `dl/dd/time`，不会抓到法律链接。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的商城消息抓取回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 出价超时失败前只重试一次

商品任务出价偶发超时或出价确认阶段超时失败时，插件现在不会立刻把任务回写为 `failed`。首次命中 timeout 型出价失败时，会先关闭当前出价 tab，再重新打开商品页把同一个任务重新执行一次；重试时沿用已领取任务，不重新占用出价池槽位。第二次如果仍然超时，或出现其他非可重试问题，则继续按原逻辑记录 diagnostics 并回写 `failed`。

边界：只对 timeout 型出价失败触发一次重试；价格超过上限、已结束、普通业务失败等不扩大重试范围。已有 transient server tab error 的一次重试逻辑保持不变。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的两条出价超时重试回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 确认收货/交易开始/待发货扫描改用主状态区

生产商品 `q1235534082` 的 Yahoo 商城交易页主状态仍是 `落札おめでとうございます。購入手続きを行ってください。`，但卖家消息里包含“期限后会落札者削除/取引はできません”一类说明文字，确认收货 `cancel_check` 曾从 `pending_payment` 误推进到 `cancelled`。同类全文关键词风险也存在于交易开始状态判断和待发货扫描。

修复：这三条路径的生命周期状态改为优先读取 Yahoo 固定状态区。普通商品读 `.acMdStatusCmt .elAdvnc p.fntB`，商城商品读 `main header p.sc-5968173-0`，并兼容 `#pap` 购买按钮附近的主状态段。交易开始的 `cancelled`、待发货扫描的 `cancelled/shipped/pending_shipment`、确认收货 `cancel_check` 的 `cancelled/paidOrShipped/complete` 都基于主状态区判断；物流公司、单号等详情仍按原来的结构化配送/消息区域提取。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.test.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的状态区回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 付款页状态改为结构化节点判断

生产商品 `q1235534082` 在 Yahoo 商城购买状态页仍显示 `落札おめでとうございます。購入手続きを行ってください。`，但系统订单被写成 `cancelled`。生产 debug 确认订单 `512` 从 `pending_settlement` 变为 `cancelled`，来源为 `payment_cancelled_page`；页面卖家消息中包含“期限后会落札者削除/取引はできません”一类说明文字，原付款页状态判断扫全文，容易把消息内容误当订单状态。

修复：`yahoo-plugin/background.js` 的付款页状态优先读取主状态结构，不再用整页正文判断取消/已付款/完成。商城商品从 `main header p.sc-5968173-0` 或 `#pap` 购买按钮前的主状态段落读取，例如 `落札おめでとうございます。購入手続きを行ってください。`；普通商品从 `.acMdStatusCmt .elAdvnc p.fntB` 读取，例如 `出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`。卖家消息、交易说明和帮助文案不再参与付款状态关键词判断；同时 `取引はできません` 不再作为单独全文取消关键词，必须依附真实取消状态文案。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的结构化状态回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-08 用户端生产服务不再使用 Vite dev

生产用户端偶发黑色错误 overlay，页面显示 `URI malformed`，栈指向 `C:/www/g-daipai/src/client/node_modules/vite/.../viteTransformMiddleware`。复现确认生产 `http://43.165.177.49:3035` 对外运行的是 Vite dev server，访问 `/%`、`/%E0%A4%A`、`/foo%ZZbar` 这类非法百分号编码路径会触发 Vite 内部 `decodeURI(req.url)` 抛错，并把开发错误页/overlay 暴露给用户。

修复：新增 `scripts/serve-client-dist.js`，用于生产服务 `src/client/dist` 静态构建产物；该服务先识别 malformed URL，页面导航类 GET/HEAD 请求回退到 SPA 首页，静态资源/API 这类非页面请求才返回普通 400，不再触发 Vite overlay。服务继续把 `/api` 代理到 `http://localhost:3034`，并做 SPA fallback。`start.bat` 已改为启动时先 `npm run build --prefix src/client`，再用静态服务占用原 `3035` 端口，不再执行 `npm run dev -- --host 0.0.0.0`。生产更新后需要重新运行 `start.bat`，确认 `http://43.165.177.49:3035/` 返回的 HTML 不再包含 `/@vite/client` 或 React Refresh。

验证：

```powershell
node scripts/serve-client-dist.test.js
node --check scripts/serve-client-dist.js
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-07 普通商品物流公司限定在お届け情報表格

生产商品 `v1235406927` 扫描物流时单号已正确提取为 `193398193940`，订单也推进到 `pending_receipt`，但 `shipping_company` 被写成了 `お荷物検索URL：`。这类值不是配送公司，而是 Yahoo 页面中的物流查询 URL 标签，不能写入系统和 Google Sheet。

修复：普通商品已发货扫描时，`shippingCompany` 只从 `.acMdPaymentInfo` 的 `お届け情報` 表格中读取 `配送方法`，不再从全文或页面其他区域提取配送方式，避免把 `お荷物検索URL` 等标签当作物流公司。该区域可能异步渲染；如果 `.acMdPaymentInfo` 的 `お届け情報` 尚未出现，content script 返回 `shipmentDetailsRendered=false`，background 不回写扫描结果并继续等待。商城商品的 `shippingCompany` 只从交易信息中的 `配送情報` section 读取 `配送業者`；商城单号 `trackingNumber` 仍保持原来的标签提取逻辑，不改成 section-only。服务端 `/api/plugin/scan/status` 仍保留入库前清洗，防止异常 payload 污染 `orders.shipping_company`；同时清掉异常 payload 里残留的 `配送方法` / `配送業者` 前缀，例如 `配送方法 ゆうパック` 入库为 `ゆうパック`。已有订单 `v1235406927` 的单号正确，但历史 `shipping_company` 需要重扫或手动修正才会更新。

验证：

```powershell
node yahoo-plugin/content.test.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node --check src/server/routes/plugin.js
```

### 2026-07-07 扫描单号避免出品者情报 fallback 误写

生产商品 `h1035084506` 已有 `お問い合わせ番号 646560590686`，但订单 `389` 在 `2026-07-06 17:18:19` 扫描时写入了出品者情报中的姓名作为 `tracking_number`，并推进到 `pending_receipt`。排查确认不是后台展示问题：`/api/debug/product/h1035084506` 的订单日志显示 `scan_pending_shipment_shipped` 写入了姓名形态的 trackingNumber；根因是 `content.js` 在未提取到真实单号时会返回 `trackingFallback=seller_info_name/seller_name/store_info_name`，而 `background.js` 的待发货扫描等待逻辑把任何 `type=shipped` 都当作渲染完成，导致页面异步渲染未完全出现单号区域时过早提交 fallback。

修复：待发货扫描结果新增 `shipmentDetailsRendered` 渲染完成信号。带 `trackingFallback` 且配送/消息区域尚未渲染完成的 `shipped` 结果不再视为完成，继续轮询等待真实单号；配送/消息区域已渲染完成后仍没有真实单号时，保留原逻辑允许使用出品者情报/店铺名 fallback。后续复查确认只出现 `配送方法` 不能代表单号区域完成，且 `h1035084506` 商品标题里的 `追跡番号有` 会污染全页文本判断；普通交易页 fallback 的渲染完成信号改为只看配送信息片段里的 `お届け情報`、`配送状況`、`伝票番号`、非标题语义的 `追跡番号`、`お問い合わせ番号` 或消息列表。同时 `お問い合わせ<br>番号` 这类换行标签在 text-only 路径中现在可识别。新增普通商品先读到未渲染 fallback、后读到真实单号，渲染完成后 fallback 可提交，只有配送方式不算完成，商品标题 `追跡番号有` 不算完成，以及换行 `お問い合わせ 番号` 标签提取的回归。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 本次新增扫描回归已在后续失败前执行通过；当前完整测试仍会在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 失败。

### 2026-07-07 普通落札者负担交易确认页等待

生产商品 `f1235464179` 交易开始报 `bundle confirm next page did not appear`。排查确认商品本身是普通 `normal`、运费 `落札者負担`，不是同捆；错误文案中的 `bundle` 来自普通交易和同捆流程复用的按钮点击工具，不代表业务上进入了同捆。失败点在普通交易 `buyer/preview` 最后点击 `確定する` 后，Yahoo 页面仍处于异步渲染/处理中，原来最终 `confirm` 只等待 5 秒，可能过早判定下一状态没有出现。

修复：交易按钮工具的 `confirm` 动作等待窗口从 5 秒延长到 15 秒，与 `start` 的长等待一致；其他中间动作仍保持 5 秒，避免扩大普通步骤等待。新增普通 `落札者負担` 预览页渲染延迟回归。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 本次新增普通确认页等待回归已在后续失败前执行通过；当前完整测试仍会在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 失败。

### 2026-07-06 确认收货完成文案兼容

生产商品 `t1235313146` 确认收货失败，后台提示 `receipt completion text not found`。排查确认订单仍是 `pending_receipt`，商品类型为普通 `normal`，交易 URL、物流单号和前序付款/扫描状态正常；失败点在插件点击 `受け取り連絡` 后只等待 `すべての取引が完了しました` 这一种完成文案。Yahoo 完成页还可能只展示 `出品者に受け取り連絡をしました。`、`受け取り連絡が完了しました` 等明确完成文案，原判定过窄会导致实际已完成但插件未识别。

修复：确认收货完成状态新增 `出品者に受け取り連絡をしました`、`受取連絡が完了しました`、`全ての取引が完了しました` 等明确完成文案识别；不会把待发货/待收货提示文案当完成。普通确认收货路径打开交易页后也改为先等待交易页主体或收货控件渲染完成，再检查取消/完成状态和执行勾选、点击，避免 tab `complete` 后页面内容仍在异步渲染时过早判断。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增确认收货回归，后续仍停在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase`。

### 2026-07-06 用户端前台汇率独立配置

用户端提交页人民币/日元换算汇率现在独立于后台订单结算汇率。前台汇率只用于用户端展示和人民币输入换算，最终提交给任务/插件的仍是日元；它不参与订单结算、应付款、财务费用或特殊用户结算汇率。

后台“特殊用户设置”菜单进入后以分页面展示“特殊用户设置”和“用户端汇率设置”。用户端汇率基准汇率按 `BOC 日元现钞卖出价 / 100 + 全局调节` 计算，默认全局调节保持原先 `+0.002`；可为单个用户再设置用户调节，最终用户端汇率为 `基准汇率 + 用户调节`。没有单独设置的用户使用基准汇率。服务端只缓存 BOC 原始汇率，最终汇率按当前代操作用户动态计算；前台 localStorage 汇率缓存也按 acting user 隔离。

验证：

```powershell
node src/server/routes/task.test.js
node src/admin/src/AdminLayout.display.test.js
node src/admin/src/SpecialUserSettings.display.test.js
node src/admin/src/ClientRateSettings.display.test.js
node --check src/server/services/websiteRate.js
node --check src/server/routes/task.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-05 确认收货 cancel_check 等待状态文案渲染

确认收货流程中，`pending_payment` / `pending_settlement` 订单会作为 `cancel_check` 打开 Yahoo 交易页，同时检查取消状态和已付款/已发货状态。Yahoo 新版交易页可能在 tab `complete` 后才异步渲染强状态文案，原逻辑只读一次正文，可能先读到普通占位/非状态文案后直接跳过，导致后面出现的正确状态不再判断。

修复：`cancel_check` 打开交易页后，最多等待 8 秒、每 500ms 重新读取页面正文；等待目标不是某几段状态文案本身，而是交易页业务区域已渲染，例如 `取引ナビ` 的 `購入 / お支払い / 発送連絡` 步骤和 `取引情報` 等主体内容已经出现。页面渲染完成后再判断取消文案或以下任一已付款/已发货文案：`ご購入ありがとうございます。` + `商品の発送連絡をお待ちください。`、`出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`、`商品が発送されました。` + `到着までお待ちください。`、`出品者から商品発送の連絡がありました。` + `到着したら、受け取り連絡をしてください。`。命中已付款/已发货时仍只把 `pending_payment` / `pending_settlement` 推进到 `pending_shipment`；其他已渲染状态不更新状态，直接跳过本次 `cancel_check`。

验证：

```powershell
node src/server/routes/plugin.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 本次确认收货新增回归已在后续失败前执行通过；当前完整测试会停在既有/其他路径 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase`。

### 2026-07-05 商城即决确认事项复用付款流程

商城即决商品在 `buy.auctions.yahoo.co.jp/order/review` 页面出现 `ストアからの確認事項` 时，原即决出价流程没有处理确认事项，可能停在 review/change/store-options 页面直到任务响应超时。现在仅当任务同时满足 `bid_mode=buyout` 且 `product_type=store` 时，`content.js` 才会在即决路径识别 `#cartopt` 的 `ストアからの確認事項` + `変更` 并返回 `buyout-store-confirmation-required`；`background.js` 再次校验商城即决边界后，复用付款流程已有的 `completeStoreConfirmationItems()`，点击 `変更`、等待编辑页、JS 勾选所有确认框、点击 `変更する` 回到 review 页后，再继续原来的即决确认/购买完成判断。普通出价、普通即决和订单付款工作流不进入该新增分支。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 新增回归 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 已在既有失败前执行通过；当前完整测试仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败。

### 2026-07-04 订单管理备注与 Google 表格备注列

后台订单管理新增订单备注：双击商品名称可打开备注弹窗，保存后只更新系统数据库 `orders.order_remark`，不会立即同步 Google 表格。有备注的订单在商品 ID 的 `普/商` 标识后显示 `备`，备注内容不作为订单表格列展示。

Google 表格同步在原有“追加待收货订单”和“重扫/更新物流单号”流程中顺带写入备注。表格在 `J 单号` 后使用 `K 备注`；如果检测到现有 K 列已有人工 tag 数据，会先在 K 位置插入新列，把原 K 列右移到 L，再写入 `备注` 表头，避免覆盖现有 tag。备注保存本身不触发 Google 写入。

验证：

```powershell
node src/server/services/googleSheets.test.js
node src/server/routes/admin.orders.test.js
node src/server/routes/plugin.test.js
node src/admin/src/Orders.display.test.js
node --check src/server/routes/admin.js
node --check src/server/routes/plugin.js
node --check src/server/services/googleSheets.js
node --check src/server/models/index.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-03 入札页全分页同步

入札中监控原先只抓取 `/my/bidding` 第一页。Yahoo 入札页分页使用 `次へ` 链接，例如 `/my/bidding?page=2`，当入札中商品超过第一页时，后续页商品不会进入 `/api/plugin/bidding/sync`，并可能因服务端先将旧 `bidding_items` 标记为 `stale` 而显示为过期。

修复：`content.js` 新增入札页下一页链接识别，支持 Yahoo pagination 的 `data-cl-params="_cl_vmodule:pagination;_cl_link:next;..."`、`rel=next` 和 `次へ/next` 文案；`background.js` 的入札监控在同一 tab 内最多翻 50 页，按商品 ID 去重汇总后一次性同步给服务端，避免分页同步时误 stale。

验证：

```powershell
node yahoo-plugin/content.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node scripts/encoding-guard.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次新增入札翻页回归 `testMonitorSyncCollectsAllBiddingPagesBeforeSync` 在该既有失败前已执行通过。

### 2026-07-02 确认收货流程同步手动付款状态

部分普通/商城订单在 Yahoo 后台手动支付后，系统订单仍停留在 `pending_payment` 或 `pending_settlement`。确认收货流程的 `cancel_check` 现在除检查取消页外，还会识别交易页前两行强状态文案：`ご購入ありがとうございます。` + `商品の発送連絡をお待ちください。`、`出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`、`商品が発送されました。` + `到着までお待ちください。`、`出品者から商品発送の連絡がありました。` + `到着したら、受け取り連絡をしてください。`。

修复：`pending_payment` / `pending_settlement` 的 `cancel_check` 命中上述已付款或已发货文案时，服务端只允许把订单推进到 `pending_shipment`，后续仍交给扫描流程推进到 `pending_receipt`。取消文案优先级仍高于已付款/已发货判断。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node --check src/server/routes/plugin.js
node --check src/server/routes/plugin.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次新增确认收货回归在该既有失败前已执行通过。

### 2026-07-02 ストア但税 0 商品落札同步

生产商品 `1234843296` 的落札页带 `ストア` 标识，但商品页/前台税判断表现为普通税 0 商品。系统原先按 `product_type=normal` 进入普通付款流程，打开 `buy.auctions.yahoo.co.jp/order/status?...` 后找不到普通付款入口按钮，报 `payment entry button not found`。

修复：`/my/won` 落札页同步现在识别行内 `ストア` 标识并透传 `productType=store`；服务端 `/api/plugin/orders/sync` 只把 `products.product_type` 补正为 `store`，不改 `tax_type`。手动“落札商品更新”批处理保留落札页 `store` 类型，但商品页快照缺少税类型时默认 `tax_zero`，避免把税 0 ストア误补成 `tax_included`。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check src/server/routes/plugin.js
node yahoo-plugin/content.test.js
node src/server/routes/plugin.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次已通过语法检查，未把该既有失败作为本次变更阻塞。

### 2026-07-01 即决购买完成页消息断开兜底

生产商品 `x1235487667` 已进入 Yahoo `buy.auctions.yahoo.co.jp/order/thank-you?auctionId=...`，页面显示 `購入が完了しました`，但插件在 `execute-bid` 阶段收到 Chrome `back/forward cache` / message channel closed 错误，误把任务标为 `failed`。由于 `/api/plugin/orders/sync` 只匹配 `bidding/success` 任务，后续 `/my/won` 同步也跳过该商品，订单管理没有生成订单。

修复：即决 `buyout` 任务在 `EXECUTE_BID` 消息通道断开时，会先读取当前 tab；如果 URL 或正文已经是 Yahoo 购买完成页，则按 `buyout-final-pending-waiting-for-won-sync` 处理，任务保持 `bidding` 等待落札同步，不再写 `failed`。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
```

注意：当前完整 `node yahoo-plugin/background.test.js` 会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 停住；本次新增回归已前置执行并通过，日志会显示任务 `907` 保持 `bidding`。

### 2026-06-24 付款配送変更优先 JS click

普通商品多配送方式付款页的 `変更する` 现在优先用页面内 JS click，只有 JS 找不到/点不到时才 fallback 到 `chrome.debugger` 鼠标事件，避免正常多运费展开先走真实输入。

验证：

```powershell
node yahoo-plugin/background.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node scripts/encoding-guard.js
```

### 2026-06-24 用户侧只读购买页面

用户 `落札商品` 完成状态显示 `购买页面`，跳转到本地只读 Yahoo 风格 `取引ナビ` 页面。该页面只使用路由 state，不额外请求 API，不影响普通 `落札商品` 页面加载速度。

验证：

```powershell
node src/server/routes/task.test.js
node src/client/src/pages/WonItems.display.test.mjs
node src/client/src/pages/PurchasePage.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
```

### 2026-06-23 出价 tab complete race 与失败诊断

修复 `chrome.tabs.create()` 已返回 `status: complete` 时仍等待未来 `onUpdated` 事件导致任务超时的问题。出价失败现在记录阶段、URL、标题、正文片段等 diagnostics，后台 Reports 可查询出价失败聚合。

验证：

```powershell
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node scripts/encoding-guard.js
```

### 2026-06-23 手动导入和付款/商城确认稳定性

- `manual_import` 用户侧显示为 `导入`。
- 手动导入独立为 `manual_order_import` idle action，不再伪装成 scan。
- 商城付款确认事项和普通付款配送 `変更する` 逻辑多次修正，当前原则是能 JS click 的优先 JS click，必要时才走真实输入 fallback；部分商城确认编辑页明确要求 JS click-only。

### 2026-06-22 三表模型删字段准备

fresh schema 已不再创建旧 `tasks` 商品快照字段，脚本也已改为检查 `products` 健康和关系完整性。但生产旧库还没有直接删字段，后续必须按“当前主计划”完成 payload 边界硬化和迁移验证。

验证：

```powershell
node scripts/check-product-parity.test.js
node scripts/check-product-health.test.js
node scripts/check-product-read-paths.test.js
node scripts/check-product-read-paths.js
node scripts/check-product-parity.js
node scripts/check-product-health.js
npm run regression
```

---

## 常用验证命令

插件：

```powershell
node yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/encoding.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
```

服务端：

```powershell
node src/server/routes/task.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node src/server/routes/debug.test.js
node --check src/server/routes/task.js
node --check src/server/routes/plugin.js
node --check src/server/routes/admin.js
```

三表模型：

```powershell
node scripts/check-product-read-paths.js
node scripts/check-product-health.js
node scripts/check-product-parity.js
```

前端/后台：

```powershell
npm run build --prefix src/client
npm run build --prefix src/admin
```

全局：

```powershell
node scripts/encoding-guard.js
npm run regression
git diff --check
```

---

## 暂缓事项

- Android App 方案仅作为后续方向：WebView 加载现有客户端，Android 原生 Bridge 用用户手机网络抓 Yahoo 商品页，再回传给 Web。当前不列为主线。
- 维护性重构计划可后续推进，但不要插在三表删字段前制造额外读路径变化。
