CREATE TABLE IF NOT EXISTS batch_task_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  login_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_request_id VARCHAR(128) NOT NULL,
  input_text TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  dismissed_at DATETIME,
  UNIQUE(user_id, client_request_id)
);
CREATE TABLE IF NOT EXISTS batch_task_submission_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES batch_task_submissions(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  input_text TEXT NOT NULL,
  product_id VARCHAR(32),
  product_url TEXT,
  max_price INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  error_msg TEXT,
  result_status VARCHAR(32),
  result_error TEXT,
  UNIQUE(batch_id, line_number)
);
CREATE INDEX IF NOT EXISTS idx_batch_task_queue_pending ON batch_task_submission_items(status, batch_id, line_number);
CREATE INDEX IF NOT EXISTS idx_batch_task_queue_results ON batch_task_submissions(user_id, status, dismissed_at, id);
