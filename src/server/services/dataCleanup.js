const DEFAULT_CLEANUP_CONFIG = {
  enabled: false,
  cleanupHour: 3,
  retentionDays: 30
};
const DEFAULT_CACHE_CLEANUP_CONFIG = { ...DEFAULT_CLEANUP_CONFIG, retentionDays: 1 };
const { deleteHistoryThrough } = require('./fleamarketNegotiation');

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

function cleanupDefaults(scope) {
  return scope === 'cache' ? DEFAULT_CACHE_CLEANUP_CONFIG : DEFAULT_CLEANUP_CONFIG;
}

function cleanupConfigKeys(scope) {
  return ['enabled', 'hour', 'retention_days'].map(name => `${scope}_cleanup_${name}`);
}

function buildDataCleanupConfig(values = {}, scope = 'data') {
  const [enabledKey, hourKey, retentionKey] = cleanupConfigKeys(scope);
  const defaults = cleanupDefaults(scope);
  return {
    enabled: [true, '1', 1, 'true'].includes(values[enabledKey]),
    cleanupHour: normalizePositiveInt(values[hourKey], defaults.cleanupHour, { min: 0, max: 23 }),
    retentionDays: normalizePositiveInt(values[retentionKey], defaults.retentionDays)
  };
}

async function getDataCleanupConfig(database, scope = 'data') {
  const rows = await database.getAll(
    'SELECT key, value FROM config WHERE key IN (?, ?, ?)',
    cleanupConfigKeys(scope)
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return buildDataCleanupConfig(values, scope);
}

async function saveDataCleanupConfig(database, config, scope = 'data') {
  const defaults = cleanupDefaults(scope);
  const cleanupHour = normalizePositiveInt(config.cleanupHour, defaults.cleanupHour, { min: 0, max: 23 });
  const retentionDays = normalizePositiveInt(config.retentionDays, defaults.retentionDays);
  const [enabledKey, hourKey, retentionKey] = cleanupConfigKeys(scope);
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP), (?, ?, CURRENT_TIMESTAMP), (?, ?, CURRENT_TIMESTAMP)`,
    [enabledKey, config.enabled ? '1' : '0', hourKey, String(cleanupHour), retentionKey, String(retentionDays)]
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

const autoCleanupRecorded = `SELECT 1 FROM data_cleanup_logs
  WHERE run_type = 'auto' AND local_date = ? AND cleanup_scope = ?
  UNION ALL
  SELECT 1 FROM config WHERE key = ? AND value = ?
  LIMIT 1`;

function autoCleanupParams(scope, localDate) {
  return [localDate, scope, `${scope}_cleanup_last_auto_date`, localDate];
}

async function shouldRunAutoCleanup(database, config, nowMs = Date.now(), scope = 'data') {
  if (!config?.enabled) return false;
  const hour = normalizePositiveInt(config.cleanupHour, DEFAULT_CLEANUP_CONFIG.cleanupHour, { min: 0, max: 23 });
  if (new Date(nowMs).getHours() !== hour) return false;
  const existing = await database.getOne(autoCleanupRecorded, autoCleanupParams(scope, getLocalDateKey(nowMs)));
  return !existing;
}

function deleteStaleNegotiationCache(database, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const retentionDays = normalizePositiveInt(options.retentionDays, DEFAULT_CACHE_CLEANUP_CONFIG.retentionDays);
  const runType = options.runType === 'auto' ? 'auto' : 'manual';
  const cutoffAt = getCleanupCutoffIso(retentionDays, nowMs);
  const localDate = getLocalDateKey(nowMs);
  const raw = database.raw;
  return raw.transaction(() => {
    if (runType === 'auto' && raw.prepare(autoCleanupRecorded).get(...autoCleanupParams('cache', localDate))) return null;
    const cacheCount = deleteHistoryThrough(raw, cutoffAt);
    raw.prepare(`INSERT INTO data_cleanup_logs
      (cleanup_scope, run_type, local_date, retention_days, cutoff_at, cache_count)
      VALUES ('cache', ?, ?, ?, ?, ?)`).run(runType, localDate, retentionDays, cutoffAt, cacheCount);
    return { cleanupScope: 'cache', runType, localDate, retentionDays, cutoffAt, cacheCount, totalCount: cacheCount };
  }).immediate();
}

function clearDataCleanupLogs(database) {
  const raw = database.raw;
  return raw.transaction(() => {
    // Log removal must not reopen today's schedule, including runs made before this upgrade.
    raw.prepare(`INSERT INTO config (key, value, updated_at)
      SELECT cleanup_scope || '_cleanup_last_auto_date', MAX(local_date), CURRENT_TIMESTAMP
      FROM data_cleanup_logs
      WHERE run_type = 'auto' AND local_date IS NOT NULL AND cleanup_scope IN ('data', 'cache')
      GROUP BY cleanup_scope
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      WHERE excluded.value > config.value`).run();
    return raw.prepare('DELETE FROM data_cleanup_logs').run().changes;
  }).immediate();
}

async function deleteStaleTaskData(database, options = {}) {
  const nowMs = options.nowMs || Date.now();
  const retentionDays = normalizePositiveInt(options.retentionDays, DEFAULT_CLEANUP_CONFIG.retentionDays, { min: 1 });
  const runType = options.runType === 'auto' ? 'auto' : 'manual';
  const cutoffIso = getCleanupCutoffIso(retentionDays, nowMs);
  const localDate = getLocalDateKey(nowMs);

  const staleTasks = await database.getAll(
    `SELECT tasks.id, tasks.product_id
     FROM tasks
     LEFT JOIN products p ON p.product_id = tasks.product_id
     WHERE tasks.status IN (${buildCleanupStatusSqlList()})
       AND datetime(COALESCE(p.end_time, tasks.updated_at, tasks.created_at)) < datetime(?)`,
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
  clearDataCleanupLogs,
  deleteStaleNegotiationCache,
  deleteStaleTaskData,
  getCleanupCutoffIso,
  getDataCleanupConfig,
  saveDataCleanupConfig,
  shouldRunAutoCleanup
};
