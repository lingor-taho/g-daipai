function normalizeStatus(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeOrderIds(orderIds = []) {
  return Array.isArray(orderIds)
    ? [...new Set(orderIds.map(Number).filter(id => Number.isInteger(id) && id > 0))]
    : [];
}

async function getOrderStatusAuditRows(database, orderIds = []) {
  const ids = normalizeOrderIds(orderIds);
  if (!ids.length) return [];
  if (!database || typeof database.getAll !== 'function') return [];
  const placeholders = ids.map(() => '?').join(',');
  return database.getAll(
    `SELECT o.id AS order_id,
            o.order_status AS old_status,
            o.updated_at AS old_updated_at,
            o.final_price,
            o.won_at,
            o.won_time_text,
            o.bundle_shipping_fee_text,
            o.bundle_group_id,
            o.transaction_start_error,
            t.product_id,
            COALESCE(p.product_type, t.product_type) AS product_type,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text,
            COALESCE(p.tax_type, t.tax_type) AS tax_type
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE o.id IN (${placeholders})`,
    ids
  );
}

function resolveNewStatus(row, status, statusesByOrderId) {
  if (statusesByOrderId && Object.prototype.hasOwnProperty.call(statusesByOrderId, row.order_id)) {
    return normalizeStatus(statusesByOrderId[row.order_id]);
  }
  return normalizeStatus(status);
}

function buildMetadata(row, metadata) {
  const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
  return {
    ...base,
    auditSnapshot: {
      productId: row.product_id || null,
      productType: row.product_type || null,
      shippingFeeText: row.shipping_fee_text || null,
      bundleShippingFeeText: row.bundle_shipping_fee_text || null,
      bundleGroupId: row.bundle_group_id || null,
      taxType: row.tax_type || null,
      finalPrice: row.final_price ?? null,
      wonAt: row.won_at || null,
      wonTimeText: row.won_time_text || null,
      oldUpdatedAt: row.old_updated_at || null,
      transactionStartError: row.transaction_start_error || null
    }
  };
}

async function writeOrderStatusAuditLogs(database, beforeRows = [], options = {}) {
  const source = String(options.source || '').trim();
  if (!source) return { inserted: 0 };
  if (!database || typeof database.query !== 'function') return { inserted: 0 };
  let inserted = 0;
  for (const row of beforeRows || []) {
    const oldStatus = normalizeStatus(row.old_status);
    const newStatus = resolveNewStatus(row, options.status, options.statusesByOrderId);
    if (oldStatus === newStatus) continue;
    const metadata = JSON.stringify(buildMetadata(row, options.metadata));
    await database.query(
      `INSERT INTO order_status_change_logs (
         order_id, product_id, old_status, new_status, source, metadata, created_at
       )
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        row.order_id,
        row.product_id || null,
        oldStatus,
        newStatus,
        source,
        metadata
      ]
    );
    inserted += 1;
  }
  return { inserted };
}

async function backfillMissingOrderStatusAuditLogs(database, limit = 50) {
  if (!database || typeof database.getAll !== 'function' || typeof database.query !== 'function') {
    return { inserted: 0 };
  }
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            NULL AS old_status,
            o.order_status AS detected_status,
            o.updated_at AS old_updated_at,
            o.final_price,
            o.won_at,
            o.won_time_text,
            o.bundle_shipping_fee_text,
            o.bundle_group_id,
            o.transaction_start_error,
            t.product_id,
            COALESCE(p.product_type, t.product_type) AS product_type,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text,
            COALESCE(p.tax_type, t.tax_type) AS tax_type
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE o.order_status IS NOT NULL
       AND o.order_status <> ''
       AND NOT EXISTS (
         SELECT 1 FROM order_status_change_logs l WHERE l.order_id = o.id
       )
     ORDER BY datetime(COALESCE(o.updated_at, o.created_at)) DESC, o.id DESC
     LIMIT ?`,
    [Math.max(1, Math.min(Number(limit) || 50, 200))]
  );
  return writeOrderStatusAuditLogs(database, rows, {
    statusesByOrderId: Object.fromEntries(rows.map(row => [row.order_id, row.detected_status])),
    source: 'unlogged_existing_status',
    metadata: {
      reason: 'order had status but no audit log when admin orders list was loaded'
    }
  });
}

module.exports = {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs,
  backfillMissingOrderStatusAuditLogs
};
