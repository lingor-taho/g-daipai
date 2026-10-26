const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const adminDir = path.join(rootDir, 'src', 'admin');
const clientDir = path.join(rootDir, 'src', 'client');
const npmCommand = 'npm';

// The default regression entry must never load the production database.
if(process.env.GDAIPAI_ISOLATED_TESTS!=='1') {
  const isolated=spawnSync(process.execPath,['scripts/run-isolated-regression.cjs'],{cwd:rootDir,stdio:'inherit',env:process.env});
  if(isolated.error) throw isolated.error;
  process.exit(isolated.status || 0);
}
const steps = [
  ['Agent exclusivity enforced during atomic task creation',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/agentProductPolicy.submit.test.js'],rootDir],
  ['Resubmission refreshes old auction history safely',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/task.historyRefresh.test.js'],rootDir],
  ['Agent group policy settings and read-only checks',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/agentProductPolicy.test.js'],rootDir],
  ['Atomic won-date cleanup',process.execPath,['src/server/services/forceDateCleanup.test.js'],rootDir],
  ['Product deletion and different-user resubmission',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/admin.productDelete.test.js'],rootDir],
  ['Fleamarket purchase HTTP and atomic order completion', process.execPath, ['scripts/run-isolated-regression.cjs','src/server/routes/fleamarketPurchase.test.js'], rootDir],
  ['P/normal/shop order time and shared won-list sorting', process.execPath, ['scripts/run-isolated-regression.cjs','src/server/routes/fleamarketPurchase.time.test.js'], rootDir],
  ['Legacy P order time repair and backup',process.execPath,['scripts/repair-fleamarket-order-time.test.js'],rootDir],
  ['Fleamarket purchase browser and executor', process.execPath, ['yahoo-plugin/fleamarketPurchase.test.js'], rootDir],
  ['Stored product type task routing',process.execPath,['yahoo-plugin/productTypeRouting.test.js'],rootDir],
  ['Favorite detail product-table type resolution',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/proxy.storedType.test.js'],rootDir],
  ['Fleamarket trade scan and deferred receipt', process.execPath, ['yahoo-plugin/fleamarketTrade.test.js'], rootDir],
  ['Fleamarket message read and send', process.execPath, ['yahoo-plugin/fleamarketMessages.test.js'], rootDir],
  ['Manual order import excludes fleamarket', process.execPath, ['src/server/routes/manualOrderImport.fleamarket.test.js'], rootDir],
  ['Fleamarket product search and single buyout submission', process.execPath, ['src/server/routes/fleamarket.test.js'], rootDir],
  ['Multi-account migration and routing',process.execPath,['src/server/services/yahooAccounts.test.js'],rootDir],
  ['Multi-account HTTP workflow',process.execPath,['src/server/routes/yahooMultiAccount.test.js'],rootDir],
  ['Multi-account recovery regressions',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/yahooMultiAccount.regressions.test.js'],rootDir],
  ['Multi-account task safety regressions',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/yahooMultiAccount.taskSafety.test.js'],rootDir],
  ['Multi-account extension transport',process.execPath,['yahoo-plugin/multiAccount.test.js'],rootDir],
  ['Auction history chart calculations', process.execPath, ['src/client/src/utils/auctionHistoryChart.test.mjs'], rootDir],
  ['Auction history queue tests', process.execPath, ['src/server/services/auctionHistory.test.js'], rootDir],
  ['Auction history plugin tests', process.execPath, ['yahoo-plugin/auctionHistory.test.js'], rootDir],
  ['Full project encoding guard', process.execPath, ['scripts/encoding-guard.js'], rootDir],
  ['Startup build cache and readiness tests', process.execPath, ['scripts/startup.test.js'], rootDir],
  ['Google Sheets config tests', process.execPath, ['src/server/services/googleSheets.test.js'], rootDir],
  ['Online users service tests', process.execPath, ['src/server/services/onlineUsers.test.js'], rootDir],
  ['User deletion cleanup', process.execPath, ['src/server/services/deleteUser.test.js'], rootDir],
  ['User deletion HTTP flow', process.execPath, ['scripts/run-isolated-regression.cjs','src/server/routes/admin.users.delete.test.js'], rootDir],
  ['Task route tests', process.execPath, ['src/server/routes/task.test.js'], rootDir],
  ['Auction deadline clock tests',process.execPath,['src/shared/auctionDeadline.test.cjs'],rootDir],
  ['Ended task submission guard',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/task.endedSubmit.test.js'],rootDir],
  ['Expired bidding failure analysis', process.execPath, ['src/server/services/failureAnalysis.test.js'], rootDir],
  ['Bid price timeline markers', process.execPath, ['src/client/src/utils/bidPriceTimeline.test.mjs'], rootDir],
  ['90-day statistics API tests', process.execPath, ['src/server/routes/task.won-stats.test.js'], rootDir],
  ['Statistics chart calculations', process.execPath, ['src/client/src/utils/statisticsChart.test.mjs'], rootDir],
  ['Batch bid input tests', process.execPath, ['src/shared/batchBid.test.cjs'], rootDir],
  ['Product URL routing and exports', process.execPath, ['src/shared/productUrl.test.cjs'], rootDir],
  ['Admin product links use saved type only', process.execPath, ['src/server/services/adminProductLinks.test.js'], rootDir],
  ['Batch task submission tests', process.execPath, ['src/server/routes/task.batch.test.js'], rootDir],
  ['Durable batch queue tests', process.execPath, ['src/server/services/batchTaskQueue.test.js'], rootDir],
  ['Acting user permission tests', process.execPath, ['src/server/services/actingUser.test.js'], rootDir],
  ['Batch client scheduling tests', process.execPath, ['src/client/src/utils/batchSubmit.test.mjs'], rootDir],
  ['Client submission display tests', process.execPath, ['src/client/src/pages/Submit.display.test.mjs'], rootDir],
  ['Client bid price tests', process.execPath, ['src/client/src/utils/bidPrice.test.mjs'], rootDir],
  ['Admin order route tests', process.execPath, ['src/server/routes/admin.orders.test.js'], rootDir],
  ['Batch order status refresh HTTP', process.execPath, ['scripts/run-isolated-regression.cjs', 'src/server/routes/admin.orderStatusRefresh.test.js'], rootDir],
  ['Order audit schema recovery', process.execPath, ['src/server/services/orderAuditSchema.test.js'], rootDir],
  ['Admin queue detail tests', process.execPath, ['src/server/services/adminTaskQueue.test.js'], rootDir],
  ['Plugin route tests', process.execPath, ['src/server/routes/plugin.test.js'], rootDir],
  ['Shipment alerts without Yahoo scan', process.execPath, ['scripts/run-isolated-regression.cjs', 'src/server/routes/shipmentAlerts.test.js'], rootDir],
  ['Ended product snapshot failure reason',process.execPath,['scripts/run-isolated-regression.cjs','src/server/routes/plugin.endedSnapshot.test.js'],rootDir],
  ['Yahoo plugin content tests', process.execPath, ['yahoo-plugin/content.test.js'], rootDir],
  ['Yahoo plugin background tests', process.execPath, ['yahoo-plugin/background.test.js'], rootDir],
  ['Yahoo sync recovery tests', process.execPath, ['yahoo-plugin/syncRecovery.test.js'], rootDir],
  ['Yahoo email verification tests', process.execPath, ['yahoo-plugin/emailVerification.test.js'], rootDir],
  ['Manual verification service tests', process.execPath, ['src/server/services/manualCaptcha.test.js'], rootDir],
  ['Admin manual verification display tests', process.execPath, ['src/admin/src/manualVerificationState.test.js'], rootDir],
  ['Yahoo plugin encoding guard', process.execPath, ['yahoo-plugin/encoding.test.js'], rootDir],
  ['Admin build', npmCommand, ['run', 'build'], adminDir],
  ['Admin task and queue column browser checks',process.execPath,['scripts/admin-table-mobile.browser.test.cjs'],rootDir],
  ['User deletion admin browser checks',process.execPath,['scripts/user-delete-browser.test.cjs'],rootDir],
  ['Multi-account admin browser checks',process.execPath,['scripts/yahoo-multi-account-browser.test.cjs'],rootDir],
  ['Client build', npmCommand, ['run', 'build'], clientDir],
  ['Client task list long-title mobile layout',process.execPath,['scripts/task-list-mobile.browser.test.cjs'],rootDir],
  ['Agent group policy client browser checks',process.execPath,['scripts/agent-product-policy.browser.test.cjs'],rootDir],
  ['Fleamarket client browser checks', process.execPath, ['scripts/fleamarket-browser.test.cjs'], rootDir],
  ['Ended product submission display',process.execPath,['scripts/submit-ended-browser.test.cjs'],rootDir],
  ['Client login and bid config browser checks',process.execPath,['scripts/run-isolated-regression.cjs','scripts/client-login.test.cjs'],rootDir]
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
