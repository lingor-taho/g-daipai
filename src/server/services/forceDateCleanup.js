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

async function countRows(database, sql, params) {
  const row = await database.getOne(sql, params);
  return Number(row?.count || 0);
}

function emptyResult(targets, dryRun) {
  return {
    dryRun,
    ...targets,
    taskCount: 0,
    orderCount: 0,
    bidLogCount: 0,
    biddingItemCount: 0,
    orderStatusLogCount: 0,
    productCount: 0,
    totalCount: 0
  };
}

async function previewWonDateCleanup(database, cleanupDate) {
  const targets = await collectWonDateCleanupTargets(database, cleanupDate);
  if (targets.productIds.length === 0 && targets.taskIds.length === 0 && targets.orderIds.length === 0) {
    return emptyResult(targets, true);
  }

  const taskPlaceholders = targets.taskIds.length ? buildPlaceholders(targets.taskIds) : '';
  const orderPlaceholders = targets.orderIds.length ? buildPlaceholders(targets.orderIds) : '';
  const productPlaceholders = targets.productIds.length ? buildPlaceholders(targets.productIds) : '';

  const bidLogCount = targets.taskIds.length
    ? await countRows(database, `SELECT COUNT(*) AS count FROM bid_logs WHERE task_id IN (${taskPlaceholders})`, targets.taskIds)
    : 0;
  const orderCount = targets.orderIds.length
    ? await countRows(database, `SELECT COUNT(*) AS count FROM orders WHERE id IN (${orderPlaceholders})`, targets.orderIds)
    : 0;
  const orderStatusLogCount = targets.orderIds.length || targets.productIds.length
    ? await countRows(
      database,
      `SELECT COUNT(*) AS count
       FROM order_status_change_logs
       WHERE ${[
        targets.orderIds.length ? `order_id IN (${orderPlaceholders})` : '',
        targets.productIds.length ? `product_id IN (${productPlaceholders})` : ''
      ].filter(Boolean).join(' OR ')}`,
      [...targets.orderIds, ...targets.productIds]
    )
    : 0;
  const biddingItemCount = targets.productIds.length
    ? await countRows(database, `SELECT COUNT(*) AS count FROM bidding_items WHERE product_id IN (${productPlaceholders})`, targets.productIds)
    : 0;
  const taskCount = targets.taskIds.length
    ? await countRows(database, `SELECT COUNT(*) AS count FROM tasks WHERE id IN (${taskPlaceholders})`, targets.taskIds)
    : 0;
  const productCount = targets.productIds.length
    ? await countRows(database, `SELECT COUNT(*) AS count FROM products WHERE product_id IN (${productPlaceholders})`, targets.productIds)
    : 0;

  return {
    dryRun: true,
    ...targets,
    taskCount,
    orderCount,
    bidLogCount,
    biddingItemCount,
    orderStatusLogCount,
    productCount,
    totalCount: taskCount + orderCount + bidLogCount + biddingItemCount + orderStatusLogCount + productCount
  };
}

async function deleteRows(database, sql, params) {
  const result = await database.query(sql, params);
  return Number(result?.rowCount || 0);
}

async function runWonDateCleanup(database, cleanupDate) {
  const preview = await previewWonDateCleanup(database, cleanupDate);
  if (preview.totalCount === 0) return { ...preview, dryRun: false };

  const taskPlaceholders = preview.taskIds.length ? buildPlaceholders(preview.taskIds) : '';
  const orderPlaceholders = preview.orderIds.length ? buildPlaceholders(preview.orderIds) : '';
  const productPlaceholders = preview.productIds.length ? buildPlaceholders(preview.productIds) : '';

  const orderStatusLogCount = (preview.orderIds.length || preview.productIds.length)
    ? await deleteRows(
      database,
      `DELETE FROM order_status_change_logs
       WHERE ${[
        preview.orderIds.length ? `order_id IN (${orderPlaceholders})` : '',
        preview.productIds.length ? `product_id IN (${productPlaceholders})` : ''
      ].filter(Boolean).join(' OR ')}`,
      [...preview.orderIds, ...preview.productIds]
    )
    : 0;
  const bidLogCount = preview.taskIds.length
    ? await deleteRows(database, `DELETE FROM bid_logs WHERE task_id IN (${taskPlaceholders})`, preview.taskIds)
    : 0;
  const orderCount = preview.orderIds.length
    ? await deleteRows(database, `DELETE FROM orders WHERE id IN (${orderPlaceholders})`, preview.orderIds)
    : 0;
  const biddingItemCount = preview.productIds.length
    ? await deleteRows(database, `DELETE FROM bidding_items WHERE product_id IN (${productPlaceholders})`, preview.productIds)
    : 0;
  const taskCount = preview.taskIds.length
    ? await deleteRows(database, `DELETE FROM tasks WHERE id IN (${taskPlaceholders})`, preview.taskIds)
    : 0;
  const productCount = preview.productIds.length
    ? await deleteRows(database, `DELETE FROM products WHERE product_id IN (${productPlaceholders})`, preview.productIds)
    : 0;

  return {
    ...preview,
    dryRun: false,
    taskCount,
    orderCount,
    bidLogCount,
    biddingItemCount,
    orderStatusLogCount,
    productCount,
    totalCount: taskCount + orderCount + bidLogCount + biddingItemCount + orderStatusLogCount + productCount
  };
}

module.exports = {
  buildWonDateCleanupCutoff,
  collectWonDateCleanupTargets,
  previewWonDateCleanup,
  runWonDateCleanup
};
