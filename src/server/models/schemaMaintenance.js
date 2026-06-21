const TASKS_SCHEMA_WITH_NULLABLE_PRODUCT_URL = `
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id),
    product_id VARCHAR(32) NOT NULL,
    product_url TEXT,
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    buyout_price INTEGER,
    bid_mode VARCHAR(32) DEFAULT 'bid',
    tax_type VARCHAR(32) DEFAULT 'tax_zero',
    user_max_price INTEGER,
    multi_bid_increment INTEGER,
    client_request_id VARCHAR(128),
    shipping_fee_text VARCHAR(64),
    pending_followup_max_price INTEGER,
    force_orders_resync INTEGER DEFAULT 0,
    product_type VARCHAR(32) DEFAULT 'normal',
    buyout_auto_paid INTEGER DEFAULT 0
  )
`;

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function getTableColumns(database, tableName) {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`).all();
}

function relaxTasksProductUrlNotNull(database) {
  const columns = getTableColumns(database, 'tasks');
  if (!columns.length) return false;
  const productUrlColumn = columns.find(column => column.name === 'product_url');
  if (!productUrlColumn || Number(productUrlColumn.notnull || 0) === 0) return false;

  const indexRows = database.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name = 'tasks'
      AND sql IS NOT NULL
    ORDER BY name
  `).all();
  const existingColumnNames = new Set(columns.map(column => column.name));
  const targetColumns = [
    'id',
    'user_id',
    'product_id',
    'product_url',
    'product_title',
    'product_image_url',
    'current_price',
    'end_time',
    'max_price',
    'strategy',
    'start_minutes_before',
    'start_seconds_before',
    'status',
    'is_highest_bidder',
    'bid_count',
    'last_bid_at',
    'error_msg',
    'created_at',
    'updated_at',
    'buyout_price',
    'bid_mode',
    'tax_type',
    'user_max_price',
    'multi_bid_increment',
    'client_request_id',
    'shipping_fee_text',
    'pending_followup_max_price',
    'force_orders_resync',
    'product_type',
    'buyout_auto_paid'
  ];
  const copyColumns = targetColumns.filter(column => existingColumnNames.has(column));
  const quotedCopyColumns = copyColumns.map(quoteIdentifier).join(', ');

  const previousForeignKeys = database.pragma('foreign_keys', { simple: true });
  database.pragma('foreign_keys = OFF');
  const migrate = database.transaction(() => {
    database.prepare('ALTER TABLE tasks RENAME TO tasks__product_url_not_null_old').run();
    database.prepare(TASKS_SCHEMA_WITH_NULLABLE_PRODUCT_URL).run();
    database.prepare(`
      INSERT INTO tasks (${quotedCopyColumns})
      SELECT ${quotedCopyColumns}
      FROM tasks__product_url_not_null_old
    `).run();
    database.prepare('DROP TABLE tasks__product_url_not_null_old').run();
    for (const row of indexRows) {
      database.prepare(row.sql).run();
    }
  });
  try {
    migrate();
  } finally {
    database.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
  return true;
}

module.exports = {
  relaxTasksProductUrlNotNull
};
