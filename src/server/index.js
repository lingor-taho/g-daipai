const express = require('express');
const config = require('../config');
const taskRoutes = require('./routes/task');
const adminRoutes = require('./routes/admin');
const proxyRoutes = require('./routes/proxy');
const authRoutes = require('./routes/auth');
const pluginRoutes = require('./routes/plugin');
const debugRoutes = require('./routes/debug');
const db = require('./models');
const {
  deleteStaleTaskData,
  getDataCleanupConfig,
  shouldRunAutoCleanup
} = require('./services/dataCleanup');
const {
  cleanupOldDatabaseBackups,
  getWeeklyDatabaseBackupCleanupSlot,
  isWeeklyDatabaseBackupCleanupDue
} = require('./services/databaseBackup');

const app = express();
const PENDING_TASK_SWEEP_INTERVAL_MS = 60 * 1000;
const DATA_CLEANUP_CHECK_INTERVAL_MS = 60 * 1000;
let lastDatabaseBackupCleanupSlot = '';
const allowedHttpOrigins = new Set([
  'http://localhost:3035',
  'http://127.0.0.1:3035',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:8000',
  'http://127.0.0.1:8000'
]);

for (const host of String(process.env.PUBLIC_HOSTS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean)) {
  allowedHttpOrigins.add(`http://${host}`);
  allowedHttpOrigins.add(`http://${host}:3035`);
  allowedHttpOrigins.add(`http://${host}:8000`);
  allowedHttpOrigins.add(`https://${host}`);
}

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowedOrigin =
    origin.startsWith('chrome-extension://') ||
    allowedHttpOrigins.has(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.use(express.json({ limit: '6mb' }));

app.use('/api/task', taskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/plugin', pluginRoutes);
app.use('/api/debug', debugRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'invalid JSON request body' });
  }
  console.error('Unhandled API error:', err);
  res.status(500).json({ error: 'server error' });
});

async function sweepPendingTasks() {
  try {
    const result = await pluginRoutes.sweepPendingTasks();
    if (result.total > 0) {
      console.log(
        `Swept ${result.total} task(s): overdue=${result.overdue}, pricedOut=${result.pricedOut}, processingReset=${result.processingReset}`
      );
    }
  } catch (err) {
    console.error('Failed to sweep pending tasks:', err);
  }
}

async function runScheduledDataCleanup() {
  try {
    const cleanupConfig = await getDataCleanupConfig(db);
    const nowMs = Date.now();
    if (!(await shouldRunAutoCleanup(db, cleanupConfig, nowMs))) return;
    const result = await deleteStaleTaskData(db, {
      retentionDays: cleanupConfig.retentionDays,
      runType: 'auto',
      nowMs
    });
    console.log(
      `Data cleanup completed: tasks=${result.taskCount}, bidLogs=${result.bidLogCount}, orders=${result.orderCount}, biddingItems=${result.biddingItemCount}`
    );
  } catch (err) {
    console.error('Failed to run scheduled data cleanup:', err);
  }
}

async function runScheduledDatabaseBackupCleanup(nowMs = Date.now()) {
  try {
    if (!isWeeklyDatabaseBackupCleanupDue(nowMs)) return;
    const slot = getWeeklyDatabaseBackupCleanupSlot(nowMs);
    if (slot === lastDatabaseBackupCleanupSlot) return;
    const result = await cleanupOldDatabaseBackups({ nowMs });
    lastDatabaseBackupCleanupSlot = slot;
    console.log(`Database backup cleanup completed: deleted=${result.deletedCount}`);
  } catch (err) {
    console.error('Failed to run scheduled database backup cleanup:', err);
  }
}

async function runScheduledMaintenance() {
  await runScheduledDataCleanup();
  await runScheduledDatabaseBackupCleanup();
}

app.listen(config.port, () => {
  console.log(`API Server running on port ${config.port}`);
  sweepPendingTasks();
  const sweepTimer = setInterval(sweepPendingTasks, PENDING_TASK_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
  runScheduledMaintenance();
  const cleanupTimer = setInterval(runScheduledMaintenance, DATA_CLEANUP_CHECK_INTERVAL_MS);
  cleanupTimer.unref?.();
});
