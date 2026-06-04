-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(256) NOT NULL,
  role VARCHAR(32) DEFAULT 'user',
  user_level INTEGER DEFAULT 1,
  parent_user_id INTEGER REFERENCES users(id),
  bid_strategy_scope VARCHAR(32) DEFAULT 'all',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Yahoo 账号池
CREATE TABLE IF NOT EXISTS yahoo_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_name VARCHAR(128) NOT NULL,
  email VARCHAR(256) NOT NULL,
  profile_dir VARCHAR(512),
  status VARCHAR(32) DEFAULT 'idle',
  error_msg TEXT,
  last_used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 竞拍任务
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  product_id VARCHAR(32) NOT NULL,
  product_url TEXT NOT NULL,
  product_title VARCHAR(512),
  product_image_url TEXT,
  current_price INTEGER,
  buyout_price INTEGER,
  tax_type VARCHAR(32) DEFAULT 'tax_zero',
  product_type VARCHAR(32) DEFAULT 'normal',
  end_time DATETIME,
  max_price INTEGER NOT NULL,
  user_max_price INTEGER,
  multi_bid_increment INTEGER,
  strategy VARCHAR(32) DEFAULT 'direct',
  bid_mode VARCHAR(32) DEFAULT 'bid',
  start_minutes_before INTEGER,
  start_seconds_before INTEGER,
  status VARCHAR(32) DEFAULT 'pending',
  is_highest_bidder INTEGER DEFAULT 0,
  bid_count INTEGER DEFAULT 0,
  last_bid_at DATETIME,
  pending_followup_max_price INTEGER,
  force_orders_resync INTEGER DEFAULT 0,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 出价日志
CREATE TABLE IF NOT EXISTS bid_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  account_id INTEGER REFERENCES yahoo_accounts(id),
  bid_price INTEGER,
  result VARCHAR(32),
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 落札订单
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER REFERENCES tasks(id),
  account_id INTEGER REFERENCES yahoo_accounts(id),
  product_title VARCHAR(512),
  product_url TEXT,
  final_price INTEGER,
  won_at DATETIME,
  won_time_text VARCHAR(64),
  jpy_to_cny_rate DECIMAL(10,4),
  handling_fee DECIMAL(10,2),
  bank_fee_jpy INTEGER,
  handling_fee_cny DECIMAL(10,2),
  large_amount_fee_cny DECIMAL(10,2),
  large_amount_fee_applied INTEGER,
  tax_included_final_price INTEGER,
  has_user_finance_override INTEGER,
  total_amount_cny DECIMAL(10,2),
  order_status VARCHAR(32),
  bundle_shipping_fee_text VARCHAR(64),
  transaction_url TEXT,
  bundle_group_id VARCHAR(64),
  transaction_started_at DATETIME,
  transaction_start_error TEXT,
  tracking_number VARCHAR(128),
  shipped_at DATETIME,
  settled_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bidding_items (
  product_id VARCHAR(32) PRIMARY KEY,
  product_url TEXT,
  product_title VARCHAR(512),
  product_image_url TEXT,
  current_price INTEGER,
  status VARCHAR(32) NOT NULL,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS data_cleanup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type VARCHAR(32) NOT NULL,
  local_date VARCHAR(10),
  retention_days INTEGER NOT NULL,
  cutoff_at DATETIME,
  task_count INTEGER DEFAULT 0,
  bid_log_count INTEGER DEFAULT 0,
  order_count INTEGER DEFAULT 0,
  bidding_item_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_finance_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  rate_adjustment DECIMAL(10,4),
  bank_fee_jpy INTEGER,
  handling_fee_cny DECIMAL(10,2),
  large_amount_fee_cny DECIMAL(10,2),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 汇率配置
CREATE TABLE IF NOT EXISTS exchange_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rate DECIMAL(10,4) NOT NULL,
  handling_fee_percent DECIMAL(5,2) DEFAULT 3.0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 全局配置
CREATE TABLE IF NOT EXISTS config (
  key VARCHAR(64) PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_end_time ON tasks(end_time);
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);

CREATE TABLE IF NOT EXISTS order_status_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id VARCHAR(32),
  old_status VARCHAR(32),
  new_status VARCHAR(32),
  source VARCHAR(64) NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_status_change_logs_order
ON order_status_change_logs(order_id, created_at);
