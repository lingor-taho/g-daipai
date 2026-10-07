const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const adminDir = path.join(rootDir, 'src', 'admin');
const clientDir = path.join(rootDir, 'src', 'client');
const npmCommand = 'npm';

const steps = [
  ['Full project encoding guard', process.execPath, ['scripts/encoding-guard.js'], rootDir],
  ['Startup build cache and readiness tests', process.execPath, ['scripts/startup.test.js'], rootDir],
  ['Google Sheets config tests', process.execPath, ['src/server/services/googleSheets.test.js'], rootDir],
  ['Online users service tests', process.execPath, ['src/server/services/onlineUsers.test.js'], rootDir],
  ['Task route tests', process.execPath, ['src/server/routes/task.test.js'], rootDir],
  ['Expired bidding failure analysis', process.execPath, ['src/server/services/failureAnalysis.test.js'], rootDir],
  ['Bid price timeline markers', process.execPath, ['src/client/src/utils/bidPriceTimeline.test.mjs'], rootDir],
  ['90-day statistics API tests', process.execPath, ['src/server/routes/task.won-stats.test.js'], rootDir],
  ['Statistics chart calculations', process.execPath, ['src/client/src/utils/statisticsChart.test.mjs'], rootDir],
  ['Batch bid input tests', process.execPath, ['src/shared/batchBid.test.cjs'], rootDir],
  ['Batch task submission tests', process.execPath, ['src/server/routes/task.batch.test.js'], rootDir],
  ['Durable batch queue tests', process.execPath, ['src/server/services/batchTaskQueue.test.js'], rootDir],
  ['Acting user permission tests', process.execPath, ['src/server/services/actingUser.test.js'], rootDir],
  ['Batch client scheduling tests', process.execPath, ['src/client/src/utils/batchSubmit.test.mjs'], rootDir],
  ['Client submission display tests', process.execPath, ['src/client/src/pages/Submit.display.test.mjs'], rootDir],
  ['Client bid price tests', process.execPath, ['src/client/src/utils/bidPrice.test.mjs'], rootDir],
  ['Admin order route tests', process.execPath, ['src/server/routes/admin.orders.test.js'], rootDir],
  ['Admin queue detail tests', process.execPath, ['src/server/services/adminTaskQueue.test.js'], rootDir],
  ['Plugin route tests', process.execPath, ['src/server/routes/plugin.test.js'], rootDir],
  ['Yahoo plugin content tests', process.execPath, ['yahoo-plugin/content.test.js'], rootDir],
  ['Yahoo plugin background tests', process.execPath, ['yahoo-plugin/background.test.js'], rootDir],
  ['Yahoo email verification tests', process.execPath, ['yahoo-plugin/emailVerification.test.js'], rootDir],
  ['Manual verification service tests', process.execPath, ['src/server/services/manualCaptcha.test.js'], rootDir],
  ['Admin manual verification display tests', process.execPath, ['src/admin/src/manualVerificationState.test.js'], rootDir],
  ['Yahoo plugin encoding guard', process.execPath, ['yahoo-plugin/encoding.test.js'], rootDir],
  ['Admin build', npmCommand, ['run', 'build'], adminDir],
  ['Client build', npmCommand, ['run', 'build'], clientDir]
];

for (const [label, command, args, cwd] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: command === npmCommand
  });
  if (result.error) {
    console.error(`\nRegression failed while starting "${label}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nRegression failed at "${label}" with exit code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

console.log('\nRegression passed.');
