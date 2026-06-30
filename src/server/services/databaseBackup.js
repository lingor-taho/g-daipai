const fs = require('fs/promises');
const path = require('path');

const BACKUP_FILE_PATTERN = /^backup-\d{8}-\d{6}\.db$/;
const DEFAULT_BACKUP_DIR = path.join(process.cwd(), 'tmp', 'db-backups');

let activeBackupPromise = null;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalBackupTimestamp(nowMs = Date.now()) {
  const date = new Date(nowMs);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate())
  ].join('') + '-' + [
    pad2(date.getHours()),
    pad2(date.getMinutes()),
    pad2(date.getSeconds())
  ].join('');
}

function buildDatabaseBackupFileName(nowMs = Date.now()) {
  return `backup-${formatLocalBackupTimestamp(nowMs)}.db`;
}

function isValidDatabaseBackupFileName(fileName) {
  return BACKUP_FILE_PATTERN.test(String(fileName || ''));
}

function getDatabaseBackupDir() {
  return process.env.DB_BACKUP_DIR || DEFAULT_BACKUP_DIR;
}

function resolveBackupFilePath(fileName, backupDir = getDatabaseBackupDir()) {
  if (!isValidDatabaseBackupFileName(fileName)) {
    throw new Error('invalid backup file name');
  }
  const resolvedDir = path.resolve(backupDir);
  const resolvedFile = path.resolve(resolvedDir, fileName);
  if (path.dirname(resolvedFile) !== resolvedDir) {
    throw new Error('invalid backup file path');
  }
  return resolvedFile;
}

function getRawDatabase(database) {
  return database?.raw || database?.db || database;
}

function getDatabasePath(database) {
  const raw = getRawDatabase(database);
  return raw?.name || raw?.filename || '';
}

function displayPath(filePath, cwd = process.cwd()) {
  if (!filePath) return '';
  const relative = path.relative(cwd, filePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return filePath;
}

async function ensureBackupDir(backupDir = getDatabaseBackupDir()) {
  await fs.mkdir(backupDir, { recursive: true });
}

async function createDatabaseBackup(database, options = {}) {
  if (activeBackupPromise) return activeBackupPromise;
  activeBackupPromise = (async () => {
    const raw = getRawDatabase(database);
    if (!raw || typeof raw.backup !== 'function') {
      throw new Error('database backup API is not available');
    }

    const nowMs = options.nowMs || Date.now();
    const backupDir = options.backupDir || getDatabaseBackupDir();
    const fileName = options.fileName || buildDatabaseBackupFileName(nowMs);
    const filePath = resolveBackupFilePath(fileName, backupDir);
    await ensureBackupDir(backupDir);
    await raw.backup(filePath);
    const stat = await fs.stat(filePath);
    return {
      fileName,
      filePath,
      sizeBytes: stat.size,
      createdAt: new Date(nowMs).toISOString(),
      databasePath: getDatabasePath(database),
      displayDatabasePath: displayPath(getDatabasePath(database))
    };
  })();

  try {
    return await activeBackupPromise;
  } finally {
    activeBackupPromise = null;
  }
}

async function listDatabaseBackups(options = {}) {
  const backupDir = options.backupDir || getDatabaseBackupDir();
  await ensureBackupDir(backupDir);
  const entries = await fs.readdir(backupDir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isValidDatabaseBackupFileName(entry.name)) continue;
    const filePath = resolveBackupFilePath(entry.name, backupDir);
    const stat = await fs.stat(filePath);
    items.push({
      fileName: entry.name,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString()
    });
  }
  items.sort((a, b) => String(b.fileName).localeCompare(String(a.fileName)));
  return items;
}

function isWeeklyDatabaseBackupCleanupDue(nowMs = Date.now()) {
  const date = new Date(nowMs);
  return date.getDay() === 1 && date.getHours() === 4;
}

function getWeeklyDatabaseBackupCleanupSlot(nowMs = Date.now()) {
  const date = new Date(nowMs);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}-04`;
}

function getCurrentCleanupCutoffMs(nowMs = Date.now()) {
  const date = new Date(nowMs);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

async function cleanupOldDatabaseBackups(options = {}) {
  const nowMs = options.nowMs || Date.now();
  const backupDir = options.backupDir || getDatabaseBackupDir();
  const cutoffMs = options.cutoffMs || getCurrentCleanupCutoffMs(nowMs);
  await ensureBackupDir(backupDir);
  const backups = await listDatabaseBackups({ backupDir });
  const deleted = [];
  for (const backup of backups) {
    const filePath = resolveBackupFilePath(backup.fileName, backupDir);
    const stat = await fs.stat(filePath);
    if (stat.mtimeMs >= cutoffMs) continue;
    await fs.unlink(filePath);
    deleted.push(backup.fileName);
  }
  return {
    backupDir,
    cutoffAt: new Date(cutoffMs).toISOString(),
    deleted,
    deletedCount: deleted.length
  };
}

module.exports = {
  BACKUP_FILE_PATTERN,
  buildDatabaseBackupFileName,
  cleanupOldDatabaseBackups,
  createDatabaseBackup,
  displayPath,
  getDatabaseBackupDir,
  getDatabasePath,
  getWeeklyDatabaseBackupCleanupSlot,
  isValidDatabaseBackupFileName,
  isWeeklyDatabaseBackupCleanupDue,
  listDatabaseBackups,
  resolveBackupFilePath
};
