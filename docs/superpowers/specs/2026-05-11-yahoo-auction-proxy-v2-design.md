# Yahoo 日本拍卖代拍系统 - 设计规格书 v2

**日期**: 2026-05-11
**版本**: v2.0
**状态**: 待用户 review

---

## 一、项目概述

**项目名称**: g-daipai (代拍)
**核心功能**: 中国用户通过 Web 提交日本 Yahoo Auction 商品的竞拍需求，服务器端 Chrome 插件自动完成实际拍卖操作。

**目标用户**: 中国消费者，需人工分发账号登录使用

---

## 二、系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    用户端 (浏览器 / iOS / Android)           │
│           React SPA — 登录 → 提交任务 → 查看状态            │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                 API Server (localhost:3000)                  │
│              Express + SQLite — 任务队列 + 状态               │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTP 轮询
                               ▼
┌──────────────────────────────────────────────────────────────┐
│            Windows 服务器 (Chrome + 插件)                    │
│     D:/www/g-daipai/yahoo-plugin/                         │
│     • 每 N 秒轮询 API 任务队列                             │
│     • 有任务 → 执行出价 → 标记"已执行"                     │
│     • 无任务 → 检查 Yahoo 订单页 → 更新"成功/失败"          │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、客户端功能

### 3.1 登录
- 用户输入管理员分配的账号密码登录
- 无注册入口，账号由管理员生成

### 3.2 连接探测
- 打开页面时，JS 探测能否访问 `https://auctions.yahoo.co.jp`
- 可达 → 客户端直接获取商品信息
- 不可达 → 调用 API `/api/proxy/fetch` 由服务器获取

### 3.3 任务提交
- 输入商品 URL（任意格式，自动提取商品 ID）
- 显示商品信息：图片、标题、当前价格、到期时间
- 选择策略：
  - **时间策略**：默认"即时"（立即执行），可选"商品结束前 X 分钟"
  - **最高价**：用户心理最高出价（日元）
- 提交后任务进入队列

### 3.4 任务列表
- 显示序号、商品图、商品标题、商品状态
- 状态说明：
  - **队列中** — 等待执行
  - **已执行** — 服务器已出价，等商品结束
  - **成功** — 商品结束，拍到了
  - **失败** — 商品结束，未拍到
- 支持同一商品重复提交（生成独立任务）
- 任务按提交顺序执行
- 提交后**不支持修改和删除**

---

## 四、服务器端功能

### 4.1 API Server

**数据库**: SQLite (`data/gdaipai.db`)

**用户表**:
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(256) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**任务表**:
```sql
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  product_id VARCHAR(32) NOT NULL,
  product_url TEXT NOT NULL,
  product_title VARCHAR(512),
  product_image_url TEXT,
  current_price INTEGER,
  end_time DATETIME,
  max_price INTEGER NOT NULL,
  strategy VARCHAR(32) DEFAULT 'direct',
  start_minutes_before INTEGER,
  start_seconds_before INTEGER,
  status VARCHAR(32) DEFAULT 'pending',
  is_highest_bidder INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  last_bid_at DATETIME,
  error_msg TEXT,
  final_price INTEGER,
  order_status VARCHAR(32),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**API 接口**:

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/auth/login` | POST | 登录，返回 token |
| `/api/proxy/fetch` | GET | 服务器获取商品信息（用户不可达 Yahoo 时） |
| `/api/task/submit` | POST | 提交任务（需登录） |
| `/api/task/list` | GET | 用户任务列表（需登录） |
| `/api/task/:id` | GET | 任务详情（需登录） |
| `/api/admin/accounts` | GET/POST/DELETE | 账号管理（管理员） |
| `/api/admin/tasks` | GET | 全部任务看板（管理员） |
| `/api/admin/orders` | GET | 订单列表（管理员） |
| `/api/admin/orders/stats` | GET | 财务统计（管理员） |
| `/api/admin/logs` | GET | 操作日志（管理员） |
| `/api/admin/config` | GET/PATCH | 全局参数（如轮询间隔） |

### 4.2 Chrome 插件

**目录**: `D:/www/g-daipai/yahoo-plugin/`

**manifest.json**:
```json
{
  "manifest_version": 3,
  "name": "Yahoo Auto Bid Agent",
  "version": "1.0.0",
  "permissions": ["storage", "tabs", "scripting"],
  "host_permissions": [
    "http://localhost:3000/*",
    "https://*.yahoo.co.jp/*",
    "https://*.auctions.yahoo.co.jp/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_title": "Yahoo Auto Bid"
  }
}
```

**插件逻辑**（background.js）:
```
循环执行：
  ① 从 API 读取状态为"队列中"的最早任务
     → 有任务：
        • 打开商品页面
        • 执行出价（以 max_price）
        • 标记任务为"已执行"
        • 继续 ①
     → 无任务：
  ② 查询 Yahoo 订单页（落札履歴）
     • 对比上次查询记录，获取新拍下的商品
     • 匹配用户任务，更新状态为"成功"，记录落札金额
     • 对所有"已执行"任务检查是否在订单中
       - 不在 → 更新状态为"失败"
     • 记录本次查询的最新订单位置
     • 继续 ①
  ③ 等待 N 秒后继续 ①（N 为可配置参数，默认 10s）
```

**出价执行**（executeBid）:
- 打开商品 URL → 点击「入札する」→ 填入 max_price → 点「確認する」→ 点「同意の上出札する」

**登录检测**:
- 执行出价前检测页面是否需要登录
- 如需登录 → 写入任务 error_msg → 管理员在后台看到告警

### 4.3 管理员后台
- 账号管理：生成用户名/密码、分发账号
- 任务看板：所有用户任务状态、成功率
- 订单管理：落札订单、金额、汇率换算、手续费
- 操作日志：出价记录、异常记录
- 全局参数：插件轮询间隔配置

---

## 五、技术选型

| 组件 | 技术 |
|------|------|
| 用户端 | React SPA + Ant Design Mobile（响应式） |
| API Server | Node.js (Express) + SQLite |
| Chrome 插件 | Manifest V3 + Chrome Extension API |
| 插件目录 | `D:/www/g-daipai/yahoo-plugin/` |
| 数据库 | SQLite (`data/gdaipai.db`) |
| 用户端框架 | React（方案 B，打包部署） |

---

## 六、开发优先级

**Phase 1（当前）**:
1. API Server 重构（加用户 auth + 新任务表）
2. 用户端 React SPA
3. Chrome 插件开发
4. 管理员后台

**Phase 2**:
- 客户端倒计时显示
- 执行中状态细分（被超越/价格超标等）
