const express = require('express');
const config = require('../config');
const taskRoutes = require('./routes/task');
const adminRoutes = require('./routes/admin');
const proxyRoutes = require('./routes/proxy');
const authRoutes = require('./routes/auth');
const pluginRoutes = require('./routes/plugin');

const app = express();
const PENDING_TASK_SWEEP_INTERVAL_MS = 60 * 1000;

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  const allowedOrigin =
    origin.startsWith('chrome-extension://') ||
    origin === 'http://localhost:3035' ||
    origin === 'http://127.0.0.1:3035' ||
    origin === 'http://localhost:8000' ||
    origin === 'http://127.0.0.1:8000';

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

app.use(express.json());

app.use('/api/task', taskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/plugin', pluginRoutes);

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

app.listen(config.port, () => {
  console.log(`API Server running on port ${config.port}`);
  sweepPendingTasks();
  const sweepTimer = setInterval(sweepPendingTasks, PENDING_TASK_SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
});
