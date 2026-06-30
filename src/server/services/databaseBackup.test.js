const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  buildDatabaseBackupFileName,
  cleanupOldDatabaseBackups,
  createDatabaseBackup,
  getWeeklyDatabaseBackupCleanupSlot,
  isValidDatabaseBackupFileName,
  isWeeklyDatabaseBackupCleanupDue,
  listDatabaseBackups,
  resolveBackupFilePath
} = require('./databaseBackup');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'g-daipai-db-backup-test-'));
}

async function testBuildDatabaseBackupFileNameUsesLocalDateTime() {
  const nowMs = new Date(2026, 5, 30, 16, 7, 8).getTime();

  assert.equal(buildDatabaseBackupFileName(nowMs), 'backup-20260630-160708.db');
  assert.equal(isValidDatabaseBackupFileName('backup-20260630-160708.db'), true);
  assert.equal(isValidDatabaseBackupFileName('../backup-20260630-160708.db'), false);
  assert.equal(isValidDatabaseBackupFileName('backup.db'), false);
}

async function testResolveBackupFilePathRejectsTraversal() {
  const backupDir = await makeTempDir();

  assert.throws(() => resolveBackupFilePath('../backup-20260630-160708.db', backupDir), /invalid backup file name/);
}

async function testCreateDatabaseBackupUsesSqliteBackupApi() {
  const backupDir = await makeTempDir();
  const calls = [];
  const fakeDb = {
    raw: {
      name: path.join('data', 'app.db'),
      async backup(filePath) {
        calls.push(filePath);
        await fs.writeFile(filePath, 'snapshot');
      }
    }
  };

  const result = await createDatabaseBackup(fakeDb, {
    backupDir,
    nowMs: new Date(2026, 5, 30, 16, 7, 8).getTime()
  });

  assert.equal(result.fileName, 'backup-20260630-160708.db');
  assert.equal(result.sizeBytes, 8);
  assert.equal(calls.length, 1);
  assert.equal(path.basename(calls[0]), 'backup-20260630-160708.db');
  assert.equal(await fs.readFile(calls[0], 'utf8'), 'snapshot');
}

async function testListDatabaseBackupsOnlyReturnsBackupDbFiles() {
  const backupDir = await makeTempDir();
  await fs.writeFile(path.join(backupDir, 'backup-20260630-160708.db'), 'a');
  await fs.writeFile(path.join(backupDir, 'note.txt'), 'b');

  const backups = await listDatabaseBackups({ backupDir });

  assert.deepEqual(backups.map(item => item.fileName), ['backup-20260630-160708.db']);
}

async function testCleanupOldDatabaseBackupsDeletesOnlyFilesBeforeCutoff() {
  const backupDir = await makeTempDir();
  const oldFile = path.join(backupDir, 'backup-20260622-035900.db');
  const newFile = path.join(backupDir, 'backup-20260622-040100.db');
  await fs.writeFile(oldFile, 'old');
  await fs.writeFile(newFile, 'new');
  await fs.utimes(oldFile, new Date(2026, 5, 22, 3, 59, 0), new Date(2026, 5, 22, 3, 59, 0));
  await fs.utimes(newFile, new Date(2026, 5, 22, 4, 1, 0), new Date(2026, 5, 22, 4, 1, 0));

  const result = await cleanupOldDatabaseBackups({
    backupDir,
    nowMs: new Date(2026, 5, 22, 4, 10, 0).getTime()
  });

  assert.deepEqual(result.deleted, ['backup-20260622-035900.db']);
  assert.equal(await fs.readFile(newFile, 'utf8'), 'new');
  await assert.rejects(fs.stat(oldFile), /ENOENT/);
}

function testWeeklyCleanupScheduleMatchesMondayFour() {
  assert.equal(isWeeklyDatabaseBackupCleanupDue(new Date(2026, 5, 22, 4, 0, 0).getTime()), true);
  assert.equal(isWeeklyDatabaseBackupCleanupDue(new Date(2026, 5, 22, 3, 59, 0).getTime()), false);
  assert.equal(isWeeklyDatabaseBackupCleanupDue(new Date(2026, 5, 23, 4, 0, 0).getTime()), false);
  assert.equal(getWeeklyDatabaseBackupCleanupSlot(new Date(2026, 5, 22, 4, 10, 0).getTime()), '2026-06-22-04');
}

Promise.all([
  testBuildDatabaseBackupFileNameUsesLocalDateTime(),
  testResolveBackupFilePathRejectsTraversal(),
  testCreateDatabaseBackupUsesSqliteBackupApi(),
  testListDatabaseBackupsOnlyReturnsBackupDbFiles(),
  testCleanupOldDatabaseBackupsDeletesOnlyFilesBeforeCutoff()
])
  .then(testWeeklyCleanupScheduleMatchesMondayFour)
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  });
