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
  max_price INTEGER NOT NULL,
  user_max_price INTEGER,
  multi_bid_increment INTEGER,
  strategy VARCHAR(32) DEFAULT 'direct',
  bid_mode VARCHAR(32) DEFAULT 'bid',
  start_minutes_before INTEGER,
  start_seconds_before INTEGER,
  status VARCHAR(32) DEFAULT 'pending',
  is_highest_bidder INTEGER DEFAULT 0,
  last_bid_at DATETIME,
  pending_followup_max_price INTEGER,
  force_orders_resync INTEGER DEFAULT 0,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  product_id VARCHAR(32) PRIMARY KEY,
  product_url TEXT,
  product_title VARCHAR(512),
  product_image_url TEXT,
  current_price INTEGER,
  buyout_price INTEGER,
  bid_count INTEGER DEFAULT 0,
  tax_type VARCHAR(32) DEFAULT 'tax_zero',
  product_type VARCHAR(32) DEFAULT 'normal',
  shipping_fee_text VARCHAR(64),
  end_time DATETIME,
  last_fetched_at DATETIME,
  last_scanned_at DATETIME,
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
  product_id VARCHAR(32),
  account_id INTEGER REFERENCES yahoo_accounts(id),
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
  shipping_company VARCHAR(128),
  tracking_number VARCHAR(128),
  tracking_rescan_requested INTEGER DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS plugin_diagnostics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type VARCHAR(64),
  level VARCHAR(16) DEFAULT 'info',
  product_id VARCHAR(32),
  order_id INTEGER,
  action VARCHAR(64),
  method VARCHAR(64),
  message TEXT,
  diagnostics TEXT,
  url TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plugin_diagnostics_product_created
ON plugin_diagnostics(product_id, created_at);

CREATE INDEX IF NOT EXISTS idx_plugin_diagnostics_created
ON plugin_diagnostics(created_at);

CREATE TABLE IF NOT EXISTS yahoo_trade_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL UNIQUE,
  product_id VARCHAR(32),
  message_html TEXT,
  fetch_status VARCHAR(32) DEFAULT 'idle',
  fetch_requested_at DATETIME,
  fetch_started_at DATETIME,
  fetch_error TEXT,
  send_status VARCHAR(32) DEFAULT 'idle',
  send_text TEXT,
  send_requested_at DATETIME,
  send_started_at DATETIME,
  send_error TEXT,
  last_message_sent_at DATETIME,
  updated_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_yahoo_trade_messages_status
ON yahoo_trade_messages(fetch_status, send_status, updated_at);

CREATE INDEX IF NOT EXISTS idx_yahoo_trade_messages_product
ON yahoo_trade_messages(product_id, updated_at);

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
CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_id VARCHAR(64) NOT NULL UNIQUE,
  username VARCHAR(64),
  role VARCHAR(32) DEFAULT 'user',
  user_level INTEGER DEFAULT 1,
  login_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  user_agent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires
ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
ON user_sessions(user_id, expires_at);

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
CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_user_product_created ON tasks(user_id, product_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_task_id ON orders(task_id);
CREATE INDEX IF NOT EXISTS idx_products_end_time ON products(end_time);

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

CREATE TABLE IF NOT EXISTS manual_order_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  start_date VARCHAR(10) NOT NULL,
  end_date VARCHAR(10) NOT NULL,
  max_pages INTEGER DEFAULT 10,
  status VARCHAR(32) DEFAULT 'requested',
  error_msg TEXT,
  scanned_pages INTEGER DEFAULT 0,
  scanned_count INTEGER DEFAULT 0,
  candidate_count INTEGER DEFAULT 0,
  skipped_existing_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  scanned_at DATETIME,
  confirmed_at DATETIME
);

CREATE TABLE IF NOT EXISTS manual_order_import_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL,
  product_id VARCHAR(32) NOT NULL,
  product_url TEXT,
  product_title VARCHAR(512),
  product_image_url TEXT,
  final_price INTEGER,
  won_at DATETIME,
  won_time_text VARCHAR(64),
  transaction_url TEXT,
  shipping_fee_text VARCHAR(64),
  tax_type VARCHAR(32) DEFAULT 'tax_zero',
  product_type VARCHAR(32) DEFAULT 'normal',
  assigned_user_id INTEGER,
  status VARCHAR(32) DEFAULT 'pending_user',
  task_id INTEGER,
  order_id INTEGER,
  error_msg TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (batch_id) REFERENCES manual_order_import_batches(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_user_id) REFERENCES users(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_order_import_items_batch_product
ON manual_order_import_items(batch_id, product_id);
