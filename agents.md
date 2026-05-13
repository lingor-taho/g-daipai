# g-daipai 项目状态

**最后更新**: 2026-05-12

---

## 项目概述

Yahoo 日本拍卖代拍系统：中国用户通过 Web 提交商品 URL 和出价策略，Windows 服务器端 Chrome 插件自动完成竞拍。

---

## v2 架构

```
用户浏览器 (React SPA, http://localhost:3001)
    │
    │ HTTP
    ▼
API Server (localhost:3000, Express + SQLite)
    │
    │ HTTP 轮询
    ▼
Chrome Extension (yahoo-plugin/, Windows 服务器)
    │  ← manifest.json + background.js + content.js
    │
    ▼
Yahoo Auction 网站
```

---

## 当前文件结构

```
D:/www/g-daipai/
├── yahoo-plugin/
│   ├── manifest.json      — Manifest V3
│   ├── background.js      — 轮询任务 + 消息中转 + GET_PRODUCT 处理器
│   └── content.js        — 商品数据提取 + BID_RESULT 回传
├── src/
│   ├── client/            — React SPA (Ant Design Mobile)
│   │   ├── vite.config.js     — port 3001, proxy /api → localhost:3000
│   │   └── src/
│   │       ├── utils/api.js   — getProductInfo (浏览器直连 Yahoo)
│   │       ├── pages/{Login,Submit,TaskList}.jsx
│   │       └── components/ProductCard.jsx
│   ├── server/
│   │   ├── index.js
│   │   ├── models/index.js    — better-sqlite3 同步封装
│   │   └── routes/
│   │       ├── auth.js        — async/await 修复
│   │       ├── task.js        — async/await 修复, 支持 product_title/image_url/price
│   │       ├── plugin.js      — async 修复, /api/plugin/task + /config
│   │       ├── proxy.js       — 缓存优先 + /api/proxy/cache (POST)
│   │       └── admin.js       — async/await 修复
│   └── config/index.js
├── data/gdaipai.db
└── agents.md
```

---

## 数据库 Schema

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(256) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  product_id VARCHAR(32) NOT NULL,
  product_url TEXT NOT NULL,
  product_title VARCHAR(512),      -- NEW: 商品标题
  product_image_url TEXT,          -- NEW: 商品图片
  current_price INTEGER,             -- NEW: 当前价格
  max_price INTEGER NOT NULL,
  strategy VARCHAR(32) DEFAULT 'direct',
  start_minutes_before INTEGER,
  start_seconds_before INTEGER,
  status VARCHAR(32) DEFAULT 'pending',  -- pending/bidding/success/failed
  is_highest_bidder INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  last_bid_at DATETIME,
  error_msg TEXT,
  end_time DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 当前运行状态

| 服务 | 地址 | 状态 |
|------|------|------|
| API Server | http://localhost:3000 | ✅ 运行中 |
| React Client | http://localhost:3001 | ✅ 运行中 |

---

## 已修复的问题

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-05-12 | `plugin.js` route 使用 `await` 但函数未声明 `async` | 添加 `async` 关键字 |
| 2026-05-12 | 所有 routes 中 `db.getOne/getAll` 缺少 `await` | 全部补齐 async/await |
| 2026-05-12 | 服务端无法抓取 Yahoo（被反爬） | 重构为客户端浏览器直连 + 插件缓存双轨 |
| 2026-05-12 | `submitTask` 不传 product_title/image_url/price | 增加字段提交时附带 |
| 2026-05-12 | `截旗前` 文字不准确 | 改为 `结束前` |

---

## 商品信息获取流程（当前）

```
用户粘贴 URL → getProductInfo()
  │
  ├─ 1. 插件缓存 (chrome.storage.session) ← 用户已访问过商品页
  │
  ├─ 2. Yahoo oEmbed API ← 浏览器直连，可能缺价格
  │
  └─ 3. Yahoo 拍卖页直爬 ← 浏览器直连，获取完整 title/price/image/endTime
```

---

## 待验证 / 待做

| 优先级 | 事项 | 说明 |
|--------|------|------|
| 🔴 紧急 | 客户端 getProductInfo 是否能从浏览器拿到真实数据 | 需用户本地测试 |
| 🔴 紧急 | 插件 content script 在 Yahoo 页面是否正确提取数据 | 需重载插件后测试 |
| 🟡 中期 | 插件 BID 入札流程完整验证 | 需真实 Yahoo 账号登录状态 |
| 🟡 中期 | 策略执行（direct / 1min / 2min / 5min / 10min） | background.js 逻辑未实现 |
| 🟢 低 | 订单管理页面 | UI 未完成 |
| 🟢 低 | Yahoo 账号管理 | UI 未完成 |

---

## 关键路径

- **插件目录**: `D:/www/g-daipai/yahoo-plugin/`
- **客户端目录**: `D:/www/g-daipai/src/client/`
- **API 服务**: `D:/www/g-daipai/src/server/index.js` (port 3000)
- **数据库**: `D:/www/g-daipai/data/gdaipai.db` (SQLite)
- **Spec**: `docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-v2-design.md`

---

## 清理记录

- ✅ `src/server/routes/product.js` — 已删除（旧 Playwright 代理接口）
- ✅ `docs/superpowers/plans/2026-05-11-yahoo-auction-proxy-plan.md` — 已删除
- ✅ `docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-design.md` — 已删除
- ✅ `src/worker/` — 整个目录已删除
