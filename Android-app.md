# Android App 初步方案

## 目标

在 Android 手机端实现“用户本机网络访问 Yahoo 并抓取商品信息”，同时尽量复用现有 React 客户端和服务器 API。

核心方式：

- Android App 使用 WebView 承载现有客户端页面。
- 商品信息抓取不走服务器代理，优先走 Android 原生 Bridge。
- Android 原生层用用户手机当前网络/VPN 访问 Yahoo 商品页。
- 原生层解析商品信息后返回给 WebView。
- WebView 继续使用现有客户端提交任务、任务列表、登录等 API。

## 推荐架构

```
Android App
  ├─ WebView
  │   └─ 加载现有 React 客户端
  │       ├─ 登录
  │       ├─ 提交任务
  │       ├─ 任务列表
  │       └─ 调用 window.AndroidYahoo.fetchProduct(url)
  │
  └─ Native Bridge
      ├─ OkHttp 请求 Yahoo 商品页
      ├─ Jsoup 解析 HTML / script pageData
      └─ JSON 返回商品信息

API Server
  ├─ /api/auth/login
  ├─ /api/task/submit
  ├─ /api/task/list
  └─ 现有其他接口
```

## 服务器端影响

初步判断服务器端不需要改动。

Android 原生层返回的数据结构应和现有 `/api/proxy/fetch` 的 `data` 字段保持一致：

```json
{
  "auctionId": "h1229655639",
  "standardUrl": "https://auctions.yahoo.co.jp/jp/auction/h1229655639",
  "title": "商品标题",
  "currentPrice": 1000,
  "buyoutPrice": 0,
  "taxType": "tax_included",
  "endTime": "2026-05-15T23:16:09+09:00",
  "imageUrl": "https://..."
}
```

字段含义保持当前系统约定：

- `currentPrice`：Yahoo 页面红字当前价，商城商品也是税前价。
- `buyoutPrice`：Yahoo 页面即決红字价，商城商品也是税前价。
- `taxType`：
  - `tax_included`：商城商品，页面价格区域有 `（税込）`
  - `tax_zero`：个人商品，页面价格区域有 `（税0円）`
- `endTime`：商品结束时间。

客户端显示含税价、提交时换算税前最高价的逻辑继续由现有 Web 客户端和服务器端处理。

## Web 客户端后续改动点

在客户端 `getProductInfo(url)` 增加一个优先级：

1. 如果存在 Android Bridge，则调用原生抓取：

```js
window.AndroidYahoo.fetchProduct(url)
```

2. 原生抓取失败时，回退到现有服务器接口：

```js
GET /api/proxy/fetch?url=...
```

3. 非 Android App 环境继续保持当前逻辑。

建议约定 Bridge 返回 Promise 风格的封装，Web 侧可以用统一函数适配：

```js
async function fetchProductFromAndroid(url) {
  if (!window.AndroidYahoo?.fetchProduct) return null;
  const raw = await window.AndroidYahoo.fetchProduct(url);
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}
```

如果 Android `@JavascriptInterface` 不能直接返回 Promise，则使用 callback id：

```js
window.AndroidYahoo.fetchProduct(requestId, url);
window.__onAndroidYahooProduct(requestId, resultJson);
```

## Android 原生模块

建议技术：

- Kotlin
- Android WebView
- OkHttp
- Jsoup

原生抓取流程：

1. 标准化商品 URL，提取 auction id。
2. 使用 OkHttp 请求标准 URL：

```text
https://auctions.yahoo.co.jp/jp/auction/{auctionId}
```

3. 设置移动或桌面浏览器 User-Agent。
4. 解析 HTML：
   - 优先解析 `var pageData = {...};`
   - `pageData.items.price` -> `currentPrice`
   - `pageData.items.winPrice` -> `buyoutPrice`
   - `og:title` / `h1` / `title` -> `title`
   - `og:image` / `twitter:image` -> `imageUrl`
   - `itemprop=endDate` / `priceValidUntil` / 页面脚本 -> `endTime`
   - 页面价格区域文本包含 `（税込）` -> `taxType=tax_included`
   - 页面价格区域文本包含 `（税0円）` -> `taxType=tax_zero`
5. 返回 JSON 给 WebView。

## WebView 设置

需要开启：

```kotlin
webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true
```

建议限制：

- 只允许加载自家客户端域名。
- JS Bridge 只注入到自家域名页面。
- 不向任意第三方页面暴露 Bridge。

## 安全注意

- `@JavascriptInterface` 有安全风险，必须限制 WebView 加载来源。
- Bridge 方法只接受 URL 字符串，返回商品 JSON，不暴露本地文件、系统信息、账号信息。
- Yahoo 请求只做读取，不做登录、不出价、不点击。
- 超时建议 10-15 秒。
- 抓取失败要返回明确错误，Web 侧回退服务器接口。

## 与现有系统的关系

Android App 只替代“商品信息抓取”这一步。

不替代：

- 用户登录
- 任务提交
- 任务列表
- 出价执行
- 后台管理
- 服务器插件轮询

这些继续使用现有服务器和插件逻辑。

## 后续实施步骤

1. 客户端最终稳定后，抽象 `getProductInfo(url)`：
   - Android Bridge 优先
   - 服务器抓取兜底
2. 新建 Android 工程。
3. WebView 加载现有客户端地址。
4. 实现 `AndroidYahooBridge.fetchProduct`。
5. 复用服务端 `proxy.js` 的解析规则，在 Kotlin/Jsoup 中实现同等字段提取。
6. 用 3 类商品测试：
   - 个人普通商品
   - 商城普通商品
   - 有即決价格商品
7. 对比 Android 抓取结果和服务器抓取结果，确认字段一致。

## 暂不做

- 不在 App 内实现竞拍。
- 不在 App 内保存 Yahoo 登录态。
- 不做隐藏 WebView 自动点击。
- 不替换服务器端任务执行逻辑。
