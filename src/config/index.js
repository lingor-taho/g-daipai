require('dotenv').config();
module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  port: parseInt(process.env.PORT || '3000'),
  workerIntervalMs: parseInt(process.env.WORKER_INTERVAL_MS || '30000'),
  maxTasksPerMinute: parseInt(process.env.MAX_TASKS_PER_MINUTE || '2'),
  logLevel: process.env.LOG_LEVEL || 'info',
  useLocalChrome: process.env.USE_LOCAL_CHROME === 'true',
  jwtSecret: process.env.JWT_SECRET || 'g-daipai-secret-change-in-production',
  adminDebugToken: process.env.ADMIN_DEBUG_TOKEN || ''
};
