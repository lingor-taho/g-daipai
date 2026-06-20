const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const config = require('../../config');
const db = require('../models');
const {
  buildProductDebugTasksQuery,
  buildProductDebugBidLogsQuery,
  buildProductDebugOrdersQuery,
  buildProductDebugOrderLogsQuery,
  buildProductDebugDiagnosticsQuery,
  buildProductDebugSnapshotQuery,
  buildProductDebugBiddingItemsQuery,
  buildProductDebugConfigQuery
} = require('./admin');

function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function readDebugToken(req) {
  return String(
    req.get('x-admin-debug-token') ||
    req.query.debugKey ||
    req.query.debug_key ||
    ''
  ).trim();
}

function isValidDebugToken(input, expected = config.adminDebugToken) {
  const actual = String(input || '').trim();
  const configured = String(expected || '').trim();
  if (!actual || !configured) return false;
  const actualBuffer = Buffer.from(actual);
  const configuredBuffer = Buffer.from(configured);
  if (actualBuffer.length !== configuredBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, configuredBuffer);
}

async function buildProductDebugReport(productId, database = db) {
  const tasksQuery = buildProductDebugTasksQuery(productId);
  const bidLogsQuery = buildProductDebugBidLogsQuery(productId);
  const ordersQuery = buildProductDebugOrdersQuery(productId);
  const orderLogsQuery = buildProductDebugOrderLogsQuery(productId);
  const diagnosticsQuery = buildProductDebugDiagnosticsQuery(productId);
  const snapshotQuery = buildProductDebugSnapshotQuery(productId);
  const biddingItemsQuery = buildProductDebugBiddingItemsQuery(productId);
  const configQuery = buildProductDebugConfigQuery();

  const [
    tasks,
    bidLogs,
    orders,
    orderLogs,
    diagnostics,
    productSnapshot,
    biddingItems,
    configRows
  ] = await Promise.all([
    database.getAll(tasksQuery.sql, tasksQuery.params),
    database.getAll(bidLogsQuery.sql, bidLogsQuery.params),
    database.getAll(ordersQuery.sql, ordersQuery.params),
    database.getAll(orderLogsQuery.sql, orderLogsQuery.params),
    database.getAll(diagnosticsQuery.sql, diagnosticsQuery.params),
    database.getOne(snapshotQuery.sql, snapshotQuery.params),
    database.getAll(biddingItemsQuery.sql, biddingItemsQuery.params),
    database.getAll(configQuery.sql, configQuery.params)
  ]);

  return {
    productId,
    generatedAt: new Date().toISOString(),
    summary: {
      taskCount: tasks.length,
      failedTaskCount: tasks.filter(task => task.status === 'failed').length,
      latestTask: tasks[0] || null,
      latestError: tasks.find(task => task.error_msg)?.error_msg || bidLogs.find(log => log.error_msg)?.error_msg || null,
      bidLogCount: bidLogs.length,
      orderCount: orders.length,
      diagnosticCount: diagnostics.length
    },
    productSnapshot: productSnapshot || null,
    tasks,
    bidLogs,
    orders,
    orderLogs,
    diagnostics,
    biddingItems,
    config: configRows
  };
}

router.get('/product/:productId', async (req, res) => {
  try {
    if (!config.adminDebugToken) {
      return res.status(404).json({ error: 'debug API disabled' });
    }
    if (!isValidDebugToken(readDebugToken(req))) {
      return res.status(401).json({ error: 'invalid debug token' });
    }

    const productId = extractAuctionId(req.params.productId || req.query.productId || '');
    if (!productId) {
      return res.status(400).json({ error: 'valid product id is required' });
    }

    const report = await buildProductDebugReport(productId);
    res.json(report);
  } catch (error) {
    console.error('[Debug API] product report failed:', error);
    res.status(500).json({
      error: 'debug product report failed',
      detail: error.message || String(error)
    });
  }
});

module.exports = router;
module.exports.readDebugToken = readDebugToken;
module.exports.isValidDebugToken = isValidDebugToken;
module.exports.buildProductDebugReport = buildProductDebugReport;
