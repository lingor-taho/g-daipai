function buildPlaceholders(values) {
  return values.map(() => '?').join(',');
}

function uniqueValues(values) {
  return [...new Set(values.filter(value => value !== null && value !== undefined && value !== ''))];
}

function sortIds(values) {
  return values.slice().sort((left, right) => Number(left) - Number(right));
}

function buildWonDateCleanupCutoff(cleanupDate) {
  const raw = String(cleanupDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error('valid cleanup date is required');
  }
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || raw !== date.toISOString().slice(0, 10)) {
    throw new Error('valid cleanup date is required');
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return {
    cutoffDate: raw,
    cutoffExclusive: `${date.toISOString().slice(0, 10)} 00:00:00`
  };
}

async function collectWonDateCleanupTargets(database, cleanupDate) {
  const cutoff = buildWonDateCleanupCutoff(cleanupDate);
  const rows = await database.getAll(
    `SELECT DISTINCT
       COALESCE(o.product_id, t.product_id) AS product_id,
       t.id AS task_id
     FROM orders o
     LEFT JOIN tasks t ON t.id = o.task_id
     WHERE o.won_at IS NOT NULL
       AND datetime(o.won_at) < datetime(?)
       AND COALESCE(o.product_id, t.product_id) IS NOT NULL`,
    [cutoff.cutoffExclusive]
  );

  const productIds = uniqueValues(rows.map(row => row.product_id));
  const seedTaskIds = uniqueValues(rows.map(row => row.task_id));
  let taskIds = seedTaskIds;
  let orderIds = [];

  if (productIds.length > 0) {
    const productPlaceholders = buildPlaceholders(productIds);
    const taskRows = await database.getAll(
      `SELECT id FROM tasks WHERE product_id IN (${productPlaceholders}) ORDER BY id ASC`,
      productIds
    );
    taskIds = sortIds(uniqueValues([...seedTaskIds, ...taskRows.map(row => row.id)]));
  }

  if (productIds.length > 0 || taskIds.length > 0) {
    const clauses = [];
    const params = [];
    if (productIds.length > 0) {
      clauses.push(`product_id IN (${buildPlaceholders(productIds)})`);
      params.push(...productIds);
    }
    if (taskIds.length > 0) {
      clauses.push(`task_id IN (${buildPlaceholders(taskIds)})`);
      params.push(...taskIds);
    }
    const orderRows = await database.getAll(
      `SELECT id FROM orders WHERE ${clauses.join(' OR ')} ORDER BY id ASC`,
      params
    );
    orderIds = uniqueValues(orderRows.map(row => row.id));
  }

  return {
    ...cutoff,
    productIds,
    taskIds,
    orderIds
  };
}

const { deleteProductData } = require('./deleteProductData');
const { withProductSubmissionLock } = require('./productSubmissionLock');
const accountScope = require('./yahooAccountContext');
const countFields = [
  'taskCount', 'orderCount', 'bidLogCount', 'biddingItemCount', 'orderStatusLogCount', 'productCount',
  'assignmentCount', 'messageCount', 'diagnosticCount', 'workClaimCount', 'transferCount',
  'manualImportItemCount', 'batchItemCount'
];

function summarize(targets, results, dryRun) {
  const counts = Object.fromEntries(countFields.map(key => [
    key, results.reduce((sum, item) => sum + Number(item[key] || 0), 0)
  ]));
  return {
    ...targets,
    dryRun,
    productIds: results.map(item => item.productId),
    taskIds: sortIds(uniqueValues(results.flatMap(item => item.taskIds))),
    orderIds: sortIds(uniqueValues(results.flatMap(item => item.orderIds))),
    ...counts,
    totalCount: Object.values(counts).reduce((sum, count) => sum + count, 0)
  };
}

async function previewWonDateCleanup(database, cleanupDate) {
  const targets = await accountScope.run(null, () => collectWonDateCleanupTargets(database, cleanupDate));
  return accountScope.run(null, () => database.raw.transaction(() => summarize(
    targets, targets.productIds.map(id => deleteProductData(database.raw, id, { dryRun: true })), true
  )).deferred());
}

async function runWonDateCleanup(database, cleanupDate) {
  const initial = await accountScope.run(null, () => collectWonDateCleanupTargets(database, cleanupDate));
  const ids = initial.productIds.slice().sort();
  const run = () => accountScope.run(null, () => database.raw.transaction(() => {
    // Recheck eligibility after waiting for in-flight submissions/deletions. A
    // product freshly recreated without an old order must not be deleted again.
    const eligible = database.raw.prepare(`SELECT 1 FROM orders o LEFT JOIN tasks t ON t.id=o.task_id
      WHERE COALESCE(o.product_id,t.product_id)=? AND o.won_at IS NOT NULL
        AND datetime(o.won_at)<datetime(?) LIMIT 1`);
    const results = ids.filter(id => eligible.get(id, initial.cutoffExclusive))
      .map(id => deleteProductData(database.raw, id));
    return summarize(initial, results, false);
  }).immediate());
  // Stable lock order prevents overlapping date cleanups from deadlocking.
  return ids.reduceRight((next, id) => () => withProductSubmissionLock(id, next), run)();
}

module.exports = {
  buildWonDateCleanupCutoff, collectWonDateCleanupTargets, previewWonDateCleanup, runWonDateCleanup
};
