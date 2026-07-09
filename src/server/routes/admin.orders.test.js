const assert = require('assert/strict');
const {
  applyUserFinanceConfig,
  calculateOrderPayable,
  canSettleShippingFeeText,
  buildOrderSettlement,
  buildAdminTasksListQuery,
  buildAdminPendingTasksQuery,
  buildAdminOrdersListQuery,
  buildAdminOrdersUserWonDateRangeQuery,
  buildOrderStatusDebugOrdersQuery,
  buildOrderStatusDebugTasksQuery,
  buildProductDebugTasksQuery,
  buildProductDebugBidLogsQuery,
  buildProductDebugOrdersQuery,
  buildProductDebugOrderLogsQuery,
  buildProductDebugDiagnosticsQuery,
  buildProductDebugSnapshotQuery,
  buildProductDebugBiddingItemsQuery,
  buildProductDebugConfigQuery,
  buildTrustedInputReportQueries,
  buildBidFailureReportQueries,
  buildRecentTaskFailureUserReportQuery,
  buildAdminMessagesListQuery,
  buildOrderSettlementSelectQuery,
  buildOrderSettlementUpdateQuery,
  buildAdminLogsQuery,
  mapAdminOrderListItem,
  updateOrderRemark,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_PENDING_PAYMENT,
  normalizeProductType,
  parseShippingFeeToNumber,
  createManualOrderImportBatch,
  confirmManualOrderImport,
  deleteManualOrderImportBatch,
  requestScan,
  requestPayment,
  clearPaymentAlertAndContinue,
  normalizeOrderStatusRefreshTarget,
  normalizePositiveIntegerConfig,
  deleteProductDataByProductId,
  reassignOrderOwner,
  buildGoogleSheetUrl,
  parseStoreBundleChildProductIds,
  normalizeManualOrderImportSummary,
  backfillStoreBundle,
  markProductOrdersForResync,
  markTrackingRescanByProductId,
  refreshProductShippingFee,
  refreshProductType,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_BUNDLE_COMPLETED
} = require('./admin');

function testShippingFeeParsing() {
  assert.equal(parseShippingFeeToNumber('送料 無料'), 0);
  assert.equal(parseShippingFeeToNumber('送料 着払い'), 0);
  assert.equal(parseShippingFeeToNumber('送料 落札者負担'), 0);
  assert.equal(parseShippingFeeToNumber('送料 1,000円'), 1000);
}

function testBuildGoogleSheetUrl() {
  assert.equal(
    buildGoogleSheetUrl('1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4'),
    'https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0'
  );
  assert.equal(buildGoogleSheetUrl(''), '');
}

function testBuildTrustedInputReportQueries() {
  const queries = buildTrustedInputReportQueries({ current: '2', pageSize: '25', level: 'error' });
  assert.match(queries.summary.sql, /FROM plugin_diagnostics/);
  assert.match(queries.summary.sql, /type = 'trusted_input'/);
  assert.match(queries.summary.sql, /level = \?/);
  assert.deepEqual(queries.summary.params, ['error']);
  assert.match(queries.byAction.sql, /GROUP BY action, method/);
  assert.match(queries.byMethod.sql, /GROUP BY method, level/);
  assert.match(queries.rows.sql, /ORDER BY datetime\(created_at\) DESC, id DESC/);
  assert.deepEqual(queries.rows.params, ['error', 25, 25]);
  assert.deepEqual(queries.count.params, ['error']);
  assert.equal(queries.pagination.current, 2);
  assert.equal(queries.pagination.pageSize, 25);
}

function testBuildBidFailureReportQueries() {
  const queries = buildBidFailureReportQueries({
    current: '3',
    pageSize: '10',
    action: 'bid_timeout',
    method: 'background',
    productId: 'W1233744381',
    message: 'timeout'
  });
  assert.match(queries.summary.sql, /FROM plugin_diagnostics/);
  assert.match(queries.summary.sql, /type = 'bid_failure'/);
  assert.match(queries.summary.sql, /action = \?/);
  assert.match(queries.summary.sql, /method = \?/);
  assert.match(queries.summary.sql, /product_id = \?/);
  assert.match(queries.summary.sql, /message LIKE \?/);
  assert.deepEqual(queries.summary.params, ['bid_timeout', 'background', 'w1233744381', '%timeout%']);
  assert.match(queries.byAction.sql, /GROUP BY action, message/);
  assert.match(queries.byStage.sql, /stage/);
  assert.match(queries.rows.sql, /ORDER BY datetime\(created_at\) DESC, id DESC/);
  assert.deepEqual(queries.rows.params, ['bid_timeout', 'background', 'w1233744381', '%timeout%', 10, 20]);
  assert.deepEqual(queries.count.params, ['bid_timeout', 'background', 'w1233744381', '%timeout%']);
  assert.equal(queries.pagination.current, 3);
  assert.equal(queries.pagination.pageSize, 10);
}

function testBuildRecentTaskFailureUserReportQuery() {
  const query = buildRecentTaskFailureUserReportQuery({});
  assert.match(query.sql, /FROM tasks t/);
  assert.match(query.sql, /LEFT JOIN users u ON u\.id = t\.user_id/);
  assert.match(query.sql, /t\.status = 'failed'/);
  assert.match(query.sql, /datetime\('now', \? \|\| ' days'\)/);
  assert.match(query.sql, /timeout_count/);
  assert.match(query.sql, /system_count/);
  assert.match(query.sql, /GROUP BY t\.user_id, u\.username/);
  assert.deepEqual(query.params, [-5]);
}

function testBuildAdminMessagesListQueryFiltersWonOrdersAndMessageStatus() {
  const query = buildAdminMessagesListQuery({
    current: '2',
    pageSize: '25',
    username: 'stone',
    productId: 'M1233870776',
    wonFrom: '2026-06-24',
    wonTo: '2026-06-25'
  });

  assert.match(query.rows.sql, /FROM orders o/);
  assert.match(query.rows.sql, /INNER JOIN tasks t ON o\.task_id = t\.id/);
  assert.match(query.rows.sql, /LEFT JOIN products p ON p\.product_id = COALESCE\(o\.product_id, t\.product_id\)/);
  assert.match(query.rows.sql, /LEFT JOIN yahoo_trade_messages m ON m\.order_id = o\.id/);
  assert.match(query.rows.sql, /o\.order_status/);
  assert.match(query.rows.sql, /u\.username LIKE \?/);
  assert.match(query.rows.sql, /LOWER\(COALESCE\(o\.product_id, t\.product_id\)\) = \?/);
  assert.match(query.rows.sql, /substr\(COALESCE\(o\.won_at, ''\), 1, 10\) >= \?/);
  assert.match(query.rows.sql, /substr\(COALESCE\(o\.won_at, ''\), 1, 10\) <= \?/);
  assert.match(query.rows.sql, /ORDER BY datetime\(COALESCE\(o\.won_at, t\.updated_at\)\) DESC, o\.id DESC/);
  assert.deepEqual(query.rows.params, ['%stone%', 'm1233870776', '2026-06-24', '2026-06-25', 25, 25]);
  assert.deepEqual(query.count.params, ['%stone%', 'm1233870776', '2026-06-24', '2026-06-25']);
  assert.equal(query.pagination.current, 2);
  assert.equal(query.pagination.pageSize, 25);
}

function testParseStoreBundleChildProductIdsAcceptsFullAndHalfCommas() {
  assert.deepEqual(
    parseStoreBundleChildProductIds('s123456789，S123456780, https://auctions.yahoo.co.jp/jp/auction/s123456781, s123456789'),
    ['s123456789', 's123456780', 's123456781']
  );
}

function testManualOrderImportSummarySeparatesEmptyReadyBatches() {
  assert.deepEqual(
    normalizeManualOrderImportSummary({
      requested: 2,
      scanning: 0,
      ready: 0,
      ready_empty: 1
    }),
    {
      flag: 1,
      requested: 2,
      scanning: 0,
      ready: 0,
      readyEmpty: 1
    }
  );
}

async function testConfirmManualOrderImportSkipsUnassignedItems() {
  const queries = [];
  const fakeDb = {
    async getOne(sql, params) {
      if (/FROM manual_order_import_batches/.test(sql)) return { id: 9, status: 'ready' };
      if (/COUNT\(\*\) AS count/.test(sql)) return { count: 1 };
      if (/FROM orders o/.test(sql)) return null;
      if (/last_insert_rowid/.test(sql)) return { id: queries.length };
      throw new Error(`unexpected getOne: ${sql} ${JSON.stringify(params || [])}`);
    },
    async getAll(sql) {
      if (/FROM manual_order_import_items/.test(sql)) {
        return [
          {
            id: 1,
            product_id: 'a100000001',
            assigned_user_id: 8,
            final_price: 1200,
            product_title: 'assigned item'
          }
        ];
      }
      return [];
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await confirmManualOrderImport(9, [], fakeDb);

  assert.equal(result.imported, 1);
  assert.equal(result.skippedUnassigned, 1);
  assert.equal(queries.some(query => /INSERT INTO products/.test(query.sql)), true);
  assert.equal(queries.some(query => /INSERT INTO tasks/.test(query.sql)), true);
  const orderInsert = queries.find(query => /INSERT INTO orders/.test(query.sql));
  assert.ok(orderInsert);
  assert.match(orderInsert.sql, /product_id/);
  assert.doesNotMatch(orderInsert.sql, /product_title|product_url/);
  assert.equal(queries.some(query => /status = 'confirmed'/.test(query.sql)), true);
  assert.equal(
    queries.some(query => query.params?.[0] === 'transaction_start_requested' || query.params?.[0] === 'transaction_start_requested_source'),
    false
  );
}

function testSettleableShippingFeeDetection() {
  assert.equal(canSettleShippingFeeText('送料 無料'), true);
  assert.equal(canSettleShippingFeeText('全国一律 230円'), true);
  assert.equal(canSettleShippingFeeText('送料 着払い'), true);
  assert.equal(canSettleShippingFeeText('送料 落札者負担'), false);
  assert.equal(canSettleShippingFeeText('待定'), false);
}

function testStoreBidderPaysShippingCanSettleAsFree() {
  const result = buildOrderSettlement({
    order: {
      final_price: 300,
      tax_type: 'tax_included',
      product_type: 'store',
      shipping_fee_text: '送料 落札者負担'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 0,
      handlingFeeCny: 0,
      largeAmountFeeCny: 0
    },
    userFinanceOverride: null
  });

  assert.equal(result.shippingFeeJpy, 0);
  assert.equal(result.payableCny, 15);
}

function testNormalBidderPaysShippingStillCannotSettle() {
  assert.throws(() => buildOrderSettlement({
    order: {
      final_price: 300,
      tax_type: 'tax_zero',
      product_type: 'normal',
      shipping_fee_text: '送料 落札者負担'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 0,
      handlingFeeCny: 0,
      largeAmountFeeCny: 0
    },
    userFinanceOverride: null
  }), /运费无法确认/);
}

function testLargeAmountFeeOnlyAppliesAtTaxIncludedThirtyThousand() {
  const config = {
    rate: 0.05,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 20
  };

  assert.deepEqual(
    calculateOrderPayable({
      finalPrice: 30000,
      taxType: 'tax_zero',
      shippingFeeText: '送料 1,000円',
      config
    }),
    {
      finalPrice: 30000,
      taxIncludedFinalPrice: 30000,
      shippingFee: 1000,
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20,
      largeAmountFeeApplied: true,
      payableCny: 1610
    }
  );

  const belowThreshold = calculateOrderPayable({
    finalPrice: 29990,
    taxType: 'tax_zero',
    shippingFeeText: '送料 1,000円',
    config
  });
  assert.equal(belowThreshold.largeAmountFeeApplied, false);
  assert.equal(belowThreshold.largeAmountFeeCny, 0);
  assert.equal(belowThreshold.payableCny, 1589.5);
}

function testStoreTaxIncludedThresholdUsesTaxIncludedPrice() {
  const result = calculateOrderPayable({
    finalPrice: 28000,
    taxType: 'tax_included',
    shippingFeeText: '送料 無料',
    config: {
      rate: 0.05,
      bankFeeJpy: 0,
      handlingFeeCny: 0,
      largeAmountFeeCny: 30
    }
  });

  assert.equal(result.taxIncludedFinalPrice, 30800);
  assert.equal(result.largeAmountFeeApplied, true);
  assert.equal(result.payableCny, 1430);
}

function testSpecialUserConfigOverridesOnlyConfiguredValues() {
  const config = applyUserFinanceConfig(
    {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    {
      rate_adjustment: -0.01,
      bank_fee_jpy: 300,
      handling_fee_cny: null,
      large_amount_fee_cny: 50
    }
  );

  assert.deepEqual(config, {
    rate: 0.04,
    rateAdjustment: -0.01,
    bankFeeJpy: 300,
    handlingFeeCny: 15,
    largeAmountFeeCny: 50,
    hasUserFinanceOverride: true
  });
}

function testBuildOrderSettlementUsesSubmittedRateAndOverrides() {
  const result = buildOrderSettlement({
    order: {
      final_price: 20000,
      tax_type: 'tax_zero',
      shipping_fee_text: '送料 1,000円'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    userFinanceOverride: {
      rate_adjustment: 0.01,
      bank_fee_jpy: 100,
      handling_fee_cny: null,
      large_amount_fee_cny: null
    }
  });

  assert.deepEqual(result, {
    shippingFeeJpy: 1000,
    bankFeeJpy: 100,
    handlingFeeCny: 15,
    largeAmountFeeCny: 0,
    largeAmountFeeApplied: false,
    taxIncludedFinalPrice: 20000,
    jpyToCnyRate: 0.06,
    rateAdjustment: 0.01,
    hasUserFinanceOverride: true,
    payableCny: 1281
  });
}

function testBuildOrderSettlementPrefersBundleShippingFee() {
  const result = buildOrderSettlement({
    order: {
      final_price: 10000,
      tax_type: 'tax_zero',
      shipping_fee_text: '送料 1,000円',
      bundle_shipping_fee_text: '0円'
    },
    baseConfig: {
      rate: 0.05,
      bankFeeJpy: 500,
      handlingFeeCny: 15,
      largeAmountFeeCny: 20
    },
    userFinanceOverride: null
  });

  assert.equal(result.shippingFeeJpy, 0);
  assert.equal(result.payableCny, 540);
}

function testNormalizeProductTypeForBatchRefresh() {
  assert.equal(normalizeProductType('normal'), 'normal');
  assert.equal(normalizeProductType('store'), 'store');
  assert.equal(normalizeProductType('tax_zero'), 'normal');
  assert.equal(normalizeProductType('tax_included'), 'store');
  assert.equal(normalizeProductType(''), '');
}

function testAdminTasksListQueryUsesProductsOnly() {
  const query = buildAdminTasksListQuery({ pageSize: 20, offset: 40 });

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_title AS product_title/);
  assert.match(query.sql, /p\.product_image_url AS product_image_url/);
  assert.match(query.sql, /p\.current_price AS current_price/);
  assert.match(query.sql, /p\.buyout_price AS buyout_price/);
  assert.match(query.sql, /p\.tax_type AS tax_type/);
  assert.match(query.sql, /p\.product_type AS product_type/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.match(query.sql, /p\.end_time AS end_time/);
  assert.doesNotMatch(query.sql, /t\.(product_url|product_title|product_image_url|current_price|buyout_price|bid_count|tax_type|product_type|shipping_fee_text|end_time)/);
  assert.deepEqual(query.params, [20, 40]);
}

function testAdminPendingTasksQueryUsesProductsOnly() {
  const query = buildAdminPendingTasksQuery();

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_title AS product_title/);
  assert.match(query.sql, /CASE WHEN COALESCE\(t\.bid_mode, 'bid'\) = 'buyout'/);
  assert.match(query.sql, /THEN COALESCE\(t\.user_max_price, t\.max_price\)/);
  assert.match(query.sql, /p\.end_time AS end_time/);
  assert.doesNotMatch(query.sql, /t\.(product_title|buyout_price|end_time)/);
  assert.match(query.sql, /WHERE t\.status = 'pending' OR \(t\.status = 'bidding' AND t\.strategy = 'multi_bid'\)/);
}

function testAdminOrdersQueryIncludesProductType() {
  const query = buildAdminOrdersListQuery({ pageSize: 10, offset: 0 });

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_title AS product_title/);
  assert.match(query.sql, /p\.product_url AS product_url/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.match(query.sql, /o\.order_remark/);
  assert.match(query.sql, /COALESCE\(p\.tax_type, 'tax_zero'\) AS tax_type/);
  assert.match(query.sql, /COALESCE\(p\.product_type, CASE WHEN COALESCE\(p\.tax_type, 'tax_zero'\) = 'tax_included' THEN 'store' ELSE 'normal' END\) AS product_type/);
  assert.doesNotMatch(query.sql, /t\.(product_url|shipping_fee_text|tax_type|product_type)/);
  assert.match(query.sql, /ORDER BY datetime\(COALESCE\(o\.won_at, t\.updated_at\)\) DESC, t\.id DESC/);
  assert.deepEqual(query.params, [10, 0]);
}

function testMapAdminOrderListItemKeepsOrderRemark() {
  const mapped = mapAdminOrderListItem({
    id: 100,
    product_id: 'r123456789',
    product_url: '',
    shipping_fee_text: '無料',
    settled_at: null,
    username: 'remark-user',
    order_status: 'pending_receipt',
    order_remark: 'ship with invoice'
  });

  assert.equal(mapped.order_remark, 'ship with invoice');
}

async function testUpdateOrderRemarkStoresTrimmedRemark() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await updateOrderRemark(fakeDb, { orderId: 77, remark: '  fragile\nbox  ' });

  assert.equal(result.id, 77);
  assert.equal(result.order_remark, 'fragile\nbox');
  assert.match(calls[0].sql, /UPDATE orders/);
  assert.match(calls[0].sql, /order_remark = \?/);
  assert.deepEqual(calls[0].params, ['fragile\nbox', 77]);
}

async function testUpdateOrderRemarkRejectsMissingOrder() {
  const fakeDb = {
    async query() {
      return { rowCount: 0 };
    }
  };

  await assert.rejects(
    () => updateOrderRemark(fakeDb, { orderId: 404, remark: 'missing' }),
    error => error.statusCode === 404 && /order not found/.test(error.message)
  );
}

function testAdminOrdersUserWonDateRangeQueryUsesWonAtOnly() {
  const query = buildAdminOrdersUserWonDateRangeQuery({
    userId: 12,
    fromDate: '2026-06-09',
    toDate: '2026-06-10'
  });

  assert.match(query.sql, /u\.id = \?/);
  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_title AS product_title/);
  assert.match(query.sql, /p\.product_url AS product_url/);
  assert.match(query.sql, /o\.order_remark/);
  assert.doesNotMatch(query.sql, /o\.product_title/);
  assert.doesNotMatch(query.sql, /o\.product_url/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.match(query.sql, /COALESCE\(p\.tax_type, 'tax_zero'\) AS tax_type/);
  assert.match(query.sql, /COALESCE\(p\.product_type, CASE WHEN COALESCE\(p\.tax_type, 'tax_zero'\) = 'tax_included' THEN 'store' ELSE 'normal' END\) AS product_type/);
  assert.doesNotMatch(query.sql, /t\.(product_url|shipping_fee_text|tax_type|product_type)/);
  assert.match(query.sql, /substr\(COALESCE\(o\.won_at, ''\), 1, 10\) >= \?/);
  assert.match(query.sql, /substr\(COALESCE\(o\.won_at, ''\), 1, 10\) <= \?/);
  assert.doesNotMatch(query.sql, /created_at/);
  assert.doesNotMatch(query.sql, /LIMIT/);
  assert.deepEqual(query.params, [12, '2026-06-09', '2026-06-10']);
}

function testOrderStatusDebugOrdersQueryUsesProductsOnly() {
  const query = buildOrderStatusDebugOrdersQuery('a123456789');

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_type AS product_type/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.doesNotMatch(query.sql, /t\.(product_type|shipping_fee_text)/);
  assert.deepEqual(query.params, ['a123456789']);
}

function testOrderStatusDebugTasksQueryUsesProductsOnly() {
  const query = buildOrderStatusDebugTasksQuery('a123456789');

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_type AS product_type/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.doesNotMatch(query.sql, /t\.(product_type|shipping_fee_text)/);
  assert.deepEqual(query.params, ['a123456789']);
}

function testProductDebugQueriesExposeTaskErrorsAndRelatedLogs() {
  const tasksQuery = buildProductDebugTasksQuery('u1051658399');
  assert.match(tasksQuery.sql, /t\.error_msg/);
  assert.match(tasksQuery.sql, /t\.max_price/);
  assert.match(tasksQuery.sql, /t\.user_max_price/);
  assert.match(tasksQuery.sql, /p\.current_price AS product_current_price/);
  assert.match(tasksQuery.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.doesNotMatch(tasksQuery.sql, /t\.(product_url|product_title|product_image_url|current_price|buyout_price|bid_count|tax_type|product_type|shipping_fee_text|end_time)/);
  assert.deepEqual(tasksQuery.params, ['u1051658399']);

  const bidLogsQuery = buildProductDebugBidLogsQuery('u1051658399');
  assert.match(bidLogsQuery.sql, /FROM bid_logs bl/);
  assert.match(bidLogsQuery.sql, /bl\.error_msg/);
  assert.match(bidLogsQuery.sql, /INNER JOIN tasks t ON t\.id = bl\.task_id/);
  assert.deepEqual(bidLogsQuery.params, ['u1051658399']);

  const ordersQuery = buildProductDebugOrdersQuery('u1051658399');
  assert.match(ordersQuery.sql, /FROM orders o/);
  assert.match(ordersQuery.sql, /o\.transaction_start_error/);
  assert.deepEqual(ordersQuery.params, ['u1051658399', 'u1051658399']);

  const orderLogsQuery = buildProductDebugOrderLogsQuery('u1051658399');
  assert.match(orderLogsQuery.sql, /FROM order_status_change_logs l/);
  assert.match(orderLogsQuery.sql, /l\.metadata/);
  assert.deepEqual(orderLogsQuery.params, ['u1051658399', 'u1051658399', 'u1051658399']);

  const diagnosticsQuery = buildProductDebugDiagnosticsQuery('u1051658399');
  assert.match(diagnosticsQuery.sql, /FROM plugin_diagnostics/);
  assert.match(diagnosticsQuery.sql, /diagnostics/);
  assert.deepEqual(diagnosticsQuery.params, ['u1051658399', 'u1051658399', 'u1051658399']);

  assert.match(buildProductDebugSnapshotQuery('u1051658399').sql, /FROM products/);
  const biddingItemsQuery = buildProductDebugBiddingItemsQuery('u1051658399');
  assert.match(biddingItemsQuery.sql, /FROM bidding_items/);
  assert.doesNotMatch(biddingItemsQuery.sql, /\bid\b/);
  assert.match(biddingItemsQuery.sql, /product_id DESC/);
  assert.match(buildProductDebugConfigQuery().sql, /yahoo_login_status/);
}

function testOrderSettlementSelectQueryUsesProductsOnly() {
  const query = buildOrderSettlementSelectQuery(123);

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = COALESCE\(o\.product_id, t\.product_id\)/);
  assert.match(query.sql, /p\.shipping_fee_text AS shipping_fee_text/);
  assert.match(query.sql, /COALESCE\(p\.tax_type, 'tax_zero'\) AS tax_type/);
  assert.match(query.sql, /COALESCE\(p\.product_type, CASE WHEN COALESCE\(p\.tax_type, 'tax_zero'\) = 'tax_included' THEN 'store' ELSE 'normal' END\) AS product_type/);
  assert.doesNotMatch(query.sql, /t\.(shipping_fee_text|tax_type|product_type)/);
  assert.deepEqual(query.params, [123]);
}

function testOrderSettlementUpdateDoesNotChangeOrderStatus() {
  const query = buildOrderSettlementUpdateQuery(123, {
    jpyToCnyRate: 0.0523,
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    largeAmountFeeCny: 20,
    largeAmountFeeApplied: true,
    taxIncludedFinalPrice: 11000,
    hasUserFinanceOverride: false,
    payableCny: 631
  });

  assert.match(query.sql, /UPDATE orders/);
  assert.doesNotMatch(query.sql, /order_status\s*=/);
  assert.match(query.sql, /settled_at = CURRENT_TIMESTAMP/);
  assert.deepEqual(query.params, [
    0.0523,
    500,
    15,
    20,
    1,
    11000,
    0,
    631,
    123
  ]);
}

function testAdminLogsQueryUsesProductTitleFallback() {
  const query = buildAdminLogsQuery({ pageSize: 50, offset: 100 });

  assert.match(query.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(query.sql, /p\.product_title AS product_title/);
  assert.doesNotMatch(query.sql, /t\.product_title/);
  assert.deepEqual(query.params, [50, 100]);
}

function testMapAdminOrderListItemUsesEffectiveBundleShipping() {
  const item = {
    product_id: 'x123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/x123456789',
    shipping_fee_text: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5',
    bundle_shipping_fee_text: '110\u5186',
    settled_at: '2026-06-03T00:00:00.000Z',
    bank_fee_jpy: 500,
    handling_fee_cny: 15,
    large_amount_fee_cny: 0,
    large_amount_fee_applied: 0,
    tax_included_final_price: 10000,
    jpy_to_cny_rate: 0.05,
    rate_adjustment: 0,
    has_user_finance_override: 0,
    total_amount_cny: 545,
    order_status: 'pending_settlement',
    transaction_start_error: null
  };

  const mapped = mapAdminOrderListItem(item);

  assert.equal(mapped.shipping_fee_text, '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5');
  assert.equal(mapped.effective_shipping_fee_text, '110\u5186');
  assert.equal(mapped.can_settle, true);
  assert.equal(mapped.shipping_fee_jpy, 110);
  assert.equal(mapped.bundle_shipping_fee_text, '110\u5186');
}

function testMapAdminOrderListItemAllowsStoreBidderPaysShipping() {
  const mapped = mapAdminOrderListItem({
    id: 99,
    product_id: 'q1175609593',
    product_type: 'store',
    shipping_fee_text: '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5',
    bundle_shipping_fee_text: '',
    settled_at: null,
    username: 'user',
    product_url: '',
    final_price: 300,
    order_status: 'pending_shipment'
  });

  assert.equal(mapped.effective_shipping_fee_text, '\u9001\u6599 \u843d\u672d\u8005\u8ca0\u62c5');
  assert.equal(mapped.can_settle, true);
}

function testSettlementStatusUsesPendingSettlement() {
  assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
}

function testCompletedOrderStatusConstant() {
  assert.equal(ORDER_STATUS_COMPLETED, 'completed');
}

function testNormalizeOrderStatusRefreshTargetSupportsAllowedTargets() {
  assert.equal(normalizeOrderStatusRefreshTarget('blank'), null);
  assert.equal(normalizeOrderStatusRefreshTarget('completed'), ORDER_STATUS_COMPLETED);
  assert.equal(normalizeOrderStatusRefreshTarget('pending_shipment'), ORDER_STATUS_PENDING_SHIPMENT);
}

function testNormalizeOrderStatusRefreshTargetRejectsUnknownStatus() {
  assert.throws(() => normalizeOrderStatusRefreshTarget('pending_payment'), /invalid orderStatus/);
}

function testNormalizePositiveIntegerConfig() {
  assert.equal(normalizePositiveIntegerConfig('4', 3), 4);
  assert.equal(normalizePositiveIntegerConfig('0', 3), 3);
  assert.equal(normalizePositiveIntegerConfig('abc', 3), 3);
}

async function testRequestScanSetsCounterToConfiguredEveryRuns() {
  const queries = [];
  const fakeDb = {
    async getOne(sql) {
      assert.match(sql, /scan_every_idle_runs/);
      return { value: '7' };
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await requestScan(fakeDb);

  assert.equal(result.scanIdleCounter, 7);
  assert.match(queries[0].sql, /scan_idle_counter/);
  assert.equal(queries[0].params[0], '7');
}

async function testCreateManualOrderImportBatchDoesNotMutateScanCounter() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    },
    async getOne(sql) {
      assert.match(sql, /last_insert_rowid/);
      return { id: 4 };
    }
  };

  const result = await createManualOrderImportBatch({
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    maxPages: 10
  }, fakeDb);

  assert.deepEqual(result, {
    id: 4,
    startDate: '2026-06-10',
    endDate: '2026-06-11',
    maxPages: 10,
    requested: 1
  });
  assert.match(queries[0].sql, /manual_order_import_batches/);
  assert.equal(queries.length, 1);
}

async function testConfirmManualOrderImportRejectsAdminUserAssignment() {
  const fakeDb = {
    async getOne(sql) {
      if (/FROM manual_order_import_batches/.test(sql)) return { id: 9, status: 'ready' };
      if (/FROM users/.test(sql)) return null;
      throw new Error(`unexpected getOne: ${sql}`);
    },
    async query() {
      throw new Error('should not update import assignment');
    }
  };

  await assert.rejects(
    () => confirmManualOrderImport(9, [{ itemId: 1, userId: 3 }], fakeDb),
    /assigned user must be normal or agent user/
  );
}

async function testDeleteManualOrderImportBatchDeletesBatchAndItems() {
  const queries = [];
  const fakeDb = {
    async getOne(sql, params) {
      if (/FROM manual_order_import_batches/.test(sql)) return { id: Number(params[0]), status: 'confirmed' };
      throw new Error(`unexpected getOne: ${sql}`);
    },
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await deleteManualOrderImportBatch(9, fakeDb);

  assert.deepEqual(result, { deleted: 1, id: 9 });
  assert.match(queries[0].sql, /DELETE FROM manual_order_import_items/);
  assert.equal(queries[0].params[0], 9);
  assert.match(queries[1].sql, /DELETE FROM manual_order_import_batches/);
  assert.equal(queries[1].params[0], 9);
}

async function testDeleteManualOrderImportBatchRejectsMissingBatch() {
  const fakeDb = {
    async getOne() {
      return null;
    },
    async query() {
      throw new Error('should not delete missing import batch');
    }
  };

  await assert.rejects(
    () => deleteManualOrderImportBatch(99, fakeDb),
    /import batch not found/
  );
}

async function testRequestPaymentSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await requestPayment(fakeDb, [1, 2]);

  assert.equal(result.requested, 1);
  assert.match(queries[0].sql, /order_status = \?/);
  assert.match(queries[0].sql, /order_status IN \(\?,\?\)/);
  assert.match(queries[0].sql, /settled_at IS NOT NULL/);
  assert.equal(queries[0].params[0], 'pending_settlement');
  assert.deepEqual(queries[0].params.slice(-2), [
    ORDER_STATUS_PENDING_PAYMENT,
    ORDER_STATUS_PENDING_SETTLEMENT
  ]);
  assert.equal(queries[0].params.includes(ORDER_STATUS_BUNDLE_COMPLETED), false);
  assert.equal(queries[0].params.includes(ORDER_STATUS_PENDING_SHIPMENT), false);
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}

async function testRequestPaymentDoesNotSetFlagWhenNoPendingSettlementRows() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: /UPDATE orders/.test(sql) ? 0 : 1 };
    }
  };

  const result = await requestPayment(fakeDb, [3]);

  assert.equal(result.requested, 0);
  assert.match(queries[0].sql, /order_status = \?/);
  assert.equal(queries[0].params[0], 'pending_settlement');
  assert.equal(queries.length, 1);
}

async function testClearPaymentAlertAndContinueClearsMessageAndSetsFlag() {
  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await clearPaymentAlertAndContinue(fakeDb);

  assert.equal(result.success, true);
  assert.match(queries[0].sql, /payment_alert_message/);
  assert.equal(queries[0].params[0], '');
  assert.match(queries[1].sql, /payment_requested/);
  assert.equal(queries[1].params[0], '1');
}

async function testDeleteProductDataRemovesTaskOrderAndBiddingAssociations() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/FROM tasks/.test(sql)) {
        return [{ id: 276 }, { id: 277 }];
      }
      if (/FROM orders/.test(sql)) {
        return [{ id: 67 }, { id: 68 }];
      }
      return [];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      if (/order_status_change_logs/.test(sql)) return { rowCount: 3 };
      if (/bid_logs/.test(sql)) return { rowCount: 2 };
      if (/orders/.test(sql)) return { rowCount: 2 };
      if (/bidding_items/.test(sql)) return { rowCount: 1 };
      if (/tasks/.test(sql)) return { rowCount: 2 };
      if (/products/.test(sql)) return { rowCount: 1 };
      return { rowCount: 0 };
    }
  };

  const result = await deleteProductDataByProductId(fakeDb, 'v1231866422');

  assert.equal(result.success, true);
  assert.equal(result.taskCount, 2);
  assert.equal(result.orderCount, 2);
  assert.equal(result.bidLogCount, 2);
  assert.equal(result.biddingItemCount, 1);
  assert.equal(result.productCount, 1);
  assert.equal(result.orderStatusLogCount, 3);
  assert.equal(result.totalCount, 11);
  assert.equal(calls[0].params[0], 'v1231866422');
  assert.match(calls[2].sql, /DELETE FROM order_status_change_logs/);
  assert.match(calls[3].sql, /DELETE FROM bid_logs/);
  assert.match(calls[4].sql, /DELETE FROM orders/);
  assert.match(calls[5].sql, /DELETE FROM bidding_items/);
  assert.match(calls[6].sql, /DELETE FROM tasks/);
  assert.match(calls[7].sql, /DELETE FROM products WHERE product_id = \?/);
  assert.deepEqual(calls[7].params, ['v1231866422']);
}

async function testBackfillStoreBundleMarksMainPendingShipmentAndChildrenCompleted() {
  const calls = [];
  const rows = [
    { order_id: 101, order_status: 'pending_payment', product_id: 's100000001', product_type: 'store' },
    { order_id: 102, order_status: 'pending_payment', product_id: 's100000002', product_type: 'store' },
    { order_id: 103, order_status: 'pending_settlement', product_id: 's100000003', product_type: 'store' }
  ];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/SELECT o\.id AS order_id/.test(sql) && /LOWER\(t\.product_id\)/.test(sql)) return rows;
      if (/old_status/.test(sql)) return rows.map(row => ({
        ...row,
        old_status: row.order_status,
        product_type: row.product_type,
        shipping_fee_text: '送料 230円'
      }));
      return [];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /INSERT INTO order_status_change_logs/.test(sql) ? 1 : 1 };
    }
  };

  const result = await backfillStoreBundle(fakeDb, {
    mainProductId: 's100000001',
    childProductIds: 's100000002，s100000003',
    bundleShippingFee: 780
  }, { nowMs: 12345 });

  assert.equal(result.mainProductId, 's100000001');
  assert.deepEqual(result.childProductIds, ['s100000002', 's100000003']);
  assert.equal(result.bundleShippingFeeText, '780円');
  assert.equal(result.bundleGroupId, 'store-bundle-s100000001-12345');
  const selectCall = calls.find(call => call.type === 'getAll' && /LOWER\(t\.product_id\)/.test(call.sql));
  assert.match(selectCall.sql, /LEFT JOIN products p ON p\.product_id = t\.product_id/);
  assert.match(selectCall.sql, /COALESCE\(p\.product_type, CASE WHEN COALESCE\(p\.tax_type, 'tax_zero'\) = 'tax_included' THEN 'store' ELSE 'normal' END\) AS product_type/);
  assert.doesNotMatch(selectCall.sql, /t\.(product_type|tax_type)/);
  const mainUpdate = calls.find(call => call.type === 'query' && /WHERE id = \?/.test(call.sql) && /bundle_shipping_fee_text = \?/.test(call.sql));
  assert.deepEqual(mainUpdate.params, ['store-bundle-s100000001-12345', '780円', ORDER_STATUS_PENDING_SHIPMENT, 101]);
  const childUpdate = calls.find(call => call.type === 'query' && /WHERE id IN/.test(call.sql));
  assert.deepEqual(childUpdate.params, ['store-bundle-s100000001-12345', ORDER_STATUS_BUNDLE_COMPLETED, 102, 103]);
  const auditCalls = calls.filter(call => call.type === 'query' && /INSERT INTO order_status_change_logs/.test(call.sql));
  assert.equal(auditCalls.length, 3);
}

async function testBackfillStoreBundleRejectsNormalProduct() {
  const fakeDb = {
    async getAll(sql) {
      if (/LOWER\(t\.product_id\)/.test(sql)) {
        return [
          { order_id: 101, order_status: 'pending_payment', product_id: 's100000001', product_type: 'store' },
          { order_id: 102, order_status: 'pending_payment', product_id: 'a100000002', product_type: 'normal' }
        ];
      }
      return [];
    },
    async query() {
      throw new Error('should not update');
    }
  };

  await assert.rejects(
    () => backfillStoreBundle(fakeDb, {
      mainProductId: 's100000001',
      childProductIds: 'a100000002',
      bundleShippingFee: 780
    }),
    /只能补录商城商品/
  );
}

async function testDeleteProductDataCanRemoveOrphanBiddingItem() {
  const fakeDb = {
    async getAll() {
      return [];
    },
    async query(sql) {
      return { rowCount: /bidding_items/.test(sql) ? 1 : 0 };
    }
  };

  const result = await deleteProductDataByProductId(fakeDb, 'v1231866422');

  assert.equal(result.success, true);
  assert.equal(result.taskCount, 0);
  assert.equal(result.biddingItemCount, 1);
}

async function testReassignOrderOwnerUpdatesSourceAndSameProductTasks() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM users/.test(sql)) return { id: 9, username: 'new-user', role: 'user' };
      if (/FROM orders o/.test(sql)) {
        return {
          order_id: 31,
          task_id: 101,
          product_id: 'l1232473681',
          old_user_id: 4
        };
      }
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: /UPDATE tasks/.test(sql) ? 3 : 0 };
    }
  };

  const result = await reassignOrderOwner(fakeDb, { orderId: 31, userId: 9 });

  assert.equal(result.success, true);
  assert.equal(result.orderId, 31);
  assert.equal(result.userId, 9);
  assert.equal(result.username, 'new-user');
  assert.equal(result.taskCount, 3);
  const updateCall = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.match(updateCall.sql, /WHERE product_id = \?/);
  assert.match(updateCall.sql, /user_id = \?/);
  assert.deepEqual(updateCall.params, [9, 'l1232473681', 4]);
}

async function testReassignOrderOwnerRejectsAdminUser() {
  const fakeDb = {
    async getOne(sql) {
      if (/FROM users/.test(sql)) return null;
      throw new Error(`unexpected query: ${sql}`);
    },
    async query() {
      throw new Error('should not update tasks');
    }
  };

  await assert.rejects(
    () => reassignOrderOwner(fakeDb, { orderId: 31, userId: 1 }),
    /valid user is required/
  );
}

async function testMarkProductOrdersForResyncPrefersExistingOrderTasks() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      if (/FROM orders o/.test(sql)) {
        return [
          { order_id: 501, task_id: 11 },
          { order_id: 502, task_id: 12 }
        ];
      }
      return [];
    },
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/FROM tasks/.test(sql)) return { id: 99, status: 'success' };
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await markProductOrdersForResync(fakeDb, 'k1230268385');

  assert.equal(result.success, true);
  assert.deepEqual(result.taskIds, [11, 12]);
  assert.deepEqual(result.orderIds, [501, 502]);
  assert.equal(result.hasExistingOrder, true);
  const updateCall = calls.find(call => call.type === 'query' && /UPDATE tasks/.test(call.sql));
  assert.match(updateCall.sql, /id IN \(\?,\?\)/);
  assert.deepEqual(updateCall.params, [11, 12]);
}

async function testMarkTrackingRescanByProductIdMarksPendingReceiptOrders() {
  const calls = [];
  const fakeDb = {
    async getAll(sql, params) {
      calls.push({ type: 'getAll', sql, params });
      return [{ order_id: 201 }, { order_id: 202 }];
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await markTrackingRescanByProductId(fakeDb, 'm123456789');

  assert.equal(result.success, true);
  assert.equal(result.productId, 'm123456789');
  assert.deepEqual(result.orderIds, [201, 202]);
  assert.equal(result.markedCount, 2);
  assert.match(calls[0].sql, /o\.order_status = \?/);
  assert.match(calls[1].sql, /tracking_rescan_requested = 1/);
  assert.deepEqual(calls[1].params, [201, 202]);
}

async function testRefreshProductShippingFeeWritesProductsOnly() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/COUNT\(\*\) AS count FROM tasks/.test(sql)) return { count: 2 };
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };
  const fakeProductService = {
    async fetchProduct(url) {
      calls.push({ type: 'fetchProduct', url });
      return {
        data: {
          title: 'product title',
          imageUrl: 'https://example.com/image.jpg',
          currentPrice: 1200,
          buyoutPrice: 5000,
          bidCount: 3,
          taxType: 'tax_zero',
          productType: 'normal',
          shippingFeeText: '送料 880円',
          endTime: '2026-06-20T12:00:00+09:00'
        }
      };
    }
  };

  const result = await refreshProductShippingFee(fakeDb, fakeProductService, 'A123456789');

  assert.equal(result.success, true);
  assert.equal(result.productId, 'a123456789');
  assert.equal(result.shippingFeeText, '送料 880円');
  assert.equal(result.updatedCount, 2);
  assert.equal(calls.some(call => call.type === 'query' && /UPDATE tasks/.test(call.sql)), false);
  const productInsert = calls.find(call => call.type === 'query' && /INSERT INTO products/.test(call.sql));
  assert.ok(productInsert);
  assert.match(productInsert.sql, /product_title = COALESCE\(excluded\.product_title, products\.product_title\)/);
  assert.equal(productInsert.params[0], 'a123456789');
  assert.equal(productInsert.params[2], 'product title');
  assert.equal(productInsert.params[8], 'normal');
  assert.equal(productInsert.params[9], '送料 880円');
}

async function testRefreshProductTypeWritesProductsOnly() {
  const calls = [];
  const fakeDb = {
    async getOne(sql, params) {
      calls.push({ type: 'getOne', sql, params });
      if (/COUNT\(\*\) AS count FROM tasks/.test(sql)) return { count: 1 };
      return null;
    },
    async query(sql, params) {
      calls.push({ type: 'query', sql, params });
      return { rowCount: 1 };
    }
  };
  const fakeProductService = {
    async fetchProduct(url) {
      calls.push({ type: 'fetchProduct', url });
      return {
        data: {
          taxType: 'tax_included',
          productType: 'store',
          shippingFeeText: '送料 無料'
        }
      };
    }
  };

  const result = await refreshProductType(fakeDb, fakeProductService, 'https://auctions.yahoo.co.jp/jp/auction/s123456789');

  assert.equal(result.success, true);
  assert.equal(result.productId, 's123456789');
  assert.equal(result.productType, 'store');
  assert.equal(result.productTypeText, '商城商品');
  assert.equal(result.updatedCount, 1);
  assert.equal(calls.some(call => call.type === 'query' && /UPDATE tasks/.test(call.sql)), false);
  const productInsert = calls.find(call => call.type === 'query' && /INSERT INTO products/.test(call.sql));
  assert.ok(productInsert);
  assert.match(productInsert.sql, /product_title = COALESCE\(excluded\.product_title, products\.product_title\)/);
  assert.equal(productInsert.params[0], 's123456789');
  assert.equal(productInsert.params[7], 'tax_included');
  assert.equal(productInsert.params[8], 'store');
}

testShippingFeeParsing();
testSettleableShippingFeeDetection();
testStoreBidderPaysShippingCanSettleAsFree();
testNormalBidderPaysShippingStillCannotSettle();
testLargeAmountFeeOnlyAppliesAtTaxIncludedThirtyThousand();
testStoreTaxIncludedThresholdUsesTaxIncludedPrice();
testSpecialUserConfigOverridesOnlyConfiguredValues();
testBuildOrderSettlementUsesSubmittedRateAndOverrides();
testBuildOrderSettlementPrefersBundleShippingFee();
testNormalizeProductTypeForBatchRefresh();
testAdminTasksListQueryUsesProductsOnly();
testAdminPendingTasksQueryUsesProductsOnly();
testAdminOrdersQueryIncludesProductType();
testMapAdminOrderListItemKeepsOrderRemark();
testAdminOrdersUserWonDateRangeQueryUsesWonAtOnly();
testOrderStatusDebugOrdersQueryUsesProductsOnly();
testOrderStatusDebugTasksQueryUsesProductsOnly();
testProductDebugQueriesExposeTaskErrorsAndRelatedLogs();
testOrderSettlementSelectQueryUsesProductsOnly();
testOrderSettlementUpdateDoesNotChangeOrderStatus();
testAdminLogsQueryUsesProductTitleFallback();
testMapAdminOrderListItemUsesEffectiveBundleShipping();
testMapAdminOrderListItemAllowsStoreBidderPaysShipping();
testSettlementStatusUsesPendingSettlement();
testCompletedOrderStatusConstant();
testNormalizeOrderStatusRefreshTargetSupportsAllowedTargets();
testNormalizeOrderStatusRefreshTargetRejectsUnknownStatus();
testNormalizePositiveIntegerConfig();
testBuildGoogleSheetUrl();
testBuildTrustedInputReportQueries();
testBuildBidFailureReportQueries();
testBuildRecentTaskFailureUserReportQuery();
testBuildAdminMessagesListQueryFiltersWonOrdersAndMessageStatus();
testParseStoreBundleChildProductIdsAcceptsFullAndHalfCommas();
testManualOrderImportSummarySeparatesEmptyReadyBatches();

Promise.all([
  testUpdateOrderRemarkStoresTrimmedRemark(),
  testUpdateOrderRemarkRejectsMissingOrder(),
  testRequestScanSetsCounterToConfiguredEveryRuns(),
  testCreateManualOrderImportBatchDoesNotMutateScanCounter(),
  testConfirmManualOrderImportRejectsAdminUserAssignment(),
  testConfirmManualOrderImportSkipsUnassignedItems(),
  testDeleteManualOrderImportBatchDeletesBatchAndItems(),
  testDeleteManualOrderImportBatchRejectsMissingBatch(),
  testRequestPaymentSetsFlag(),
  testRequestPaymentDoesNotSetFlagWhenNoPendingSettlementRows(),
  testClearPaymentAlertAndContinueClearsMessageAndSetsFlag(),
  testBackfillStoreBundleMarksMainPendingShipmentAndChildrenCompleted(),
  testBackfillStoreBundleRejectsNormalProduct(),
  testDeleteProductDataRemovesTaskOrderAndBiddingAssociations(),
  testDeleteProductDataCanRemoveOrphanBiddingItem(),
  testReassignOrderOwnerUpdatesSourceAndSameProductTasks(),
  testReassignOrderOwnerRejectsAdminUser(),
  testMarkProductOrdersForResyncPrefersExistingOrderTasks(),
  testMarkTrackingRescanByProductIdMarksPendingReceiptOrders(),
  testRefreshProductShippingFeeWritesProductsOnly(),
  testRefreshProductTypeWritesProductsOnly()
]).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
