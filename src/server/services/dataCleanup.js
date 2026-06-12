const DEFAULT_CLEANUP_CONFIG = {
  enabled: false,
  cleanupHour: 3,
  retentionDays: 30
};

const {
  CLEANUP_TASK_STATUSES,
  buildCleanupStatusSqlList
} = require('./dataCleanupPolicy');

const CLEANUP_STATUSES = CLEANUP_TASK_STATUSES;

function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const intValue = Math.floor(number);
  if (intValue < min || intValue > max) return fallback;
  return intValue;
}

function buildDataCleanupConfig(values = {}) {
  return {
    enabled: values.data_cleanup_enabled === true ||
      values.data_cleanup_enabled === '1' ||
      values.data_cleanup_enabled === 1 ||
      values.data_cleanup_enabled === 'true',
    cleanupHour: normalizePositiveInt(values.data_cleanup_hour, DEFAULT_CLEANUP_CONFIG.cleanupHour, { min: 0, max: 23 }),
    retentionDays: normalizePositiveInt(values.data_cleanup_retention_days, DEFAULT_CLEANUP_CONFIG.retentionDays, { min: 1 })
  };
}

async function getDataCleanupConfig(database) {
  const rows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('data_cleanup_enabled', 'data_cleanup_hour', 'data_cleanup_retention_days')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return buildDataCleanupConfig(values);
}

async function saveDataCleanupConfig(database, config) {
  const cleanupHour = normalizePositiveInt(config.cleanupHour, DEFAULT_CLEANUP_CONFIG.cleanupHour, { min: 0, max: 23 });
  const retentionDays = normalizePositiveInt(config.retentionDays, DEFAULT_CLEANUP_CONFIG.retentionDays, { min: 1 });
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('data_cleanup_enabled', ?, CURRENT_TIMESTAMP)`,
    [config.enabled ? '1' : '0']
  );
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('data_cleanup_hour', ?, CURRENT_TIMESTAMP)`,
    [String(cleanupHour)]
  );
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('data_cleanup_retention_days', ?, CURRENT_TIMESTAMP)`,
    [String(retentionDays)]
  );
  return { enabled: Boolean(config.enabled), cleanupHour, retentionDays };
}

function getCleanupCutoffIso(retentionDays, nowMs = Date.now()) {
  const days = normalizePositiveInt(retentionDays, DEFAULT_CLEANUP_CONFIG.retentionDays, { min: 1 });
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

function getLocalDateKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function shouldRunAutoCleanup(database, config, nowMs = Date.now()) {
  if (!config?.enabled) return false;
  const hour = normalizePositiveInt(config.cleanupHour, DEFAULT_CLEANUP_CONFIG.cleanupHour, { min: 0, max: 23 });
  if (new Date(nowMs).getHours() !== hour) return false;
  const dateKey = getLocalDateKey(nowMs);
  const existing = await database.getOne(
    `SELECT id FROM data_cleanup_logs
     WHERE run_type = ?
       AND local_date = ?
     LIMIT 1`,
    ['auto', dateKey]
  );
  return !existing;
}

async function deleteStaleTaskData(database, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const retentionDays = normalizePositiveInt(options.retentionDays, DEFAULT_CLEANUP_CONFIG.retentionDays, { min: 1 });
  const runType = options.runType === 'auto' ? 'auto' : 'manual';
  const cutoffIso = getCleanupCutoffIso(retentionDays, nowMs);
  const localDate = getLocalDateKey(nowMs);

  const staleTasks = await database.getAll(
    `SELECT id, product_id
     FROM tasks
     WHERE status IN (${buildCleanupStatusSqlList()})
       AND datetime(COALESCE(end_time, updated_at, created_at)) < datetime(?)`,
    [cutoffIso]
  );

  const taskIds = staleTasks.map(task => task.id).filter(id => id !== null && id !== undefined);
  const productIds = [...new Set(staleTasks.map(task => task.product_id).filter(Boolean))];
  let bidLogCount = 0;
  let orderCount = 0;
  let biddingItemCount = 0;
  let taskCount = 0;

  if (taskIds.length > 0) {
    const taskPlaceholders = taskIds.map(() => '?').join(',');
    const productPlaceholders = productIds.map(() => '?').join(',');

    bidLogCount = (await database.query(
      `DELETE FROM bid_logs WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;

    orderCount = (await database.query(
      `DELETE FROM orders WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;

    if (productIds.length > 0) {
      biddingItemCount = (await database.query(
        `DELETE FROM bidding_items WHERE product_id IN (${productPlaceholders})`,
        productIds
      )).rowCount || 0;
    }

    taskCount = (await database.query(
      `DELETE FROM tasks WHERE id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
  }

  await database.query(
    `INSERT INTO data_cleanup_logs (
       run_type,
       local_date,
       retention_days,
       cutoff_at,
       task_count,
       bid_log_count,
       order_count,
       bidding_item_count,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    [runType, localDate, retentionDays, cutoffIso, taskCount, bidLogCount, orderCount, biddingItemCount]
  );

  return {
    runType,
    localDate,
    retentionDays,
    cutoffAt: cutoffIso,
    taskCount,
    bidLogCount,
    orderCount,
    biddingItemCount,
    totalCount: taskCount + bidLogCount + orderCount + biddingItemCount
  };
}

module.exports = {
  CLEANUP_STATUSES,
  DEFAULT_CLEANUP_CONFIG,
  buildDataCleanupConfig,
  deleteStaleTaskData,
  getCleanupCutoffIso,
  getDataCleanupConfig,
  saveDataCleanupConfig,
  shouldRunAutoCleanup
};
