function normalizeInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

function normalizeProductId(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeProductSnapshot(input = {}) {
  const productId = normalizeProductId(input.product_id ?? input.productId);
  if (!productId) return null;
  const hasTaxType = Object.prototype.hasOwnProperty.call(input, 'tax_type') ||
    Object.prototype.hasOwnProperty.call(input, 'taxType');
  const hasProductType = Object.prototype.hasOwnProperty.call(input, 'product_type') ||
    Object.prototype.hasOwnProperty.call(input, 'productType');
  return {
    product_id: productId,
    product_url: normalizeText(input.product_url ?? input.productUrl),
    product_title: normalizeText(input.product_title ?? input.productTitle ?? input.title),
    product_image_url: normalizeText(input.product_image_url ?? input.productImageUrl ?? input.imageUrl),
    current_price: normalizeInteger(input.current_price ?? input.currentPrice),
    buyout_price: normalizeInteger(input.buyout_price ?? input.buyoutPrice),
    bid_count: normalizeInteger(input.bid_count ?? input.bidCount) || 0,
    tax_type: hasTaxType ? normalizeText(input.tax_type ?? input.taxType) : null,
    product_type: hasProductType ? normalizeText(input.product_type ?? input.productType) : null,
    shipping_fee_text: normalizeText(input.shipping_fee_text ?? input.shippingFeeText),
    end_time: normalizeText(input.end_time ?? input.endTime)
  };
}

function backfillProductsFromExistingData(database) {
  return database.query(
    `INSERT INTO products (
       product_id,
       product_url,
       product_title,
       product_image_url,
       current_price,
       buyout_price,
       bid_count,
       tax_type,
       product_type,
       shipping_fee_text,
       end_time,
       last_fetched_at,
       last_scanned_at,
       created_at,
       updated_at
     )
     SELECT
       t.product_id,
       bi.product_url,
       NULLIF(bi.product_title, ''),
       NULLIF(bi.product_image_url, ''),
       bi.current_price,
       NULL,
       0,
       NULL,
       NULL,
       NULL,
       NULL,
       CURRENT_TIMESTAMP,
       CASE WHEN bi.product_id IS NOT NULL THEN COALESCE(bi.synced_at, bi.updated_at, CURRENT_TIMESTAMP) ELSE NULL END,
       COALESCE(t.created_at, CURRENT_TIMESTAMP),
       CURRENT_TIMESTAMP
     FROM tasks t
     JOIN (
       SELECT product_id, MAX(id) AS latest_task_id
       FROM tasks
       WHERE product_id IS NOT NULL AND product_id <> ''
       GROUP BY product_id
     ) latest_task ON latest_task.latest_task_id = t.id
     LEFT JOIN bidding_items bi ON bi.product_id = t.product_id
     WHERE t.product_id IS NOT NULL AND t.product_id <> ''
     ON CONFLICT(product_id) DO UPDATE SET
       product_url = COALESCE(excluded.product_url, products.product_url),
       product_title = COALESCE(NULLIF(products.product_title, ''), excluded.product_title),
       product_image_url = COALESCE(excluded.product_image_url, products.product_image_url),
       current_price = COALESCE(excluded.current_price, products.current_price),
       buyout_price = COALESCE(excluded.buyout_price, products.buyout_price),
       bid_count = COALESCE(excluded.bid_count, products.bid_count),
       tax_type = COALESCE(excluded.tax_type, products.tax_type),
       product_type = COALESCE(excluded.product_type, products.product_type),
       shipping_fee_text = COALESCE(excluded.shipping_fee_text, products.shipping_fee_text),
       end_time = COALESCE(excluded.end_time, products.end_time),
       last_fetched_at = COALESCE(excluded.last_fetched_at, products.last_fetched_at),
       last_scanned_at = COALESCE(excluded.last_scanned_at, products.last_scanned_at),
       updated_at = CURRENT_TIMESTAMP`
  );
}

function backfillOrderProductIds(database) {
  return database.query(
    `UPDATE orders
     SET product_id = (
           SELECT product_id FROM tasks WHERE tasks.id = orders.task_id LIMIT 1
         ),
         updated_at = CURRENT_TIMESTAMP
     WHERE product_id IS NULL
       AND task_id IS NOT NULL`
  );
}

function upsertProductSnapshot(database, input = {}, options = {}) {
  const snapshot = normalizeProductSnapshot(input);
  if (!snapshot) return { rows: [], rowCount: 0, skipped: true };
  const source = String(options.source || '').trim();
  const productTitleUpdate = options.overwriteProductTitle
    ? 'product_title = COALESCE(excluded.product_title, products.product_title)'
    : "product_title = COALESCE(NULLIF(products.product_title, ''), excluded.product_title)";
  return database.query(
    `INSERT INTO products (
       product_id,
       product_url,
       product_title,
       product_image_url,
       current_price,
       buyout_price,
       bid_count,
       tax_type,
       product_type,
       shipping_fee_text,
       end_time,
       last_fetched_at,
       last_scanned_at,
       created_at,
       updated_at
     )
     VALUES (
       ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
       CASE WHEN ? = 'fetch' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN ? = 'scan' THEN CURRENT_TIMESTAMP ELSE NULL END,
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
     )
     ON CONFLICT(product_id) DO UPDATE SET
       product_url = COALESCE(excluded.product_url, products.product_url),
       ${productTitleUpdate},
       product_image_url = COALESCE(excluded.product_image_url, products.product_image_url),
       current_price = COALESCE(excluded.current_price, products.current_price),
       buyout_price = COALESCE(excluded.buyout_price, products.buyout_price),
       bid_count = COALESCE(excluded.bid_count, products.bid_count),
       tax_type = COALESCE(excluded.tax_type, products.tax_type),
       product_type = COALESCE(excluded.product_type, products.product_type),
       shipping_fee_text = COALESCE(excluded.shipping_fee_text, products.shipping_fee_text),
       end_time = COALESCE(excluded.end_time, products.end_time),
       last_fetched_at = COALESCE(excluded.last_fetched_at, products.last_fetched_at),
       last_scanned_at = COALESCE(excluded.last_scanned_at, products.last_scanned_at),
       updated_at = CURRENT_TIMESTAMP`,
    [
      snapshot.product_id,
      snapshot.product_url,
      snapshot.product_title,
      snapshot.product_image_url,
      snapshot.current_price,
      snapshot.buyout_price,
      snapshot.bid_count,
      snapshot.tax_type,
      snapshot.product_type,
      snapshot.shipping_fee_text,
      snapshot.end_time,
      source,
      source
    ]
  );
}

module.exports = {
  normalizeProductSnapshot,
  backfillProductsFromExistingData,
  backfillOrderProductIds,
  upsertProductSnapshot
};
