const express = require('express');
const router = express.Router();
const db = require('../models');
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const authMiddleware = require('../middleware/auth');
const adminAuthMiddleware = require('../middleware/adminAuth');
const {
  chooseNextPluginTask,
  getMultiBidConfig: getPluginMultiBidConfig,
  getMultiBidIntervalMs,
  getStrategyLeadMs,
  isMultiBidTask,
  ensureScheduledTransactionStartRequest,
  shouldAutoRequestTransactionStart,
  ensureScheduledConfirmReceiptRequest,
  shouldAutoRequestConfirmReceipt,
  getShipmentAlerts,
  appendPendingReceiptOrderToGoogleSheet,
  DEFAULT_MULTI_BID_MIN_PRICE,
  DEFAULT_CONFIRM_RECEIPT_HOUR,
  DEFAULT_CONFIRM_RECEIPT_COLOR,
  normalizeReceiptColorConfig
} = require('./plugin');
const { productService, normalizeAuctionUrl } = require('./proxy');
const { buildYahooLoginStatus } = require('../services/yahooLoginStatus');
const {
  deleteStaleTaskData,
  getDataCleanupConfig,
  saveDataCleanupConfig
} = require('../services/dataCleanup');
const {
  createDatabaseBackup,
  getDatabaseBackupDir,
  getDatabasePath,
  isValidDatabaseBackupFileName,
  listDatabaseBackups,
  resolveBackupFilePath,
  displayPath: displayDatabaseBackupPath
} = require('../services/databaseBackup');
const {
  previewWonDateCleanup,
  runWonDateCleanup
} = require('../services/forceDateCleanup');
const {
  DEFAULT_CLIENT_RATE_ADJUSTMENT,
  getWebsiteRate,
  normalizeRateAdjustment
} = require('../services/websiteRate');
const {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs,
  backfillMissingOrderStatusAuditLogs
} = require('../services/orderStatusAudit');
const {
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  extractSpreadsheetId,
  getGoogleSheetsCredentialPath,
  getSheetConfig
} = require('../services/googleSheets');
const {
  getCaptchaChallenge,
  answerCaptchaChallenge,
  closeCaptchaChallenge
} = require('../services/manualCaptcha');
const { getOnlineUsers } = require('../services/onlineUsers');
const {
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED
} = require('../../shared/domainConstants.cjs');
const {
  taxExcludedToTaxIncluded
} = require('../../shared/priceRules.cjs');
const {
  parseShippingFeeToNumber,
  canSettleShippingFeeText,
  canSettleOrderShippingFee,
  getEffectiveShippingFeeText
} = require('../../shared/shippingRules.cjs');
const {
  calculateOrderPayable
} = require('../../shared/payableRules.cjs');
const { upsertProductSnapshot } = require('../services/productRepository');

function buildGoogleSheetUrl(spreadsheetId) {
  const id = String(spreadsheetId || '').trim();
  if (!id) return '';
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit?gid=0#gid=0`;
}

function normalizeBidStrategyScope(value) {
  return value === 'direct_only' ? 'direct_only' : 'all';
}

function normalizeOrderStatusRefreshTarget(value) {
  const normalized = String(value || 'completed').trim();
  if (normalized === 'blank') return null;
  if (normalized === ORDER_STATUS_COMPLETED) return ORDER_STATUS_COMPLETED;
  if (normalized === ORDER_STATUS_PENDING_SHIPMENT) return ORDER_STATUS_PENDING_SHIPMENT;
  throw new Error('invalid orderStatus');
}

function getOrderStatusRefreshText(orderStatus) {
  if (orderStatus === ORDER_STATUS_PENDING_SHIPMENT) return '待发货';
  return orderStatus === null ? '为空' : '完了';
}

router.use(authMiddleware);
router.use(adminAuthMiddleware);

function parseTaskTimeMs(value) {
  let input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : null;
}

function getLocalDateKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toIsoOrNull(ms) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function getNextExecuteAt(task, multiBidConfig, nowMs = Date.now()) {
  if (!task || ['success', 'failed'].includes(task.status)) return null;
  const endMs = parseTaskTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return null;

  if (isMultiBidTask(task)) {
    const startMs = endMs ? endMs - getStrategyLeadMs({ ...task, ...multiBidConfig }) : nowMs;
    const referenceMs = parseTaskTimeMs(task.last_bid_at || (task.status === 'bidding' ? task.updated_at || task.created_at : null));
    const intervalReadyMs = referenceMs ? referenceMs + getMultiBidIntervalMs(multiBidConfig) : nowMs;
    return toIsoOrNull(Math.max(startMs, intervalReadyMs, nowMs));
  }

  if (task.status === 'bidding') return null;
  if (!task.strategy || task.strategy === 'direct') return toIsoOrNull(nowMs);
  if (!endMs) return toIsoOrNull(nowMs);
  return toIsoOrNull(Math.max(endMs - getStrategyLeadMs(task), nowMs));
}

function buildAdminTasksListQuery({ pageSize, offset }) {
  return {
    sql: `SELECT t.id,
            t.user_id,
            t.product_id,
            t.max_price,
            t.user_max_price,
            t.multi_bid_increment,
            t.strategy,
            t.bid_mode,
            t.start_minutes_before,
            t.start_seconds_before,
            t.status,
            t.is_highest_bidder,
            t.last_bid_at,
            t.error_msg,
            t.created_at,
            t.updated_at,
            t.client_request_id,
            t.pending_followup_max_price,
            t.force_orders_resync,
            t.buyout_auto_paid,
            p.product_url AS product_url,
            p.product_title AS product_title,
            p.product_image_url AS product_image_url,
            p.current_price AS current_price,
            p.buyout_price AS buyout_price,
            p.bid_count AS bid_count,
            p.tax_type AS tax_type,
            p.product_type AS product_type,
            p.shipping_fee_text AS shipping_fee_text,
            p.end_time AS end_time,
            u.username
     FROM tasks t
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN users u ON u.id = t.user_id
     ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    params: [pageSize, offset]
  };
}

function buildAdminPendingTasksQuery() {
  return {
    sql: `SELECT t.id,
            t.product_id,
            p.product_title AS product_title,
            CASE WHEN COALESCE(t.bid_mode, 'bid') = 'buyout'
              THEN COALESCE(t.user_max_price, t.max_price)
              ELSE t.max_price
            END AS max_price,
            t.strategy,
            t.start_minutes_before,
            t.start_seconds_before,
            t.status,
            t.last_bid_at,
            p.end_time AS end_time,
            t.created_at
     FROM tasks t
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE t.status = 'pending' OR (t.status = 'bidding' AND t.strategy = 'multi_bid')
     ORDER BY t.created_at ASC LIMIT 100`,
    params: []
  };
}

function buildAdminOrdersListQuery({ pageSize, offset }) {
  return {
    sql: `SELECT o.*,
            o.order_remark AS order_remark,
            COALESCE(o.product_id, t.product_id) AS product_id,
            p.product_title AS product_title,
            p.product_url AS product_url,
            p.shipping_fee_text AS shipping_fee_text,
            COALESCE(p.tax_type, 'tax_zero') AS tax_type,
            COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
            u.id AS user_id,
            u.username,
            ufo.rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny,
            (
              SELECT l.source
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_source,
            (
              SELECT l.created_at
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_at,
            (
              SELECT l.old_status
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_old_status,
            (
              SELECT l.new_status
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_new_status,
            (
              SELECT l.metadata
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
              ORDER BY datetime(l.created_at) DESC, l.id DESC
              LIMIT 1
            ) AS latest_status_change_metadata
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, t.updated_at)) DESC, t.id DESC LIMIT ? OFFSET ?`,
    params: [pageSize, offset]
  };
}

function buildAdminOrdersUserWonDateRangeQuery({ userId, fromDate, toDate }) {
  return {
    sql: `SELECT o.id,
            o.task_id,
            p.product_title AS product_title,
            p.product_url AS product_url,
            o.final_price,
            o.won_at,
            o.won_time_text,
            o.order_status,
            o.order_remark,
            o.bundle_shipping_fee_text,
            o.transaction_url,
            o.transaction_start_error,
            o.shipping_company,
            o.tracking_number,
            o.settled_at,
            o.updated_at,
            o.jpy_to_cny_rate,
            o.bank_fee_jpy,
            o.handling_fee_cny,
            o.large_amount_fee_cny,
            o.large_amount_fee_applied,
            o.tax_included_final_price,
            o.has_user_finance_override,
            o.total_amount_cny,
            t.product_id,
            p.shipping_fee_text AS shipping_fee_text,
            COALESCE(p.tax_type, 'tax_zero') AS tax_type,
            COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
            u.id AS user_id,
            u.username,
            ufo.rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE t.status = 'success'
       AND u.id = ?
       AND o.won_at IS NOT NULL
       AND substr(COALESCE(o.won_at, ''), 1, 10) >= ?
       AND substr(COALESCE(o.won_at, ''), 1, 10) <= ?
     ORDER BY datetime(o.won_at) DESC, o.id DESC`,
    params: [userId, fromDate, toDate]
  };
}

function buildOrderStatusDebugOrdersQuery(productId) {
  return {
    sql: `SELECT o.id, o.task_id, o.order_status, o.final_price, o.won_at, o.won_time_text,
            o.created_at, o.updated_at, o.transaction_started_at, o.transaction_start_error,
            o.bundle_group_id, o.bundle_shipping_fee_text,
            t.product_id,
            p.product_type AS product_type,
            p.shipping_fee_text AS shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE t.product_id = ?
     ORDER BY o.id DESC`,
    params: [productId]
  };
}

function buildOrderStatusDebugTasksQuery(productId) {
  return {
    sql: `SELECT t.id,
            t.product_id,
            t.status,
            t.strategy,
            p.product_type AS product_type,
            p.shipping_fee_text AS shipping_fee_text,
            t.created_at,
            t.updated_at,
            t.last_bid_at
     FROM tasks t
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE t.product_id = ?
     ORDER BY t.id DESC`,
    params: [productId]
  };
}

function buildProductDebugTasksQuery(productId) {
  return {
    sql: `SELECT t.id,
            t.user_id,
            u.username,
            t.product_id,
            p.product_url AS product_product_url,
            p.product_title AS product_title,
            t.status,
            t.strategy,
            t.bid_mode,
            p.current_price AS product_current_price,
            p.current_price AS display_current_price,
            t.max_price,
            t.user_max_price,
            p.buyout_price AS product_buyout_price,
            p.bid_count AS product_bid_count,
            p.tax_type AS product_tax_type,
            p.tax_type AS effective_tax_type,
            p.product_type AS product_product_type,
            p.product_type AS effective_product_type,
            p.shipping_fee_text AS product_shipping_fee_text,
            p.shipping_fee_text AS effective_shipping_fee_text,
            p.end_time AS product_end_time,
            p.end_time AS effective_end_time,
            t.is_highest_bidder,
            t.last_bid_at,
            t.error_msg,
            t.pending_followup_max_price,
            t.force_orders_resync,
            t.buyout_auto_paid,
            t.created_at,
            t.updated_at
     FROM tasks t
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.product_id = ?
     ORDER BY datetime(t.created_at) DESC, t.id DESC
     LIMIT 100`,
    params: [productId]
  };
}

function buildProductDebugBidLogsQuery(productId) {
  return {
    sql: `SELECT bl.id,
            bl.task_id,
            bl.account_id,
            bl.bid_price,
            bl.result,
            bl.error_msg,
            bl.created_at,
            t.product_id,
            u.username
     FROM bid_logs bl
     INNER JOIN tasks t ON t.id = bl.task_id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.product_id = ?
     ORDER BY datetime(bl.created_at) DESC, bl.id DESC
     LIMIT 100`,
    params: [productId]
  };
}

function buildProductDebugOrdersQuery(productId) {
  return {
    sql: `SELECT o.id,
            o.task_id,
            COALESCE(o.product_id, t.product_id) AS product_id,
            u.username,
            o.order_status,
            o.final_price,
            o.won_at,
            o.won_time_text,
            o.order_status,
            o.transaction_url,
            o.transaction_started_at,
            o.transaction_start_error,
            o.bundle_group_id,
            o.bundle_shipping_fee_text,
            o.tracking_number,
            o.shipping_company,
            o.shipped_at,
            o.google_sheet_appended_at,
            o.tracking_rescan_requested,
            o.created_at,
            o.updated_at
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN users u ON u.id = t.user_id
     WHERE t.product_id = ? OR o.product_id = ?
     ORDER BY datetime(o.created_at) DESC, o.id DESC
     LIMIT 100`,
    params: [productId, productId]
  };
}

function buildProductDebugOrderLogsQuery(productId) {
  return {
    sql: `SELECT l.id,
            l.order_id,
            l.product_id,
            l.old_status,
            l.new_status,
            l.source,
            l.metadata,
            l.created_at
     FROM order_status_change_logs l
     WHERE l.product_id = ?
        OR l.order_id IN (
          SELECT o.id
          FROM orders o
          INNER JOIN tasks t ON o.task_id = t.id
          WHERE t.product_id = ? OR o.product_id = ?
        )
     ORDER BY datetime(l.created_at) DESC, l.id DESC
     LIMIT 100`,
    params: [productId, productId, productId]
  };
}

function buildProductDebugDiagnosticsQuery(productId) {
  return {
    sql: `SELECT id,
            type,
            level,
            product_id,
            order_id,
            action,
            method,
            message,
            diagnostics,
            url,
            created_at
     FROM plugin_diagnostics
     WHERE product_id = ?
        OR order_id IN (
          SELECT o.id
          FROM orders o
          INNER JOIN tasks t ON o.task_id = t.id
          WHERE t.product_id = ? OR o.product_id = ?
        )
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 100`,
    params: [productId, productId, productId]
  };
}

function buildProductDebugSnapshotQuery(productId) {
  return {
    sql: `SELECT *
     FROM products
     WHERE product_id = ?
     LIMIT 1`,
    params: [productId]
  };
}

function buildProductDebugBiddingItemsQuery(productId) {
  return {
    sql: `SELECT *
     FROM bidding_items
     WHERE product_id = ?
     ORDER BY datetime(synced_at) DESC, product_id DESC
     LIMIT 20`,
    params: [productId]
  };
}

function buildProductDebugConfigQuery() {
  return {
    sql: `SELECT key, value, updated_at
     FROM config
     WHERE key IN (
       'yahoo_login_status',
       'yahoo_login_message',
       'worker_interval_ms',
       'bid_concurrency_limit',
       'multi_bid_start_hours',
       'multi_bid_interval_minutes',
       'multi_bid_min_price',
       'idle_sync_interval_minutes',
       'transaction_start_flag',
       'payment_flag',
       'confirm_receipt_flag',
       'manual_order_import_flag'
     )
     ORDER BY key`,
    params: []
  };
}

function buildOrderSettlementSelectQuery(orderId) {
  return {
    sql: `SELECT o.*,
              COALESCE(o.product_id, t.product_id) AS product_id,
              p.shipping_fee_text AS shipping_fee_text,
              COALESCE(p.tax_type, 'tax_zero') AS tax_type,
              COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
              u.id AS user_id,
              ufo.rate_adjustment,
              ufo.bank_fee_jpy AS user_bank_fee_jpy,
              ufo.handling_fee_cny AS user_handling_fee_cny,
              ufo.large_amount_fee_cny AS user_large_amount_fee_cny
       FROM orders o
       INNER JOIN tasks t ON o.task_id = t.id
       LEFT JOIN products p ON p.product_id = COALESCE(o.product_id, t.product_id)
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
       WHERE o.id = ? AND t.status = 'success'`,
    params: [orderId]
  };
}

function buildAdminLogsQuery({ pageSize, offset }) {
  return {
    sql: `SELECT bl.*, p.product_title AS product_title, ya.account_name
     FROM bid_logs bl
     LEFT JOIN tasks t ON bl.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     LEFT JOIN yahoo_accounts ya ON bl.account_id = ya.id
     ORDER BY bl.created_at DESC
     LIMIT ? OFFSET ?`,
    params: [pageSize, offset]
  };
}

function normalizeMessagesPage(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function buildAdminMessagesListQuery(filters = {}) {
  const current = normalizeMessagesPage(filters.current, 1);
  const pageSize = Math.min(200, normalizeMessagesPage(filters.pageSize, 20));
  const offset = (current - 1) * pageSize;
  const where = ["t.status = 'success'"];
  const params = [];
  const username = String(filters.username || '').trim();
  if (username) {
    where.push('u.username LIKE ?');
    params.push(`%${username}%`);
  }
  const productId = String(filters.productId || '').trim().toLowerCase();
  if (productId) {
    where.push('LOWER(COALESCE(o.product_id, t.product_id)) = ?');
    params.push(productId);
  }
  const wonFrom = String(filters.wonFrom || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(wonFrom)) {
    where.push("substr(COALESCE(o.won_at, ''), 1, 10) >= ?");
    params.push(wonFrom);
  }
  const wonTo = String(filters.wonTo || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(wonTo)) {
    where.push("substr(COALESCE(o.won_at, ''), 1, 10) <= ?");
    params.push(wonTo);
  }
  const fromSql = `FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN users u ON u.id = t.user_id
     LEFT JOIN products p ON p.product_id = COALESCE(o.product_id, t.product_id)
     LEFT JOIN yahoo_trade_messages m ON m.order_id = o.id
     WHERE ${where.join(' AND ')}`;
  return {
    rows: {
      sql: `SELECT o.id AS order_id,
            COALESCE(o.product_id, t.product_id) AS product_id,
            o.won_at,
            o.won_time_text,
            o.order_status,
            o.transaction_url,
            p.product_title,
            COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
            u.id AS user_id,
            u.username,
            m.message_html,
            CASE WHEN m.fetch_requested_at IS NOT NULL
                   OR m.fetch_started_at IS NOT NULL
                   OR m.updated_at IS NOT NULL
                   OR NULLIF(TRIM(COALESCE(m.message_html, '')), '') IS NOT NULL
                 THEN m.fetch_status ELSE NULL END AS fetch_status,
            m.fetch_requested_at,
            m.fetch_started_at,
            CASE WHEN m.fetch_requested_at IS NOT NULL
                   OR m.fetch_started_at IS NOT NULL
                   OR m.updated_at IS NOT NULL
                   OR NULLIF(TRIM(COALESCE(m.message_html, '')), '') IS NOT NULL
                 THEN m.fetch_error ELSE NULL END AS fetch_error,
            m.send_status,
            m.send_error,
            m.updated_at AS message_updated_at
     ${fromSql}
     ORDER BY datetime(COALESCE(o.won_at, t.updated_at)) DESC, o.id DESC
     LIMIT ? OFFSET ?`,
      params: [...params, pageSize, offset]
    },
    count: {
      sql: `SELECT COUNT(*) AS total ${fromSql}`,
      params
    },
    pagination: { current, pageSize }
  };
}

async function requestYahooMessageFetch(database, orderId) {
  const id = Number(orderId || 0);
  if (!Number.isInteger(id) || id <= 0) {
    const error = new Error('valid order id is required');
    error.statusCode = 400;
    throw error;
  }
  const order = await database.getOne(
    `SELECT o.id AS order_id, COALESCE(o.product_id, t.product_id) AS product_id
     FROM orders o
     INNER JOIN tasks t ON t.id = o.task_id
     WHERE o.id = ? AND o.order_status NOT IN ('cancelled', 'bundle_completed')`,
    [id]
  );
  if (!order) {
    const error = new Error('order not found');
    error.statusCode = 404;
    throw error;
  }
  await database.query(
    `INSERT INTO yahoo_trade_messages (order_id, product_id, message_html, fetch_status, fetch_requested_at, fetch_error, updated_at, created_at)
     VALUES (?, ?, NULL, 'pending', CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP)
     ON CONFLICT(order_id) DO UPDATE SET
       product_id = excluded.product_id,
       message_html = NULL,
       fetch_status = 'pending',
       fetch_requested_at = CURRENT_TIMESTAMP,
       fetch_error = NULL,
       updated_at = NULL`,
    [order.order_id, order.product_id]
  );
  return { success: true, orderId: order.order_id, productId: order.product_id };
}

async function requestYahooMessageSend(database, orderId, messageText) {
  const text = String(messageText || '').trim();
  if (!text) {
    const error = new Error('message is required');
    error.statusCode = 400;
    throw error;
  }
  const result = await requestYahooMessageFetch(database, orderId);
  await database.query(
    `UPDATE yahoo_trade_messages
     SET send_status = 'pending',
         send_text = ?,
         send_requested_at = CURRENT_TIMESTAMP,
         send_error = NULL
     WHERE order_id = ?`,
    [text, result.orderId]
  );
  return { ...result, sendRequested: true };
}

function normalizeReportPage(value, fallback = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function normalizeReportDays(value, fallback = 5) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(90, Math.floor(numeric));
}

function buildTrustedInputReportQueries(filters = {}) {
  const current = normalizeReportPage(filters.current, 1);
  const pageSize = Math.min(200, normalizeReportPage(filters.pageSize, 20));
  const offset = (current - 1) * pageSize;
  const where = ["type = 'trusted_input'"];
  const params = [];
  const addFilter = (column, value) => {
    const text = String(value || '').trim();
    if (!text) return;
    where.push(`${column} = ?`);
    params.push(text);
  };
  addFilter('level', filters.level);
  addFilter('action', filters.action);
  addFilter('method', filters.method);
  addFilter('product_id', String(filters.productId || filters.product_id || '').toLowerCase());
  const whereSql = `WHERE ${where.join(' AND ')}`;
  return {
    pagination: { current, pageSize, offset },
    summary: {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) AS info_count,
                   SUM(CASE WHEN level = 'warn' THEN 1 ELSE 0 END) AS warn_count,
                   SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
                   MAX(created_at) AS last_used_at
            FROM plugin_diagnostics
            ${whereSql}`,
      params: [...params]
    },
    byAction: {
      sql: `SELECT COALESCE(action, '') AS action,
                   COALESCE(method, '') AS method,
                   COUNT(*) AS count,
                   SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
                   MAX(created_at) AS last_used_at
            FROM plugin_diagnostics
            ${whereSql}
            GROUP BY action, method
            ORDER BY count DESC, datetime(last_used_at) DESC
            LIMIT 100`,
      params: [...params]
    },
    byMethod: {
      sql: `SELECT COALESCE(method, '') AS method,
                   COALESCE(level, '') AS level,
                   COUNT(*) AS count,
                   MAX(created_at) AS last_used_at
            FROM plugin_diagnostics
            ${whereSql}
            GROUP BY method, level
            ORDER BY count DESC, datetime(last_used_at) DESC
            LIMIT 100`,
      params: [...params]
    },
    rows: {
      sql: `SELECT id, level, product_id, order_id, action, method, message, diagnostics, url, created_at
            FROM plugin_diagnostics
            ${whereSql}
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ? OFFSET ?`,
      params: [...params, pageSize, offset]
    },
    count: {
      sql: `SELECT COUNT(*) AS total
            FROM plugin_diagnostics
            ${whereSql}`,
      params: [...params]
    }
  };
}

function buildBidFailureReportQueries(filters = {}) {
  const current = normalizeReportPage(filters.current, 1);
  const pageSize = Math.min(200, normalizeReportPage(filters.pageSize, 20));
  const offset = (current - 1) * pageSize;
  const where = ["type = 'bid_failure'"];
  const params = [];
  const addFilter = (column, value) => {
    const text = String(value || '').trim();
    if (!text) return;
    where.push(`${column} = ?`);
    params.push(text);
  };
  addFilter('level', filters.level);
  addFilter('action', filters.action);
  addFilter('method', filters.method);
  addFilter('product_id', String(filters.productId || filters.product_id || '').toLowerCase());
  const messageText = String(filters.message || '').trim();
  if (messageText) {
    where.push('message LIKE ?');
    params.push(`%${messageText}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const stageExpr = `
    CASE
      WHEN diagnostics LIKE '%stage=%' THEN
        substr(
          substr(diagnostics, instr(diagnostics, 'stage=') + 6),
          1,
          CASE
            WHEN instr(substr(diagnostics, instr(diagnostics, 'stage=') + 6), ',') > 0
            THEN instr(substr(diagnostics, instr(diagnostics, 'stage=') + 6), ',') - 1
            ELSE length(substr(diagnostics, instr(diagnostics, 'stage=') + 6))
          END
        )
      ELSE ''
    END`;
  return {
    pagination: { current, pageSize, offset },
    summary: {
      sql: `SELECT COUNT(*) AS total,
                   SUM(CASE WHEN action = 'bid_timeout' THEN 1 ELSE 0 END) AS timeout_count,
                   SUM(CASE WHEN message LIKE '%system%' OR message LIKE '%系统%' OR message LIKE '%Yahoo system%' THEN 1 ELSE 0 END) AS system_error_count,
                   SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error_count,
                   MAX(created_at) AS last_failed_at
            FROM plugin_diagnostics
            ${whereSql}`,
      params: [...params]
    },
    byAction: {
      sql: `SELECT COALESCE(action, '') AS action,
                   COALESCE(message, '') AS message,
                   COUNT(*) AS count,
                   MAX(created_at) AS last_failed_at
            FROM plugin_diagnostics
            ${whereSql}
            GROUP BY action, message
            ORDER BY count DESC, datetime(last_failed_at) DESC
            LIMIT 100`,
      params: [...params]
    },
    byStage: {
      sql: `SELECT COALESCE(${stageExpr}, '') AS stage,
                   COUNT(*) AS count,
                   SUM(CASE WHEN action = 'bid_timeout' THEN 1 ELSE 0 END) AS timeout_count,
                   MAX(created_at) AS last_failed_at
            FROM plugin_diagnostics
            ${whereSql}
            GROUP BY stage
            ORDER BY count DESC, datetime(last_failed_at) DESC
            LIMIT 100`,
      params: [...params]
    },
    rows: {
      sql: `SELECT id, level, product_id, order_id, action, method, message, diagnostics, url, created_at
            FROM plugin_diagnostics
            ${whereSql}
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ? OFFSET ?`,
      params: [...params, pageSize, offset]
    },
    count: {
      sql: `SELECT COUNT(*) AS total
            FROM plugin_diagnostics
            ${whereSql}`,
      params: [...params]
    }
  };
}

const taskFailureTimeoutSql = `(
  COALESCE(t.error_msg, '') LIKE '%Task execution timeout after%'
  OR COALESCE(t.error_msg, '') LIKE '%timeout%'
  OR COALESCE(t.error_msg, '') LIKE '%timed out%'
  OR COALESCE(t.error_msg, '') LIKE '%networkidle%'
  OR COALESCE(t.error_msg, '') LIKE '%30%tab%'
  OR COALESCE(t.error_msg, '') LIKE '%响应超时%'
  OR COALESCE(t.error_msg, '') LIKE '%加载超时%'
  OR COALESCE(t.error_msg, '') LIKE '%超时%'
)`;

const taskFailureKnownNonSystemSql = `(
  ${taskFailureTimeoutSql}
  OR COALESCE(t.error_msg, '') LIKE '%Current price is above max price before execution%'
  OR COALESCE(t.error_msg, '') LIKE '%above max price%'
  OR COALESCE(t.error_msg, '') LIKE '%当前价格%'
  OR COALESCE(t.error_msg, '') LIKE '%税费合计金额%'
  OR COALESCE(t.error_msg, '') LIKE '%出价金额%'
  OR COALESCE(t.error_msg, '') LIKE '%高于最高价%'
  OR COALESCE(t.error_msg, '') LIKE '%Auction ended before plugin execution%'
  OR COALESCE(t.error_msg, '') LIKE '%Auction ended according to product page snapshot%'
  OR COALESCE(t.error_msg, '') LIKE '%ended before%'
  OR COALESCE(t.error_msg, '') LIKE '%商品%结束%'
  OR COALESCE(t.error_msg, '') LIKE '%outbid after bid%'
  OR COALESCE(t.error_msg, '') LIKE '%Rebid required%'
  OR COALESCE(t.error_msg, '') LIKE '%current bid is not high enough%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo login%'
  OR COALESCE(t.error_msg, '') LIKE '%login%Yahoo%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo%login%'
  OR COALESCE(t.error_msg, '') LIKE '%需要登录%Yahoo%'
  OR COALESCE(t.error_msg, '') LIKE '%Server tab error%'
  OR COALESCE(t.error_msg, '') LIKE '%No tab with id%'
  OR COALESCE(t.error_msg, '') LIKE '%Tabs cannot be edited right now%'
  OR COALESCE(t.error_msg, '') LIKE '%user may be dragging a tab%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo bid failed%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo system error page%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo error page%'
  OR COALESCE(t.error_msg, '') LIKE '%Yahoo%access failure%'
)`;

function buildRecentTaskFailureUserReportQuery(filters = {}) {
  const days = normalizeReportDays(filters.days, 5);
  const systemSql = `(NOT ${taskFailureKnownNonSystemSql})`;
  return {
    days,
    sql: `SELECT t.user_id,
                 COALESCE(u.username, '-') AS username,
                 SUM(CASE WHEN ${taskFailureTimeoutSql} THEN 1 ELSE 0 END) AS timeout_count,
                 SUM(CASE WHEN ${systemSql} THEN 1 ELSE 0 END) AS system_count,
                 SUM(CASE WHEN ${taskFailureTimeoutSql} OR ${systemSql} THEN 1 ELSE 0 END) AS total_count,
                 MAX(t.updated_at) AS last_failed_at
          FROM tasks t
          LEFT JOIN users u ON u.id = t.user_id
          WHERE t.status = 'failed'
            AND datetime(t.updated_at) >= datetime('now', ? || ' days')
            AND (${taskFailureTimeoutSql} OR ${systemSql})
          GROUP BY t.user_id, u.username
          HAVING timeout_count > 0 OR system_count > 0
          ORDER BY total_count DESC, datetime(last_failed_at) DESC`,
    params: [-days]
  };
}

function mapAdminOrderListItem(item) {
  const settled = Boolean(item.settled_at);
  const effectiveShippingFeeText = getEffectiveShippingFeeText(item);
  return {
    ...item,
    username: item.username || '-',
    product_id: item.product_id || extractAuctionId(item.product_url) || '',
    shipping_fee_text: item.shipping_fee_text || '-',
    effective_shipping_fee_text: effectiveShippingFeeText || '-',
    can_settle: canSettleOrderShippingFee(item),
    shipping_fee_jpy: settled ? parseShippingFeeToNumber(effectiveShippingFeeText) : null,
    bank_fee_jpy: settled ? item.bank_fee_jpy : null,
    handling_fee_cny: settled ? item.handling_fee_cny : null,
    large_amount_fee_cny: settled ? item.large_amount_fee_cny : null,
    large_amount_fee_applied: settled ? Boolean(item.large_amount_fee_applied) : null,
    tax_included_final_price: settled ? item.tax_included_final_price : null,
    jpy_to_cny_rate: settled ? item.jpy_to_cny_rate : null,
    rate_adjustment: settled ? item.rate_adjustment : null,
    has_user_finance_override: settled ? Boolean(item.has_user_finance_override) : null,
    payable_cny: settled ? item.total_amount_cny : null,
    order_status: item.order_status || null,
    transaction_start_error: item.transaction_start_error || null,
    latest_status_change_source: item.latest_status_change_source || null,
    latest_status_change_at: item.latest_status_change_at || null,
    latest_status_old_status: item.latest_status_old_status || null,
    latest_status_new_status: item.latest_status_new_status || null,
    latest_status_change_metadata: item.latest_status_change_metadata || null
  };
}

function normalizeOrderRemark(value) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  return text.slice(0, 1000);
}

async function updateOrderRemark(database, { orderId, remark }) {
  const normalizedOrderId = Number(orderId);
  if (!Number.isInteger(normalizedOrderId) || normalizedOrderId <= 0) {
    const error = new Error('valid order id is required');
    error.statusCode = 400;
    throw error;
  }
  const normalizedRemark = normalizeOrderRemark(remark);
  const result = await database.query(
    `UPDATE orders
     SET order_remark = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [normalizedRemark, normalizedOrderId]
  );
  if (!result?.rowCount) {
    const error = new Error('order not found');
    error.statusCode = 404;
    throw error;
  }
  return { id: normalizedOrderId, order_remark: normalizedRemark };
}

async function reassignOrderOwner(database, { orderId, userId }) {
  const normalizedOrderId = Number(orderId);
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedOrderId) || normalizedOrderId <= 0) {
    const error = new Error('valid order id is required');
    error.statusCode = 400;
    throw error;
  }
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    const error = new Error('valid user is required');
    error.statusCode = 400;
    throw error;
  }

  const user = await database.getOne(
    "SELECT id, username FROM users WHERE id = ? AND role = 'user'",
    [normalizedUserId]
  );
  if (!user) {
    const error = new Error('valid user is required');
    error.statusCode = 400;
    throw error;
  }

  const order = await database.getOne(
    `SELECT o.id AS order_id,
            o.task_id,
            t.product_id,
            t.user_id AS old_user_id
     FROM orders o
     INNER JOIN tasks t ON t.id = o.task_id
     WHERE o.id = ?`,
    [normalizedOrderId]
  );
  if (!order) {
    const error = new Error('order not found');
    error.statusCode = 404;
    throw error;
  }

  if (Number(order.old_user_id) === normalizedUserId) {
    return {
      success: true,
      orderId: normalizedOrderId,
      userId: normalizedUserId,
      username: user.username,
      taskCount: 0
    };
  }

  let result;
  const productId = String(order.product_id || '').trim();
  if (productId && order.old_user_id !== null && order.old_user_id !== undefined) {
    result = await database.query(
      `UPDATE tasks
       SET user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE product_id = ?
         AND user_id = ?`,
      [normalizedUserId, productId, order.old_user_id]
    );
  } else {
    result = await database.query(
      `UPDATE tasks
       SET user_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [normalizedUserId, order.task_id]
    );
  }

  return {
    success: true,
    orderId: normalizedOrderId,
    userId: normalizedUserId,
    username: user.username,
    taskCount: result.rowCount || 0
  };
}

router.get('/users', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT u.id,
            u.username,
            u.role,
            COALESCE(u.user_level, 1) AS user_level,
            u.parent_user_id,
            COALESCE(u.bid_strategy_scope, 'all') AS bid_strategy_scope,
            p.username AS parent_username,
            COALESCE(p.user_level, 1) AS parent_user_level,
            u.created_at
     FROM users u
     LEFT JOIN users p ON p.id = u.parent_user_id
     WHERE u.role = 'user'
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne("SELECT COUNT(*) as total FROM users WHERE role = 'user'");
  res.json({ items, total: countResult?.total || 0 });
});

router.get('/users/options', async (req, res) => {
  const items = await db.getAll(
    `SELECT id, username, COALESCE(user_level, 1) AS user_level, parent_user_id, COALESCE(bid_strategy_scope, 'all') AS bid_strategy_scope
     FROM users
     WHERE role = 'user'
     ORDER BY user_level DESC, username ASC`
  );
  res.json({ items });
});

async function normalizeClientUserHierarchy(userLevel, parentUserId, selfId = null) {
  const level = Number(userLevel || 1);
  const parentId = parentUserId === null || parentUserId === undefined || parentUserId === '' ? null : Number(parentUserId);
  if (![1, 2, 3].includes(level)) {
    const err = new Error('valid user_level is required');
    err.status = 400;
    throw err;
  }
  if (!parentId) return { userLevel: level, parentUserId: null };
  if (level >= 3) {
    const err = new Error('client admin user cannot have parent user');
    err.status = 400;
    throw err;
  }
  if (String(parentId) === String(selfId)) {
    const err = new Error('parent user cannot be self');
    err.status = 400;
    throw err;
  }
  const parent = await db.getOne(
    "SELECT id, COALESCE(user_level, 1) AS user_level FROM users WHERE id = ? AND role = 'user'",
    [parentId]
  );
  if (!parent) {
    const err = new Error('parent user not found');
    err.status = 400;
    throw err;
  }
  if (Number(parent.user_level || 1) !== 2) {
    const err = new Error('parent user must be agent user');
    err.status = 400;
    throw err;
  }
  if (level === 1 && Number(parent.user_level || 1) !== 2) {
    const err = new Error('normal user parent must be agent user');
    err.status = 400;
    throw err;
  }
  if (level === 2 && Number(parent.user_level || 1) !== 2) {
    const err = new Error('agent user parent must be agent user');
    err.status = 400;
    throw err;
  }
  return { userLevel: level, parentUserId: parentId };
}

router.post('/users', async (req, res) => {
  const { username, password, user_level, parent_user_id } = req.body;
  const bidStrategyScope = normalizeBidStrategyScope(req.body?.bid_strategy_scope);
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const existing = await db.getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  let hierarchy;
  try {
    hierarchy = await normalizeClientUserHierarchy(user_level, parent_user_id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query(
    'INSERT INTO users (username, password_hash, role, user_level, parent_user_id, bid_strategy_scope) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hash, 'user', hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope]
  );
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id });
});

router.put('/users/:id', async (req, res) => {
  const { username, password, user_level, parent_user_id } = req.body;
  const bidStrategyScope = normalizeBidStrategyScope(req.body?.bid_strategy_scope);
  if (!username) return res.status(400).json({ error: 'username is required' });
  const existing = await db.getOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.params.id]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  let hierarchy;
  try {
    hierarchy = await normalizeClientUserHierarchy(user_level, parent_user_id, req.params.id);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "UPDATE users SET username = ?, password_hash = ?, role = 'user', user_level = ?, parent_user_id = ?, bid_strategy_scope = ? WHERE id = ? AND role = 'user'",
      [username, hash, hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope, req.params.id]
    );
  } else {
    await db.query(
      "UPDATE users SET username = ?, role = 'user', user_level = ?, parent_user_id = ?, bid_strategy_scope = ? WHERE id = ? AND role = 'user'",
      [username, hierarchy.userLevel, hierarchy.parentUserId, bidStrategyScope, req.params.id]
    );
  }
  res.json({ success: true });
});

router.delete('/users/:id', async (req, res) => {
  await db.query("UPDATE users SET parent_user_id = NULL WHERE parent_user_id = ? AND role = 'user'", [req.params.id]);
  await db.query("DELETE FROM users WHERE id = ? AND role = 'user'", [req.params.id]);
  res.json({ success: true });
});

router.get('/server-accounts', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT id, username, role, created_at FROM users WHERE role = 'admin' ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne("SELECT COUNT(*) as total FROM users WHERE role = 'admin'");
  res.json({ items, total: countResult?.total || 0 });
});

router.post('/server-accounts', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const existing = await db.getOne('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, hash, 'admin']);
  const inserted = await db.getOne('SELECT last_insert_rowid() as id');
  res.json({ success: true, id: inserted.id });
});

router.put('/server-accounts/:id', async (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'username is required' });
  const existing = await db.getOne('SELECT id FROM users WHERE username = ? AND id != ?', [username, req.params.id]);
  if (existing) return res.status(409).json({ error: 'username already exists' });
  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await db.query("UPDATE users SET username = ?, password_hash = ?, role = 'admin' WHERE id = ? AND role = 'admin'", [username, hash, req.params.id]);
  } else {
    await db.query("UPDATE users SET username = ?, role = 'admin' WHERE id = ? AND role = 'admin'", [username, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/server-accounts/:id', async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    return res.status(400).json({ error: 'cannot delete current server account' });
  }
  await db.query("DELETE FROM users WHERE id = ? AND role = 'admin'", [req.params.id]);
  res.json({ success: true });
});

// 账号管理
router.get('/accounts', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT * FROM yahoo_accounts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne('SELECT COUNT(*) as total FROM yahoo_accounts');
  res.json({ items, total: countResult?.total || 0 });
});

router.post('/accounts', async (req, res) => {
  const { account_name, email, profile_dir } = req.body;
  if (!account_name || !email) {
    return res.status(400).json({ error: 'account_name and email are required' });
  }
  try {
    await db.query(
      'INSERT INTO yahoo_accounts (account_name, email, profile_dir) VALUES (?, ?, ?)',
      [account_name, email, profile_dir]
    );
    const inserted = await db.getOne('SELECT last_insert_rowid() as id');
    res.json({ success: true, id: inserted.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/accounts/:id', async (req, res) => {
  const { account_name, email, profile_dir, status, error_msg } = req.body;
  if (!account_name || !email) {
    return res.status(400).json({ error: 'account_name and email are required' });
  }
  try {
    await db.query(
      `UPDATE yahoo_accounts
       SET account_name = ?, email = ?, profile_dir = ?, status = ?, error_msg = ?
       WHERE id = ?`,
      [account_name, email, profile_dir || null, status || 'idle', error_msg || null, req.params.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/accounts/:id', async (req, res) => {
  await db.query('DELETE FROM yahoo_accounts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// 账号统计
router.get('/accounts/stats', async (req, res) => {
  const stats = await db.getAll(
    "SELECT status, COUNT(*) as count FROM yahoo_accounts GROUP BY status"
  );
  res.json({ stats });
});

// 任务看板
router.get('/tasks', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  const tasksQuery = buildAdminTasksListQuery({ pageSize, offset });
  const items = await db.getAll(tasksQuery.sql, tasksQuery.params);
  const multiBidConfig = await getPluginMultiBidConfig();
  const nowMs = Date.now();
  const mappedItems = items.map(item => ({
    ...item,
    max_price: item.bid_mode === 'buyout'
      ? Number(item.user_max_price || item.buyout_price || item.max_price || 0)
      : item.max_price,
    next_execute_at: getNextExecuteAt(item, multiBidConfig, nowMs)
  }));
  const countResult = await db.getOne('SELECT COUNT(*) as total FROM tasks');
  const statusRows = await db.getAll(
    'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
  );
  const queue = {
    total: countResult?.total || 0,
    pending: 0,
    processing: 0,
    bidding: 0,
    success: 0,
    failed: 0
  };
  for (const row of statusRows) {
    queue[row.status] = row.count;
  }
  res.json({ items: mappedItems, total: queue.total, queue });
});

// 队列统计
router.get('/tasks/stats', async (req, res) => {
  const rows = await db.getAll(
    'SELECT status, COUNT(*) as count FROM tasks GROUP BY status'
  );
  const pendingTasksQuery = buildAdminPendingTasksQuery();
  const pendingTasks = await db.getAll(pendingTasksQuery.sql, pendingTasksQuery.params);
  const nextTask = chooseNextPluginTask(pendingTasks, Date.now(), await getPluginMultiBidConfig());
  const stats = {
    total: 0,
    pending: 0,
    processing: 0,
    bidding: 0,
    success: 0,
    failed: 0,
    nextTask: nextTask || null
  };
  for (const row of rows) {
    stats[row.status] = row.count;
    stats.total += row.count;
  }
  const loginStatus = await db.getOne("SELECT value, updated_at FROM config WHERE key = 'yahoo_login_status'");
  const loginMessage = await db.getOne("SELECT value FROM config WHERE key = 'yahoo_login_message'");
  stats.yahooLogin = buildYahooLoginStatus(loginStatus, loginMessage);
  res.json(stats);
});

// 订单管理
router.get('/orders', async (req, res) => {
  const { current = 1, pageSize = 10 } = req.query;
  const offset = (current - 1) * pageSize;
  await backfillMissingOrderStatusAuditLogs(db, 100).catch(() => null);
  const ordersQuery = buildAdminOrdersListQuery({ pageSize, offset });
  const items = await db.getAll(ordersQuery.sql, ordersQuery.params);
  const countResult = await db.getOne(`
    SELECT COUNT(*) as total
    FROM orders o
    INNER JOIN tasks t ON o.task_id = t.id
    WHERE t.status = 'success'
  `);
  const mappedItems = items.map(mapAdminOrderListItem);
  res.json({ items: mappedItems, total: countResult?.total || 0 });
});

router.get('/orders/user-won-date-range', async (req, res) => {
  const userId = Number(req.query.userId || 0);
  const fromDate = String(req.query.fromDate || '').trim();
  const toDate = String(req.query.toDate || '').trim();
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'valid userId is required' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return res.status(400).json({ error: 'valid fromDate and toDate are required' });
  }
  const query = buildAdminOrdersUserWonDateRangeQuery({ userId, fromDate, toDate });
  const items = await db.getAll(query.sql, query.params);
  res.json({ items: items.map(mapAdminOrderListItem), total: items.length });
});

router.get('/messages', async (req, res) => {
  const query = buildAdminMessagesListQuery(req.query || {});
  const [items, countResult] = await Promise.all([
    db.getAll(query.rows.sql, query.rows.params),
    db.getOne(query.count.sql, query.count.params)
  ]);
  res.json({
    items,
    total: countResult?.total || 0,
    current: query.pagination.current,
    pageSize: query.pagination.pageSize
  });
});

router.post('/messages/:orderId/update', async (req, res) => {
  try {
    res.json(await requestYahooMessageFetch(db, req.params.orderId));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'message update request failed' });
  }
});

router.post('/messages/:orderId/send', async (req, res) => {
  try {
    res.json(await requestYahooMessageSend(db, req.params.orderId, req.body?.message));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'message send request failed' });
  }
});

router.get('/online-users', async (req, res) => {
  const result = await getOnlineUsers(db);
  res.json(result);
});

router.get('/orders/:id/status-logs', async (req, res) => {
  const orderId = Number(req.params.id || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return res.status(400).json({ error: 'valid order id is required' });
  }
  const items = await db.getAll(
    `SELECT id, order_id, product_id, old_status, new_status, source, metadata, created_at
     FROM order_status_change_logs
     WHERE order_id = ?
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 20`,
    [orderId]
  );
  res.json({ items });
});

router.put('/orders/:id/remark', async (req, res) => {
  try {
    const result = await updateOrderRemark(db, {
      orderId: req.params.id,
      remark: req.body?.order_remark ?? req.body?.remark ?? ''
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || '备注保存失败' });
  }
});

router.put('/orders/:id/user', async (req, res) => {
  try {
    const result = await reassignOrderOwner(db, {
      orderId: req.params.id,
      userId: req.body?.userId ?? req.body?.user_id
    });
    res.json(result);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || '订单用户修改失败' });
  }
});

router.get('/orders/status-debug/:productId', async (req, res) => {
  const productId = extractAuctionId(req.params.productId || req.query.productId || '');
  if (!productId) {
    return res.status(400).json({ error: 'valid product id is required' });
  }
  const tasksQuery = buildOrderStatusDebugTasksQuery(productId);
  const tasks = await db.getAll(tasksQuery.sql, tasksQuery.params);
  const ordersQuery = buildOrderStatusDebugOrdersQuery(productId);
  const orders = await db.getAll(ordersQuery.sql, ordersQuery.params);
  const logs = await db.getAll(
    `SELECT l.*
     FROM order_status_change_logs l
     WHERE l.product_id = ?
        OR l.order_id IN (
          SELECT o.id FROM orders o INNER JOIN tasks t ON o.task_id = t.id WHERE t.product_id = ?
        )
     ORDER BY datetime(l.created_at) DESC, l.id DESC
     LIMIT 50`,
    [productId, productId]
  );
  const tableInfo = db.raw.prepare('PRAGMA table_info(orders)').all();
  const triggers = db.raw.prepare(
    "SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'orders'"
  ).all();
  res.json({ productId, tasks, orders, logs, ordersTableInfo: tableInfo, orderTriggers: triggers });
});

router.get('/debug/product/:productId', async (req, res) => {
  try {
    const productId = extractAuctionId(req.params.productId || req.query.productId || '');
    if (!productId) {
      return res.status(400).json({ error: 'valid product id is required' });
    }

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
      db.getAll(tasksQuery.sql, tasksQuery.params),
      db.getAll(bidLogsQuery.sql, bidLogsQuery.params),
      db.getAll(ordersQuery.sql, ordersQuery.params),
      db.getAll(orderLogsQuery.sql, orderLogsQuery.params),
      db.getAll(diagnosticsQuery.sql, diagnosticsQuery.params),
      db.getOne(snapshotQuery.sql, snapshotQuery.params),
      db.getAll(biddingItemsQuery.sql, biddingItemsQuery.params),
      db.getAll(configQuery.sql, configQuery.params)
    ]);

    res.json({
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
    });
  } catch (error) {
    console.error('[Admin Debug API] product report failed:', error);
    res.status(500).json({
      error: 'debug product report failed',
      detail: error.message || String(error)
    });
  }
});

// 财务统计
router.get('/orders/stats', async (req, res) => {
  const stats = await db.getOne(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(final_price), 0) as total_jpy,
      COALESCE(SUM(CASE WHEN settled_at IS NOT NULL THEN total_amount_cny ELSE 0 END), 0) as total_cny
    FROM orders
    INNER JOIN tasks t ON orders.task_id = t.id
    WHERE t.status = 'success'
  `);
  res.json(stats);
});

router.get('/reports/trusted-input', async (req, res) => {
  const queries = buildTrustedInputReportQueries(req.query || {});
  const [summaryRow, byAction, byMethod, rows, countRow] = await Promise.all([
    db.getOne(queries.summary.sql, queries.summary.params),
    db.getAll(queries.byAction.sql, queries.byAction.params),
    db.getAll(queries.byMethod.sql, queries.byMethod.params),
    db.getAll(queries.rows.sql, queries.rows.params),
    db.getOne(queries.count.sql, queries.count.params)
  ]);
  res.json({
    success: true,
    summary: {
      total: Number(summaryRow?.total || 0),
      info: Number(summaryRow?.info_count || 0),
      warn: Number(summaryRow?.warn_count || 0),
      error: Number(summaryRow?.error_count || 0),
      lastUsedAt: summaryRow?.last_used_at || null
    },
    byAction,
    byMethod,
    items: rows,
    total: Number(countRow?.total || 0),
    current: queries.pagination.current,
    pageSize: queries.pagination.pageSize
  });
});

router.get('/reports/bid-failures', async (req, res) => {
  const queries = buildBidFailureReportQueries(req.query || {});
  const [summaryRow, byAction, byStage, rows, countRow] = await Promise.all([
    db.getOne(queries.summary.sql, queries.summary.params),
    db.getAll(queries.byAction.sql, queries.byAction.params),
    db.getAll(queries.byStage.sql, queries.byStage.params),
    db.getAll(queries.rows.sql, queries.rows.params),
    db.getOne(queries.count.sql, queries.count.params)
  ]);
  res.json({
    success: true,
    summary: {
      total: Number(summaryRow?.total || 0),
      timeout: Number(summaryRow?.timeout_count || 0),
      systemError: Number(summaryRow?.system_error_count || 0),
      error: Number(summaryRow?.error_count || 0),
      lastFailedAt: summaryRow?.last_failed_at || null
    },
    byAction,
    byStage,
    items: rows,
    total: Number(countRow?.total || 0),
    current: queries.pagination.current,
    pageSize: queries.pagination.pageSize
  });
});

router.get('/reports/task-failure-users', async (req, res) => {
  const query = buildRecentTaskFailureUserReportQuery(req.query || {});
  const rows = await db.getAll(query.sql, query.params);
  res.json({
    success: true,
    days: query.days,
    items: rows.map(row => ({
      user_id: row.user_id,
      username: row.username || '-',
      timeout_count: Number(row.timeout_count || 0),
      system_count: Number(row.system_count || 0),
      total_count: Number(row.total_count || 0),
      last_failed_at: row.last_failed_at || null
    }))
  });
});

async function getFinanceConfig() {
  const rows = await db.getAll("SELECT key, value FROM config WHERE key IN ('jpy_to_cny_rate', 'bank_fee_jpy', 'handling_fee_cny', 'large_amount_fee_cny')");
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  if (!values.jpy_to_cny_rate) {
    const latestRate = await db.getOne('SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1');
    values.jpy_to_cny_rate = String(latestRate?.rate || '0.049');
  }
  return {
    rate: Number(values.jpy_to_cny_rate || 0.049),
    bankFeeJpy: Number(values.bank_fee_jpy || 0),
    handlingFeeCny: Number(values.handling_fee_cny || 0),
    largeAmountFeeCny: Number(values.large_amount_fee_cny || 0)
  };
}

const getTaxIncludedFinalPrice = taxExcludedToTaxIncluded;

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function applyUserFinanceConfig(baseConfig = {}, userConfig = null) {
  const rateAdjustment = normalizeNullableNumber(userConfig?.rate_adjustment) || 0;
  const userBankFee = normalizeNullableNumber(userConfig?.bank_fee_jpy);
  const userHandlingFee = normalizeNullableNumber(userConfig?.handling_fee_cny);
  const userLargeAmountFee = normalizeNullableNumber(userConfig?.large_amount_fee_cny);
  const hasUserFinanceOverride = Boolean(userConfig) && (
    normalizeNullableNumber(userConfig.rate_adjustment) !== null ||
    userBankFee !== null ||
    userHandlingFee !== null ||
    userLargeAmountFee !== null
  );

  return {
    rate: Number((Number(baseConfig.rate || 0) + rateAdjustment).toFixed(4)),
    rateAdjustment,
    bankFeeJpy: userBankFee !== null ? userBankFee : Number(baseConfig.bankFeeJpy || 0),
    handlingFeeCny: userHandlingFee !== null ? userHandlingFee : Number(baseConfig.handlingFeeCny || 0),
    largeAmountFeeCny: userLargeAmountFee !== null ? userLargeAmountFee : Number(baseConfig.largeAmountFeeCny || 0),
    hasUserFinanceOverride
  };
}

function buildOrderSettlement({ order, baseConfig, userFinanceOverride }) {
  const effectiveShippingFeeText = getEffectiveShippingFeeText(order);
  if (!canSettleOrderShippingFee(order)) {
    const error = new Error('该订单运费无法确认，不能结算');
    error.statusCode = 400;
    throw error;
  }
  const effectiveConfig = applyUserFinanceConfig(baseConfig, userFinanceOverride);
  const payable = calculateOrderPayable({
    finalPrice: order.final_price,
    taxType: order.tax_type,
    shippingFeeText: effectiveShippingFeeText,
    config: effectiveConfig
  });

  return {
    shippingFeeJpy: payable.shippingFee,
    bankFeeJpy: payable.bankFeeJpy,
    handlingFeeCny: payable.handlingFeeCny,
    largeAmountFeeCny: payable.largeAmountFeeCny,
    largeAmountFeeApplied: payable.largeAmountFeeApplied,
    taxIncludedFinalPrice: payable.taxIncludedFinalPrice,
    jpyToCnyRate: payable.rate,
    rateAdjustment: effectiveConfig.rateAdjustment,
    hasUserFinanceOverride: effectiveConfig.hasUserFinanceOverride,
    payableCny: payable.payableCny
  };
}

function buildOrderSettlementUpdateQuery(orderId, settlement) {
  return {
    sql: `UPDATE orders
         SET jpy_to_cny_rate = ?,
             bank_fee_jpy = ?,
             handling_fee_cny = ?,
             large_amount_fee_cny = ?,
             large_amount_fee_applied = ?,
             tax_included_final_price = ?,
             has_user_finance_override = ?,
             total_amount_cny = ?,
             settled_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
    params: [
      settlement.jpyToCnyRate,
      settlement.bankFeeJpy,
      settlement.handlingFeeCny,
      settlement.largeAmountFeeCny,
      settlement.largeAmountFeeApplied ? 1 : 0,
      settlement.taxIncludedFinalPrice,
      settlement.hasUserFinanceOverride ? 1 : 0,
      settlement.payableCny,
      orderId
    ]
  };
}

function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function parseStoreBundleChildProductIds(input) {
  return [...new Set(String(input || '')
    .split(/[,，]/)
    .map(value => extractAuctionId(value) || String(value || '').trim().toLowerCase())
    .filter(Boolean))];
}

function normalizeBundleShippingFeeText(value) {
  const amount = Number(String(value ?? '').replace(/[^\d]/g, ''));
  if (!Number.isInteger(amount) || amount < 0) {
    const error = new Error('valid bundle shipping fee is required');
    error.statusCode = 400;
    throw error;
  }
  return `${amount}円`;
}

function buildStoreBundleGroupId(mainProductId, nowMs = Date.now()) {
  return `store-bundle-${String(mainProductId || '').toLowerCase()}-${nowMs}`;
}

function assertStoreBundleBackfillRows({ mainProductId, childProductIds, rows }) {
  const ids = [mainProductId, ...childProductIds];
  const byProductId = new Map((rows || []).map(row => [String(row.product_id || '').toLowerCase(), row]));
  const missing = ids.filter(id => !byProductId.has(id));
  if (missing.length) {
    const error = new Error(`商品不存在或不是落札订单：${missing.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  const nonStore = ids.filter(id => byProductId.get(id)?.product_type !== 'store');
  if (nonStore.length) {
    const error = new Error(`只能补录商城商品：${nonStore.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
  const blocked = ids.filter(id => [ORDER_STATUS_COMPLETED, ORDER_STATUS_CANCELLED, ORDER_STATUS_PENDING_RECEIPT].includes(byProductId.get(id)?.order_status));
  if (blocked.length) {
    const error = new Error(`这些商品状态不能补录：${blocked.join(', ')}`);
    error.statusCode = 400;
    throw error;
  }
}

async function backfillStoreBundle(database, payload = {}, options = {}) {
  const mainProductId = extractAuctionId(payload.mainProductId || payload.main_product_id || '');
  const childProductIds = parseStoreBundleChildProductIds(payload.childProductIds || payload.child_product_ids || '');
  if (!mainProductId) {
    const error = new Error('mainProductId is required');
    error.statusCode = 400;
    throw error;
  }
  if (!childProductIds.length) {
    const error = new Error('childProductIds is required');
    error.statusCode = 400;
    throw error;
  }
  if (childProductIds.includes(mainProductId)) {
    const error = new Error('主商品不能同时作为子商品');
    error.statusCode = 400;
    throw error;
  }
  const bundleShippingFeeText = normalizeBundleShippingFeeText(payload.bundleShippingFee ?? payload.bundle_shipping_fee ?? payload.bundleShippingFeeText);
  const allProductIds = [mainProductId, ...childProductIds];
  const placeholders = allProductIds.map(() => '?').join(',');
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.order_status,
            t.product_id,
            COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE LOWER(t.product_id) IN (${placeholders})
       AND t.status = 'success'`,
    allProductIds
  );
  assertStoreBundleBackfillRows({ mainProductId, childProductIds, rows });

  const byProductId = new Map(rows.map(row => [String(row.product_id || '').toLowerCase(), row]));
  const mainOrderId = byProductId.get(mainProductId).order_id;
  const childOrderIds = childProductIds.map(id => byProductId.get(id).order_id);
  const orderIds = [mainOrderId, ...childOrderIds];
  const bundleGroupId = String(payload.bundleGroupId || '').trim() || buildStoreBundleGroupId(mainProductId, options.nowMs || Date.now());
  const beforeRows = await getOrderStatusAuditRows(database, orderIds);

  await database.query(
    `UPDATE orders
     SET bundle_group_id = ?,
         bundle_shipping_fee_text = ?,
         order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [bundleGroupId, bundleShippingFeeText, ORDER_STATUS_PENDING_SHIPMENT, mainOrderId]
  );

  if (childOrderIds.length) {
    const childPlaceholders = childOrderIds.map(() => '?').join(',');
    await database.query(
      `UPDATE orders
       SET bundle_group_id = ?,
           bundle_shipping_fee_text = '0円',
           order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${childPlaceholders})`,
      [bundleGroupId, ORDER_STATUS_BUNDLE_COMPLETED, ...childOrderIds]
    );
  }

  const statusesByOrderId = {
    [mainOrderId]: ORDER_STATUS_PENDING_SHIPMENT,
    ...Object.fromEntries(childOrderIds.map(id => [id, ORDER_STATUS_BUNDLE_COMPLETED]))
  };
  await writeOrderStatusAuditLogs(database, beforeRows, {
    statusesByOrderId,
    source: 'admin_store_bundle_backfill',
    metadata: {
      mainProductId,
      childProductIds,
      bundleShippingFeeText,
      bundleGroupId
    }
  }).catch(() => null);

  return {
    mainProductId,
    childProductIds,
    bundleShippingFeeText,
    bundleGroupId,
    mainOrderId,
    childOrderIds,
    updated: orderIds.length
  };
}

router.post('/orders/settle', async (req, res) => {
  const orderIds = Array.isArray(req.body?.orderIds) ? req.body.orderIds.map(Number).filter(Number.isFinite) : [];
  const rate = Number(req.body?.rate);
  if (orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds is required' });
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    return res.status(400).json({ error: 'valid rate is required' });
  }

  const financeConfig = await getFinanceConfig();
  const baseConfig = { ...financeConfig, rate };
  const results = [];

  for (const orderId of orderIds) {
    const orderQuery = buildOrderSettlementSelectQuery(orderId);
    const order = await db.getOne(orderQuery.sql, orderQuery.params);

    if (!order) {
      results.push({ orderId, success: false, error: '订单不存在' });
      continue;
    }

    try {
      const settlement = buildOrderSettlement({
        order,
        baseConfig,
        userFinanceOverride: {
          rate_adjustment: order.rate_adjustment,
          bank_fee_jpy: order.user_bank_fee_jpy,
          handling_fee_cny: order.user_handling_fee_cny,
          large_amount_fee_cny: order.user_large_amount_fee_cny
        }
      });
      const updateQuery = buildOrderSettlementUpdateQuery(orderId, settlement);
      await db.query(updateQuery.sql, updateQuery.params);

      results.push({ orderId, success: true, payableCny: settlement.payableCny });
    } catch (error) {
      results.push({ orderId, success: false, error: error.message || '结算失败' });
    }
  }

  res.json({
    success: results.some(item => item.success),
    settled: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length,
    results
  });
});

router.post('/orders/store-bundle-backfill', async (req, res) => {
  try {
    const result = await backfillStoreBundle(db, req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || '商城同捆补录失败' });
  }
});

router.get('/finance-config', async (req, res) => {
  res.json(await getFinanceConfig());
});

router.put('/finance-config', async (req, res) => {
  const hasRate = req.body.rate !== undefined && req.body.rate !== null && req.body.rate !== '';
  const rate = hasRate ? Number(req.body.rate) : null;
  const bankFeeJpy = Number(req.body.bankFeeJpy);
  const handlingFeeCny = Number(req.body.handlingFeeCny);
  const largeAmountFeeCny = Number(req.body.largeAmountFeeCny ?? 0);
  if (hasRate && (!Number.isFinite(rate) || rate <= 0)) {
    return res.status(400).json({ error: 'valid rate is required' });
  }
  if (!Number.isFinite(bankFeeJpy) || bankFeeJpy < 0) {
    return res.status(400).json({ error: 'valid bankFeeJpy is required' });
  }
  if (!Number.isFinite(handlingFeeCny) || handlingFeeCny < 0) {
    return res.status(400).json({ error: 'valid handlingFeeCny is required' });
  }
  if (!Number.isFinite(largeAmountFeeCny) || largeAmountFeeCny < 0) {
    return res.status(400).json({ error: 'valid largeAmountFeeCny is required' });
  }
  if (hasRate) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('jpy_to_cny_rate', ?, CURRENT_TIMESTAMP)`,
      [String(rate)]
    );
  }
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('bank_fee_jpy', ?, CURRENT_TIMESTAMP)`,
    [String(bankFeeJpy)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('handling_fee_cny', ?, CURRENT_TIMESTAMP)`,
    [String(handlingFeeCny)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('large_amount_fee_cny', ?, CURRENT_TIMESTAMP)`,
    [String(largeAmountFeeCny)]
  );
  res.json({ success: true, ...(hasRate ? { rate } : {}), bankFeeJpy, handlingFeeCny, largeAmountFeeCny });
});

async function getClientRateSettings() {
  return getWebsiteRate({ database: db });
}

router.get('/client-rate-settings', async (req, res) => {
  try {
    res.json(await getClientRateSettings());
  } catch (error) {
    res.status(503).json({ error: error.message || 'failed to fetch client rate settings' });
  }
});

router.put('/client-rate-settings', async (req, res) => {
  const adjustment = normalizeRateAdjustment(req.body?.baseAdjustment ?? req.body?.rateAdjustment, DEFAULT_CLIENT_RATE_ADJUSTMENT);
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('client_rate_adjustment', ?, CURRENT_TIMESTAMP)`,
    [String(adjustment)]
  );
  try {
    res.json(await getClientRateSettings());
  } catch (error) {
    res.json({ success: true, baseAdjustment: adjustment });
  }
});

router.get('/user-client-rate-overrides', async (req, res) => {
  const items = await db.getAll(
    `SELECT ucro.*, u.username
     FROM user_client_rate_overrides ucro
     INNER JOIN users u ON u.id = ucro.user_id
     WHERE u.role = 'user'
     ORDER BY u.username ASC`
  );
  res.json({ items });
});

async function saveUserClientRateOverride(body = {}) {
  const id = body.id ? Number(body.id) : null;
  const userId = Number(body.userId ?? body.user_id);
  const rateAdjustment = normalizeRateAdjustment(body.rateAdjustment ?? body.rate_adjustment, 0);

  if (!Number.isFinite(userId) || userId <= 0) {
    const error = new Error('valid userId is required');
    error.statusCode = 400;
    throw error;
  }

  if (id) {
    await db.query(
      `UPDATE user_client_rate_overrides
       SET user_id = ?, rate_adjustment = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [userId, rateAdjustment, id]
    );
    return { id };
  }

  await db.query(
    `INSERT INTO user_client_rate_overrides (user_id, rate_adjustment)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       rate_adjustment = excluded.rate_adjustment,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, rateAdjustment]
  );
  const row = await db.getOne('SELECT id FROM user_client_rate_overrides WHERE user_id = ?', [userId]);
  return { id: row?.id };
}

router.post('/user-client-rate-overrides', async (req, res) => {
  try {
    const result = await saveUserClientRateOverride(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.put('/user-client-rate-overrides/:id', async (req, res) => {
  try {
    const result = await saveUserClientRateOverride({ ...req.body, id: req.params.id });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.delete('/user-client-rate-overrides/:id', async (req, res) => {
  await db.query('DELETE FROM user_client_rate_overrides WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.get('/user-finance-overrides', async (req, res) => {
  const items = await db.getAll(
    `SELECT ufo.*, u.username
     FROM user_finance_overrides ufo
     INNER JOIN users u ON u.id = ufo.user_id
     WHERE u.role = 'user'
     ORDER BY u.username ASC`
  );
  res.json({ items });
});

router.post('/user-finance-overrides', async (req, res) => {
  try {
    const result = await saveUserFinanceOverride(req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.put('/user-finance-overrides/:id', async (req, res) => {
  try {
    const result = await saveUserFinanceOverride({ ...req.body, id: req.params.id });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'save failed' });
  }
});

router.delete('/user-finance-overrides/:id', async (req, res) => {
  await db.query('DELETE FROM user_finance_overrides WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

async function saveUserFinanceOverride(body = {}) {
  const id = body.id ? Number(body.id) : null;
  const userId = Number(body.userId ?? body.user_id);
  const rateAdjustment = normalizeNullableNumber(body.rateAdjustment ?? body.rate_adjustment);
  const bankFeeJpy = normalizeNullableNumber(body.bankFeeJpy ?? body.bank_fee_jpy);
  const handlingFeeCny = normalizeNullableNumber(body.handlingFeeCny ?? body.handling_fee_cny);
  const largeAmountFeeCny = normalizeNullableNumber(body.largeAmountFeeCny ?? body.large_amount_fee_cny);

  if (!Number.isFinite(userId) || userId <= 0) {
    const error = new Error('valid userId is required');
    error.statusCode = 400;
    throw error;
  }
  for (const [name, value] of [
    ['bankFeeJpy', bankFeeJpy],
    ['handlingFeeCny', handlingFeeCny],
    ['largeAmountFeeCny', largeAmountFeeCny]
  ]) {
    if (value !== null && value < 0) {
      const error = new Error(`valid ${name} is required`);
      error.statusCode = 400;
      throw error;
    }
  }

  if (id) {
    await db.query(
      `UPDATE user_finance_overrides
       SET user_id = ?, rate_adjustment = ?, bank_fee_jpy = ?, handling_fee_cny = ?, large_amount_fee_cny = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [userId, rateAdjustment, bankFeeJpy, handlingFeeCny, largeAmountFeeCny, id]
    );
    return { id };
  }

  await db.query(
    `INSERT INTO user_finance_overrides (user_id, rate_adjustment, bank_fee_jpy, handling_fee_cny, large_amount_fee_cny)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       rate_adjustment = excluded.rate_adjustment,
       bank_fee_jpy = excluded.bank_fee_jpy,
       handling_fee_cny = excluded.handling_fee_cny,
       large_amount_fee_cny = excluded.large_amount_fee_cny,
       updated_at = CURRENT_TIMESTAMP`,
    [userId, rateAdjustment, bankFeeJpy, handlingFeeCny, largeAmountFeeCny]
  );
  const row = await db.getOne('SELECT id FROM user_finance_overrides WHERE user_id = ?', [userId]);
  return { id: row?.id };
}

async function getMultiBidConfig() {
  await applyGoogleSheetsConfigFromDb(db);
  const rows = await db.getAll(
    "SELECT key, value FROM config WHERE key IN ('worker_interval_ms', 'client_notice_text', 'client_notice_marquee', 'multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'multi_bid_min_price', 'bid_concurrency_limit', 'yahoo_shipping_pref_code', 'transaction_start_hour', 'confirm_receipt_hour', 'confirm_receipt_color', 'scan_start_hour', 'scan_end_hour', 'scan_every_idle_runs', 'payment_job_limit', 'payment_job_limit_min', 'payment_job_limit_max', 'payment_page_stay_seconds')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const legacyPaymentJobLimit = normalizePositiveIntegerConfig(values.payment_job_limit, 3);
  const paymentJobLimitMin = normalizePositiveIntegerConfig(values.payment_job_limit_min, legacyPaymentJobLimit);
  const paymentJobLimitMax = normalizePositiveIntegerConfig(values.payment_job_limit_max, legacyPaymentJobLimit);
  return {
    workerIntervalMs: normalizePositiveIntegerConfig(values.worker_interval_ms, 10000),
    clientNoticeText: String(values.client_notice_text || ''),
    clientNoticeMarquee: Number(values.client_notice_marquee || 0) === 1,
    startHours: Number(values.multi_bid_start_hours || 0.5),
    intervalMinutes: Number(values.multi_bid_interval_minutes || 5),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || 5),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE),
    bidConcurrencyLimit: normalizePositiveIntegerConfig(values.bid_concurrency_limit, 2),
    yahooShippingPrefCode: normalizeYahooShippingPrefCode(values.yahoo_shipping_pref_code || '27'),
    transactionStartHour: Number(values.transaction_start_hour ?? 1),
    confirmReceiptHour: Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR),
    confirmReceiptColor: normalizeReceiptColorConfig(values.confirm_receipt_color, DEFAULT_CONFIRM_RECEIPT_COLOR),
    scanStartHour: Number(values.scan_start_hour ?? 1),
    scanEndHour: Number(values.scan_end_hour ?? 20),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? 5),
    paymentJobLimit: legacyPaymentJobLimit,
    paymentJobLimitMin: Math.min(paymentJobLimitMin, paymentJobLimitMax),
    paymentJobLimitMax: Math.max(paymentJobLimitMin, paymentJobLimitMax),
    paymentPageStaySeconds: normalizePositiveIntegerConfig(values.payment_page_stay_seconds, 3),
    googleSheetUrl: buildGoogleSheetUrl(getSheetConfig().spreadsheetId),
    googleSheetName: getSheetConfig().sheetName,
    googleCredentialPath: getGoogleSheetsCredentialPath()
  };
}

function normalizePositiveIntegerConfig(value, fallback) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeYahooShippingPrefCode(value, fallback = '27') {
  const text = String(value || '').trim().padStart(2, '0');
  return /^(0[1-9]|[1-3][0-9]|4[0-7])$/.test(text) ? text : fallback;
}

router.get('/multi-bid-config', async (req, res) => {
  res.json(await getMultiBidConfig());
});

router.put('/multi-bid-config', async (req, res) => {
  const workerIntervalMs = normalizePositiveIntegerConfig(req.body.workerIntervalMs ?? 10000, 10000);
  const startHours = Number(req.body.startHours);
  const intervalMinutes = Number(req.body.intervalMinutes);
  const idleSyncIntervalMinutes = Number(req.body.idleSyncIntervalMinutes ?? 5);
  const multiBidMinPrice = Number(req.body.multiBidMinPrice ?? DEFAULT_MULTI_BID_MIN_PRICE);
  const bidConcurrencyLimit = normalizePositiveIntegerConfig(req.body.bidConcurrencyLimit ?? 2, 2);
  const yahooShippingPrefCode = normalizeYahooShippingPrefCode(req.body.yahooShippingPrefCode ?? '27', '');
  const transactionStartHour = Number(req.body.transactionStartHour ?? 1);
  const confirmReceiptHour = Number(req.body.confirmReceiptHour ?? DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptColor = normalizeReceiptColorConfig(req.body.confirmReceiptColor ?? DEFAULT_CONFIRM_RECEIPT_COLOR, '');
  const scanStartHour = Number(req.body.scanStartHour ?? 1);
  const scanEndHour = Number(req.body.scanEndHour ?? 20);
  const scanEveryIdleRuns = Number(req.body.scanEveryIdleRuns ?? 5);
  const legacyPaymentJobLimit = normalizePositiveIntegerConfig(req.body.paymentJobLimit ?? 3, 3);
  const paymentJobLimitMin = normalizePositiveIntegerConfig(req.body.paymentJobLimitMin ?? legacyPaymentJobLimit, legacyPaymentJobLimit);
  const paymentJobLimitMax = normalizePositiveIntegerConfig(req.body.paymentJobLimitMax ?? legacyPaymentJobLimit, legacyPaymentJobLimit);
  const paymentPageStaySeconds = normalizePositiveIntegerConfig(req.body.paymentPageStaySeconds ?? 3, 3);
  const clientNoticeText = String(req.body.clientNoticeText || '').trim().slice(0, 500);
  const clientNoticeMarquee = req.body.clientNoticeMarquee === true || req.body.clientNoticeMarquee === '1' ? '1' : '0';
  const googleConfigEditable = req.body.googleConfigEditable === true;
  const googleSheetId = extractSpreadsheetId(req.body.googleSheetUrl || '');
  const googleSheetName = String(req.body.googleSheetName || '').trim();
  const googleCredentialPath = String(req.body.googleCredentialPath || '').trim();
  if (!Number.isFinite(startHours) || startHours <= 0) {
    return res.status(400).json({ error: 'valid startHours is required' });
  }
  if (workerIntervalMs < 1000 || workerIntervalMs > 60000) {
    return res.status(400).json({ error: 'valid workerIntervalMs is required' });
  }
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid intervalMinutes is required' });
  }
  if (!Number.isFinite(idleSyncIntervalMinutes) || idleSyncIntervalMinutes <= 0) {
    return res.status(400).json({ error: 'valid idleSyncIntervalMinutes is required' });
  }
  if (!Number.isFinite(multiBidMinPrice) || multiBidMinPrice <= 0 || Math.floor(multiBidMinPrice) !== multiBidMinPrice) {
    return res.status(400).json({ error: 'valid multiBidMinPrice is required' });
  }
  if (bidConcurrencyLimit < 1 || bidConcurrencyLimit > 10) {
    return res.status(400).json({ error: 'valid bidConcurrencyLimit is required' });
  }
  if (!yahooShippingPrefCode) {
    return res.status(400).json({ error: 'valid yahooShippingPrefCode is required' });
  }
  for (const [name, value] of [
    ['transactionStartHour', transactionStartHour],
    ['confirmReceiptHour', confirmReceiptHour],
    ['scanStartHour', scanStartHour],
    ['scanEndHour', scanEndHour]
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 23 || Math.floor(value) !== value) {
      return res.status(400).json({ error: `valid ${name} is required` });
    }
  }
  if (!Number.isFinite(scanEveryIdleRuns) || scanEveryIdleRuns <= 0 || Math.floor(scanEveryIdleRuns) !== scanEveryIdleRuns) {
    return res.status(400).json({ error: 'valid scanEveryIdleRuns is required' });
  }
  if (!confirmReceiptColor) {
    return res.status(400).json({ error: 'valid confirmReceiptColor is required' });
  }
  if (paymentJobLimitMin > paymentJobLimitMax) {
    return res.status(400).json({ error: 'paymentJobLimitMin must be <= paymentJobLimitMax' });
  }
  if (googleConfigEditable && !googleSheetId) {
    return res.status(400).json({ error: 'valid googleSheetUrl is required' });
  }
  if (googleConfigEditable && !googleSheetName) {
    return res.status(400).json({ error: 'valid googleSheetName is required' });
  }
  if (googleConfigEditable && !googleCredentialPath) {
    return res.status(400).json({ error: 'valid googleCredentialPath is required' });
  }
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('worker_interval_ms', ?, CURRENT_TIMESTAMP)`,
    [String(workerIntervalMs)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('client_notice_text', ?, CURRENT_TIMESTAMP)`,
    [clientNoticeText]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('client_notice_marquee', ?, CURRENT_TIMESTAMP)`,
    [clientNoticeMarquee]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_start_hours', ?, CURRENT_TIMESTAMP)`,
    [String(startHours)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_interval_minutes', ?, CURRENT_TIMESTAMP)`,
    [String(intervalMinutes)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('idle_sync_interval_minutes', ?, CURRENT_TIMESTAMP)`,
    [String(idleSyncIntervalMinutes)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('multi_bid_min_price', ?, CURRENT_TIMESTAMP)`,
    [String(multiBidMinPrice)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('bid_concurrency_limit', ?, CURRENT_TIMESTAMP)`,
    [String(bidConcurrencyLimit)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('yahoo_shipping_pref_code', ?, CURRENT_TIMESTAMP)`,
    [yahooShippingPrefCode]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_hour', ?, CURRENT_TIMESTAMP)`,
    [String(transactionStartHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_hour', ?, CURRENT_TIMESTAMP)`,
    [String(confirmReceiptHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_color', ?, CURRENT_TIMESTAMP)`,
    [confirmReceiptColor]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_start_hour', ?, CURRENT_TIMESTAMP)`,
    [String(scanStartHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_end_hour', ?, CURRENT_TIMESTAMP)`,
    [String(scanEndHour)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('scan_every_idle_runs', ?, CURRENT_TIMESTAMP)`,
    [String(scanEveryIdleRuns)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMax)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit_min', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMin)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_job_limit_max', ?, CURRENT_TIMESTAMP)`,
    [String(paymentJobLimitMax)]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('payment_page_stay_seconds', ?, CURRENT_TIMESTAMP)`,
    [String(paymentPageStaySeconds)]
  );
  if (googleConfigEditable) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_sheets_spreadsheet_id', ?, CURRENT_TIMESTAMP)`,
      [googleSheetId]
    );
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_sheets_sheet_name', ?, CURRENT_TIMESTAMP)`,
      [googleSheetName]
    );
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('google_application_credentials', ?, CURRENT_TIMESTAMP)`,
      [googleCredentialPath]
    );
    applyGoogleSheetsConfig({ googleSheetId, googleSheetName, googleCredentialPath });
  }
  res.json({ success: true, workerIntervalMs, clientNoticeText, clientNoticeMarquee: clientNoticeMarquee === '1', startHours, intervalMinutes, idleSyncIntervalMinutes, multiBidMinPrice, transactionStartHour, confirmReceiptHour, confirmReceiptColor, scanStartHour, scanEndHour, scanEveryIdleRuns, paymentJobLimit: paymentJobLimitMax, paymentJobLimitMin, paymentJobLimitMax, paymentPageStaySeconds, googleSheetName });
});

router.post('/transaction-start/request', async (req, res) => {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_requested', '1', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('transaction_start_requested_source', 'manual', CURRENT_TIMESTAMP)`
  );
  res.json({ success: true });
});

router.post('/confirm-receipt/request', async (req, res) => {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_alert_message', '', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_requested', '1', CURRENT_TIMESTAMP)`
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('confirm_receipt_requested_source', 'manual', CURRENT_TIMESTAMP)`
  );
  res.json({ success: true });
});

async function requestScan(database = db) {
  const row = await database.getOne(
    `SELECT value FROM config WHERE key = 'scan_every_idle_runs'`
  );
  const scanEveryIdleRuns = Math.max(1, Math.floor(Number(row?.value || 5) || 5));
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('scan_idle_counter', ?, CURRENT_TIMESTAMP)`,
    [String(scanEveryIdleRuns)]
  );
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('scan_requested', '1', CURRENT_TIMESTAMP)`
  );
  return { scanIdleCounter: scanEveryIdleRuns, scanRequested: true };
}

async function saveConfigValue(database, key, value) {
  const allowedKeys = new Set([
    'payment_requested',
    'payment_alert_message',
    'scan_idle_counter',
    'transaction_start_requested',
    'transaction_start_requested_source'
  ]);
  if (!allowedKeys.has(key)) {
    throw new Error('invalid config key');
  }
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('${key}', ?, CURRENT_TIMESTAMP)`,
    [String(value)]
  );
}

async function requestPayment(database = db, orderIds = []) {
  const ids = Array.isArray(orderIds) ? orderIds.map(Number).filter(id => Number.isInteger(id) && id > 0) : [];
  if (!ids.length) {
    const error = new Error('orderIds is required');
    error.statusCode = 400;
    throw error;
  }
  const placeholders = ids.map(() => '?').join(',');
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND order_status IN (?,?)
       AND settled_at IS NOT NULL
       AND total_amount_cny IS NOT NULL`,
    [
      ORDER_STATUS_PENDING_SETTLEMENT,
      ...ids,
      ORDER_STATUS_PENDING_PAYMENT,
      ORDER_STATUS_PENDING_SETTLEMENT
    ]
  );
  if ((result.rowCount || 0) > 0) {
    await saveConfigValue(database, 'payment_requested', '1');
  }
  return { requested: result.rowCount || 0 };
}

async function clearPaymentAlertAndContinue(database = db) {
  await saveConfigValue(database, 'payment_alert_message', '');
  await saveConfigValue(database, 'payment_requested', '1');
  return { success: true };
}

function normalizeImportDate(value, fallback = '') {
  const text = String(value || fallback || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeImportMaxPages(value) {
  const num = Math.floor(Number(value || 10));
  if (!Number.isFinite(num) || num <= 0) return 10;
  return Math.min(50, Math.max(1, num));
}

function normalizeImportProductId(value) {
  const match = String(value || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function normalizeImportYenAmount(value) {
  const match = String(value || '').match(/(\d[\d,]*)/);
  return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
}

async function createManualOrderImportBatch(payload = {}, database = db) {
  const startDate = normalizeImportDate(payload.startDate || payload.start_date);
  const endDate = normalizeImportDate(payload.endDate || payload.end_date);
  if (!startDate || !endDate) {
    const error = new Error('valid startDate and endDate are required');
    error.statusCode = 400;
    throw error;
  }
  if (startDate > endDate) {
    const error = new Error('startDate must be <= endDate');
    error.statusCode = 400;
    throw error;
  }
  const maxPages = normalizeImportMaxPages(payload.maxPages || payload.max_pages);
  const result = await database.query(
    `INSERT INTO manual_order_import_batches
       (start_date, end_date, max_pages, status, created_at, updated_at)
     VALUES (?, ?, ?, 'requested', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [startDate, endDate, maxPages]
  );
  const row = await database.getOne('SELECT last_insert_rowid() AS id');
  return { id: row?.id, startDate, endDate, maxPages, requested: result.rowCount || 0 };
}

async function getManualOrderImportBatch(batchId, database = db) {
  const id = Number(batchId || 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  return await database.getOne(
    `SELECT * FROM manual_order_import_batches WHERE id = ?`,
    [id]
  );
}

async function listManualOrderImportBatches(database = db) {
  return await database.getAll(
    `SELECT *
     FROM manual_order_import_batches
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT 20`
  );
}

async function listManualOrderImportItems(batchId, database = db) {
  return await database.getAll(
    `SELECT i.*, u.username AS assigned_username
     FROM manual_order_import_items i
     LEFT JOIN users u ON u.id = i.assigned_user_id
     WHERE i.batch_id = ?
     ORDER BY datetime(COALESCE(i.won_at, i.created_at)) DESC, i.id ASC`,
    [batchId]
  );
}

async function deleteManualOrderImportBatch(batchId, database = db) {
  const batch = await getManualOrderImportBatch(batchId, database);
  if (!batch) {
    const error = new Error('import batch not found');
    error.statusCode = 404;
    throw error;
  }
  await database.query(
    `DELETE FROM manual_order_import_items WHERE batch_id = ?`,
    [batch.id]
  );
  const result = await database.query(
    `DELETE FROM manual_order_import_batches WHERE id = ?`,
    [batch.id]
  );
  return { deleted: result.rowCount || 0, id: batch.id };
}

function normalizeManualOrderImportSummary(summary = {}) {
  const requested = Number(summary?.requested || 0);
  const scanning = Number(summary?.scanning || 0);
  return {
    flag: requested + scanning > 0 ? 1 : 0,
    requested,
    scanning,
    ready: Number(summary?.ready || 0),
    readyEmpty: Number(summary?.ready_empty || summary?.readyEmpty || 0)
  };
}

async function confirmManualOrderImport(batchId, assignments = [], database = db) {
  const batch = await getManualOrderImportBatch(batchId, database);
  if (!batch) {
    const error = new Error('import batch not found');
    error.statusCode = 404;
    throw error;
  }
  if (!['ready', 'confirmed'].includes(String(batch.status || ''))) {
    const error = new Error('import batch is not ready');
    error.statusCode = 400;
    throw error;
  }

  for (const item of Array.isArray(assignments) ? assignments : []) {
    const itemId = Number(item?.itemId || item?.id || 0);
    const userId = Number(item?.userId || item?.assignedUserId || 0);
    const shippingFeeText = String(item?.shippingFeeText ?? item?.shipping_fee_text ?? '').trim();
    if (!Number.isInteger(itemId) || itemId <= 0) continue;
    if (!Number.isInteger(userId) || userId <= 0) {
      if (shippingFeeText) {
        await database.query(
          `UPDATE manual_order_import_items
           SET shipping_fee_text = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND batch_id = ? AND status = 'pending_user'`,
          [shippingFeeText, itemId, batch.id]
        );
      }
      continue;
    }
    const assignableUser = await database.getOne(
      `SELECT id FROM users
       WHERE id = ? AND role = 'user' AND COALESCE(user_level, 1) < 3`,
      [userId]
    );
    if (!assignableUser) {
      const error = new Error('assigned user must be normal or agent user');
      error.statusCode = 400;
      throw error;
    }
    await database.query(
      `UPDATE manual_order_import_items
       SET assigned_user_id = ?, shipping_fee_text = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND batch_id = ? AND status = 'pending_user'`,
      [userId, shippingFeeText, itemId, batch.id]
    );
  }

  const unassigned = await database.getOne(
    `SELECT COUNT(*) AS count
     FROM manual_order_import_items
     WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NULL`,
    [batch.id]
  );
  const skippedUnassigned = Number(unassigned?.count || 0);
  if (skippedUnassigned > 0) {
    await database.query(
      `UPDATE manual_order_import_items
       SET status = 'skipped_unassigned', updated_at = CURRENT_TIMESTAMP
       WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NULL`,
      [batch.id]
    );
  }

  const items = await database.getAll(
    `SELECT *
     FROM manual_order_import_items
     WHERE batch_id = ? AND status = 'pending_user' AND assigned_user_id IS NOT NULL
     ORDER BY id ASC`,
    [batch.id]
  );
  let imported = 0;
  let skippedExisting = 0;

  for (const item of items) {
    const productId = normalizeImportProductId(item.product_id);
    if (!productId || !item.assigned_user_id) continue;
    const existing = await database.getOne(
      `SELECT o.id
       FROM orders o
       INNER JOIN tasks t ON t.id = o.task_id
       WHERE t.product_id = ?
       LIMIT 1`,
      [productId]
    );
    if (existing) {
      skippedExisting += 1;
      await database.query(
        `UPDATE manual_order_import_items
         SET status = 'skipped_existing', order_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [existing.id, item.id]
      );
      continue;
    }
    const importProductUrl = item.product_url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`;
    const importFinalPrice = normalizeImportYenAmount(item.final_price);
    await upsertProductSnapshot(database, {
      product_id: productId,
      product_url: importProductUrl,
      product_title: item.product_title || null,
      product_image_url: item.product_image_url || '',
      current_price: importFinalPrice,
      tax_type: item.tax_type || 'tax_zero',
      product_type: item.product_type || 'normal',
      shipping_fee_text: item.shipping_fee_text || '',
      end_time: null
    }, { source: 'fetch' });
    await database.query(
      `INSERT INTO tasks
        (user_id, product_id, max_price, user_max_price,
         strategy, bid_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual_import', 'manual_import', 'success', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        item.assigned_user_id,
        productId,
        importFinalPrice,
        importFinalPrice
      ]
    );
    const taskRow = await database.getOne('SELECT last_insert_rowid() AS id');
    await database.query(
      `INSERT INTO orders
        (task_id, product_id, final_price, won_at, won_time_text,
         transaction_url, order_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        taskRow.id,
        productId,
        importFinalPrice,
        item.won_at || null,
        item.won_time_text || null,
        item.transaction_url || null
      ]
    );
    const orderRow = await database.getOne('SELECT last_insert_rowid() AS id');
    await database.query(
      `UPDATE manual_order_import_items
       SET status = 'imported', task_id = ?, order_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [taskRow.id, orderRow.id, item.id]
    );
    imported += 1;
  }

  await database.query(
    `UPDATE manual_order_import_batches
     SET status = 'confirmed',
         skipped_existing_count = COALESCE(skipped_existing_count, 0) + ?,
         confirmed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [skippedExisting, batch.id]
  );
  return { imported, skippedExisting, skippedUnassigned };
}

router.post('/scan/request', async (req, res) => {
  const result = await requestScan(db);
  res.json({ success: true, ...result });
});

router.post('/payment/request', async (req, res) => {
  try {
    const result = await requestPayment(db, req.body?.orderIds || []);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment request failed' });
  }
});

router.post('/payment/continue', async (req, res) => {
  const result = await clearPaymentAlertAndContinue(db);
  res.json(result);
});

router.post('/manual-order-import/request', async (req, res) => {
  try {
    const result = await createManualOrderImportBatch(req.body || {}, db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual order import request failed' });
  }
});

router.get('/manual-order-import/batches', async (req, res) => {
  const items = await listManualOrderImportBatches(db);
  res.json({ success: true, items });
});

router.get('/manual-order-import/batches/:id', async (req, res) => {
  const batch = await getManualOrderImportBatch(req.params.id, db);
  if (!batch) return res.status(404).json({ error: 'import batch not found' });
  const items = await listManualOrderImportItems(batch.id, db);
  res.json({ success: true, batch, items });
});

router.delete('/manual-order-import/batches/:id', async (req, res) => {
  try {
    const result = await deleteManualOrderImportBatch(req.params.id, db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'delete import batch failed' });
  }
});

router.post('/manual-order-import/batches/:id/confirm', async (req, res) => {
  try {
    const result = await confirmManualOrderImport(req.params.id, req.body?.assignments || [], db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual order import confirm failed' });
  }
});

router.post('/manual-captcha/answer', async (req, res) => {
  try {
    const challenge = await answerCaptchaChallenge(db, req.body || {});
    res.json({ success: true, id: challenge.id, answeredAt: challenge.answeredAt });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'captcha answer failed' });
  }
});

router.post('/manual-captcha/close', async (req, res) => {
  const result = await closeCaptchaChallenge(db, req.body?.id || '');
  res.json({ success: true, ...result });
});

router.get('/idle-flags', async (req, res) => {
  await ensureScheduledTransactionStartRequest(db);
  await ensureScheduledConfirmReceiptRequest(db);
  const rows = await db.getAll(
    `SELECT key, value, updated_at FROM config
     WHERE key IN (
       'transaction_start_hour',
       'transaction_start_requested',
       'transaction_start_last_run_date',
       'transaction_start_last_run_slot',
       'transaction_start_last_run_log',
       'confirm_receipt_hour',
       'confirm_receipt_requested',
       'confirm_receipt_last_run_slot',
       'confirm_receipt_alert_message',
       'scan_every_idle_runs',
       'scan_idle_counter',
       'payment_requested',
       'payment_alert_message',
       'shipment_alerts'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const updatedAt = Object.fromEntries(rows.map(row => [row.key, row.updated_at]));
  const today = getLocalDateKey();
  const transactionStartHour = Number(values.transaction_start_hour ?? 1);
  const transactionStartRequested = Number(values.transaction_start_requested || 0) === 1;
  const transactionStartLastRunDate = values.transaction_start_last_run_date || '';
  let transactionStartLastRunLog = null;
  try {
    transactionStartLastRunLog = values.transaction_start_last_run_log
      ? JSON.parse(values.transaction_start_last_run_log)
      : null;
  } catch {
    transactionStartLastRunLog = null;
  }
  const transactionStartFlag = transactionStartRequested || shouldAutoRequestTransactionStart({
    transactionStartHour,
    transactionStartHourUpdatedAt: updatedAt.transaction_start_hour || '',
    transactionStartLastRunSlot: values.transaction_start_last_run_slot || '',
    transactionStartLastRunLog: values.transaction_start_last_run_log || ''
  }) ? 1 : 0;
  const confirmReceiptHour = Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptRequested = Number(values.confirm_receipt_requested || 0) === 1;
  const confirmReceiptFlag = confirmReceiptRequested || shouldAutoRequestConfirmReceipt({
    confirmReceiptHour,
    confirmReceiptHourUpdatedAt: updatedAt.confirm_receipt_hour || '',
    confirmReceiptLastRunSlot: values.confirm_receipt_last_run_slot || ''
  }) ? 1 : 0;
  const scanEveryIdleRuns = Math.max(1, Number(values.scan_every_idle_runs || 5));
  const scanIdleCounter = Math.max(0, Number(values.scan_idle_counter || 0));
  const manualImportSummary = await db.getOne(
    `SELECT
       SUM(CASE WHEN status = 'requested' THEN 1 ELSE 0 END) AS requested,
       SUM(CASE WHEN status = 'scanning' THEN 1 ELSE 0 END) AS scanning,
       SUM(CASE WHEN status = 'ready' AND COALESCE(candidate_count, 0) > 0 THEN 1 ELSE 0 END) AS ready,
       SUM(CASE WHEN status = 'ready' AND COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS ready_empty
     FROM manual_order_import_batches
     WHERE status IN ('requested', 'scanning', 'ready')`
  );
  const manualImportFlags = normalizeManualOrderImportSummary(manualImportSummary);

  res.json({
    success: true,
    transactionStartFlag,
    transactionStartRequested: transactionStartRequested ? 1 : 0,
    transactionStartHour,
    transactionStartLastRunDate,
    transactionStartLastRunLog,
    confirmReceiptFlag,
    confirmReceiptRequested: confirmReceiptRequested ? 1 : 0,
    confirmReceiptHour,
    confirmReceiptAlertMessage: values.confirm_receipt_alert_message || '',
    scanFlag: scanIdleCounter,
    scanEveryIdleRuns,
    manualOrderImportFlag: manualImportFlags.flag,
    manualOrderImportRequested: manualImportFlags.requested,
    manualOrderImportScanning: manualImportFlags.scanning,
    manualOrderImportReady: manualImportFlags.ready,
    manualOrderImportReadyEmpty: manualImportFlags.readyEmpty,
    paymentFlag: Number(values.payment_requested || 0) === 1 ? 1 : 0,
    paymentAlertMessage: values.payment_alert_message || '',
    captchaChallenge: await getCaptchaChallenge(db),
    shipmentAlerts: (await getShipmentAlerts(db)).filter(alert => !alert.closedAt && !alert.autoClosedAt)
  });
});

router.post('/shipment-alerts/:id/close', async (req, res) => {
  const alertId = String(req.params.id || '').trim();
  if (!alertId) return res.status(400).json({ error: 'alert id is required' });
  const alerts = await getShipmentAlerts(db);
  let closed = 0;
  const next = alerts.map(alert => {
    if (alert.id !== alertId || alert.closedAt || alert.autoClosedAt) return alert;
    closed += 1;
    return { ...alert, closedAt: new Date().toISOString() };
  });
  if (closed) {
    await db.query(
      `INSERT OR REPLACE INTO config (key, value, updated_at)
       VALUES ('shipment_alerts', ?, CURRENT_TIMESTAMP)`,
      [JSON.stringify(next)]
    );
  }
  res.json({ success: true, closed });
});

function parseShippingRefreshIds(value) {
  const seen = new Set();
  return String(value || '')
    .split(/\r?\n|,|，/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => normalizeAuctionUrl(item)?.auctionId || '')
    .filter(id => {
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

async function markProductOrdersForResync(database, productId) {
  const normalizedProductId = normalizeAuctionUrl(productId)?.auctionId || String(productId || '').trim().toLowerCase();
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }

  const existingOrderRows = await database.getAll(
    `SELECT o.id AS order_id, t.id AS task_id, t.status
     FROM orders o
     INNER JOIN tasks t ON t.id = o.task_id
     WHERE t.product_id = ?
     ORDER BY datetime(COALESCE(o.won_at, t.updated_at, t.created_at)) DESC, o.id DESC`,
    [normalizedProductId]
  );
  if (existingOrderRows.length > 0) {
    const taskIds = [...new Set(existingOrderRows.map(row => Number(row.task_id)).filter(Boolean))];
    const updateResult = await database.query(
      `UPDATE tasks
       SET force_orders_resync = 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${buildPlaceholders(taskIds)})`,
      taskIds
    );
    return {
      productId: normalizedProductId,
      success: true,
      taskId: taskIds[0],
      taskIds,
      orderIds: existingOrderRows.map(row => row.order_id),
      taskStatus: existingOrderRows[0]?.status || '',
      hasExistingOrder: true,
      markedCount: updateResult.rowCount || 0
    };
  }

  const task = await database.getOne(
    `SELECT id, status FROM tasks
     WHERE product_id = ?
     ORDER BY datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
     LIMIT 1`,
    [normalizedProductId]
  );
  if (!task) {
    return { productId: normalizedProductId, success: false, error: '系统中没有这个商品' };
  }
  const updateResult = await database.query(
    `UPDATE tasks
     SET force_orders_resync = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [task.id]
  );
  return {
    productId: normalizedProductId,
    success: true,
    taskId: task.id,
    taskIds: [task.id],
    taskStatus: task.status,
    hasExistingOrder: false,
    markedCount: updateResult.rowCount || 0
  };
}

async function markTrackingRescanByProductId(database, productId) {
  const normalizedProductId = normalizeAuctionUrl(productId)?.auctionId || String(productId || '').trim().toLowerCase();
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }

  const rows = await database.getAll(
    `SELECT o.id AS order_id
     FROM orders o
     INNER JOIN tasks t ON t.id = o.task_id
     WHERE t.product_id = ?
       AND o.order_status = ?
     ORDER BY datetime(COALESCE(o.shipped_at, o.updated_at, o.created_at)) DESC, o.id DESC`,
    [normalizedProductId, ORDER_STATUS_PENDING_RECEIPT]
  );
  if (!rows.length) {
    return { productId: normalizedProductId, success: false, error: '没有可重扫单号的待收货订单' };
  }
  const orderIds = rows.map(row => row.order_id).filter(Boolean);
  const updateResult = await database.query(
    `UPDATE orders
     SET tracking_rescan_requested = 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${buildPlaceholders(orderIds)})`,
    orderIds
  );
  return {
    productId: normalizedProductId,
    success: true,
    orderIds,
    markedCount: updateResult.rowCount || 0
  };
}

function normalizeProductType(value) {
  if (value === 'normal' || value === 'store') return value;
  if (value === 'tax_zero') return 'normal';
  if (value === 'tax_included') return 'store';
  return '';
}

function normalizeProductRefreshId(productId) {
  return normalizeAuctionUrl(productId)?.auctionId || String(productId || '').trim().toLowerCase();
}

function buildFetchedProductSnapshot(productId, productData = {}) {
  const taxType = productData.taxType || productData.tax_type || null;
  const productType = normalizeProductType(productData.productType || productData.product_type || taxType) || null;
  return {
    product_id: productId,
    product_url: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
    product_title: productData.title || productData.productTitle || productData.product_title || null,
    product_image_url: productData.imageUrl || productData.productImageUrl || productData.product_image_url || null,
    current_price: productData.currentPrice || productData.current_price || null,
    buyout_price: productData.buyoutPrice || productData.buyout_price || null,
    bid_count: productData.bidCount || productData.bid_count || null,
    tax_type: taxType,
    product_type: productType,
    shipping_fee_text: productData.shippingFeeText || productData.shipping_fee_text || null,
    end_time: productData.endTime || productData.end_time || null
  };
}

async function refreshProductShippingFee(database, service, productId) {
  const normalizedProductId = normalizeProductRefreshId(productId);
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }
  const taskCount = await database.getOne('SELECT COUNT(*) AS count FROM tasks WHERE product_id = ?', [normalizedProductId]);
  if (!taskCount?.count) {
    return { productId: normalizedProductId, success: false, error: '系统中没有这个商品' };
  }

  const product = await service.fetchProduct(`https://auctions.yahoo.co.jp/jp/auction/${normalizedProductId}`);
  const productData = product?.data || {};
  const shippingFeeText = String(productData.shippingFeeText || productData.shipping_fee_text || '').trim();
  if (!shippingFeeText) {
    return { productId: normalizedProductId, success: false, error: '未解析到运费，未更新' };
  }
  await upsertProductSnapshot(database, {
    ...buildFetchedProductSnapshot(normalizedProductId, productData),
    shipping_fee_text: shippingFeeText
  }, { source: 'admin_refresh', overwriteProductTitle: true });
  return {
    productId: normalizedProductId,
    success: true,
    shippingFeeText,
    updatedCount: Number(taskCount?.count || 0)
  };
}

async function refreshProductType(database, service, productId) {
  const normalizedProductId = normalizeProductRefreshId(productId);
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }
  const taskCount = await database.getOne('SELECT COUNT(*) AS count FROM tasks WHERE product_id = ?', [normalizedProductId]);
  if (!taskCount?.count) {
    return { productId: normalizedProductId, success: false, error: '系统中没有这个商品' };
  }

  const product = await service.fetchProduct(`https://auctions.yahoo.co.jp/jp/auction/${normalizedProductId}`);
  const productData = product?.data || {};
  const productType = normalizeProductType(productData.productType || productData.product_type || productData.taxType || productData.tax_type);
  if (!productType) {
    return { productId: normalizedProductId, success: false, error: '未解析到商品类型，未更新' };
  }
  await upsertProductSnapshot(database, {
    ...buildFetchedProductSnapshot(normalizedProductId, productData),
    product_type: productType
  }, { source: 'admin_refresh', overwriteProductTitle: true });
  return {
    productId: normalizedProductId,
    success: true,
    productType,
    productTypeText: productType === 'store' ? '商城商品' : '普通商品',
    updatedCount: Number(taskCount?.count || 0)
  };
}

function buildPlaceholders(values) {
  return values.map(() => '?').join(',');
}

async function deleteProductDataByProductId(database, productId) {
  const normalizedProductId = normalizeAuctionUrl(productId)?.auctionId || String(productId || '').trim();
  if (!normalizedProductId) {
    return { productId: '', success: false, error: '商品 ID 无效' };
  }

  const tasks = await database.getAll(
    'SELECT id FROM tasks WHERE product_id = ? ORDER BY id ASC',
    [normalizedProductId]
  );
  const taskIds = tasks.map(task => task.id).filter(id => id !== null && id !== undefined);
  let orderIds = [];
  let orderStatusLogCount = 0;
  let bidLogCount = 0;
  let orderCount = 0;
  let biddingItemCount = 0;
  let taskCount = 0;
  let productCount = 0;

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    const orders = await database.getAll(
      `SELECT id FROM orders WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    );
    orderIds = orders.map(order => order.id).filter(id => id !== null && id !== undefined);
  }

  if (orderIds.length > 0) {
    const orderPlaceholders = buildPlaceholders(orderIds);
    orderStatusLogCount = (await database.query(
      `DELETE FROM order_status_change_logs
       WHERE product_id = ?
          OR order_id IN (${orderPlaceholders})`,
      [normalizedProductId, ...orderIds]
    )).rowCount || 0;
  } else {
    orderStatusLogCount = (await database.query(
      'DELETE FROM order_status_change_logs WHERE product_id = ?',
      [normalizedProductId]
    )).rowCount || 0;
  }

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    bidLogCount = (await database.query(
      `DELETE FROM bid_logs WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
    orderCount = (await database.query(
      `DELETE FROM orders WHERE task_id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
  }

  biddingItemCount = (await database.query(
    'DELETE FROM bidding_items WHERE product_id = ?',
    [normalizedProductId]
  )).rowCount || 0;

  if (taskIds.length > 0) {
    const taskPlaceholders = buildPlaceholders(taskIds);
    taskCount = (await database.query(
      `DELETE FROM tasks WHERE id IN (${taskPlaceholders})`,
      taskIds
    )).rowCount || 0;
  }

  productCount = (await database.query(
    'DELETE FROM products WHERE product_id = ?',
    [normalizedProductId]
  )).rowCount || 0;

  const totalCount = taskCount + orderCount + bidLogCount + biddingItemCount + orderStatusLogCount + productCount;
  return {
    productId: normalizedProductId,
    success: totalCount > 0,
    taskIds,
    orderIds,
    taskCount,
    orderCount,
    bidLogCount,
    biddingItemCount,
    productCount,
    orderStatusLogCount,
    totalCount,
    error: totalCount > 0 ? undefined : '系统中没有这个商品数据'
  };
}

router.post('/shipping-refresh/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    try {
      results.push(await refreshProductShippingFee(db, productService, productId));
    } catch (err) {
      results.push({ productId, success: false, error: err.message || '运费更新失败' });
    }
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/product-type-refresh/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    try {
      results.push(await refreshProductType(db, productService, productId));
    } catch (err) {
      results.push({ productId, success: false, error: err.message || '商品类型更新失败' });
    }
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/receipt-sheet-backfill/run', async (req, res) => {
  const limit = Math.max(1, Math.min(500, Math.floor(Number(req.body?.limit || 100))));
  const rows = await db.getAll(
    `SELECT o.id AS order_id,
            t.product_id,
            o.bundle_group_id
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     WHERE o.order_status = 'pending_receipt'
       AND o.google_sheet_appended_at IS NULL
     ORDER BY datetime(COALESCE(o.shipped_at, o.updated_at, o.created_at)) ASC, o.id ASC
     LIMIT ?`,
    [limit]
  );
  const processedBundleGroups = new Set();
  const results = [];
  for (const row of rows) {
    if (row.bundle_group_id && processedBundleGroups.has(row.bundle_group_id)) {
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: true,
        skipped: true,
        reason: '同捆组已随主商品处理'
      });
      continue;
    }
    try {
      const appendResult = await appendPendingReceiptOrderToGoogleSheet(row.order_id, db);
      if (row.bundle_group_id && !appendResult?.skipped) processedBundleGroups.add(row.bundle_group_id);
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: !appendResult?.skipped,
        skipped: appendResult?.skipped === true,
        reason: appendResult?.reason || '',
        appendedRows: appendResult?.appendedRows || 0,
        updatedRange: appendResult?.updatedRange || ''
      });
    } catch (err) {
      results.push({
        orderId: row.order_id,
        productId: row.product_id,
        success: false,
        error: err.message || '待收货补表格失败'
      });
    }
  }
  res.json({
    success: true,
    results,
    total: rows.length,
    appended: results.filter(item => item.success && !item.skipped).length,
    skipped: results.filter(item => item.skipped).length,
    failed: results.filter(item => !item.success && !item.skipped).length
  });
});

router.post('/orders-resync/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    // 标记任务下次插件 /orders/sync 时强制覆盖；处理后插件路由会自动清除标记。
    results.push(await markProductOrdersForResync(db, productId));
  }

  res.json({
    success: true,
    results,
    queued: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/tracking-rescan/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    try {
      results.push(await markTrackingRescanByProductId(db, productId));
    } catch (error) {
      results.push({ productId, success: false, error: error.message || '单号重扫标记失败' });
    }
  }
  const marked = results.filter(item => item.success).length;
  if (marked > 0) {
    await requestScan(db).catch(() => null);
  }

  res.json({
    success: true,
    results,
    marked,
    failed: results.filter(item => !item.success).length
  });
});

router.post('/product-data-delete/run', async (req, res) => {
  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    results.push(await deleteProductDataByProductId(db, productId));
  }

  res.json({
    success: true,
    results,
    deleted: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length,
    totalDeletedRows: results.reduce((sum, item) => sum + Number(item.totalCount || 0), 0)
  });
});

router.post('/order-status-refresh/run', async (req, res) => {
  let targetOrderStatus;
  try {
    targetOrderStatus = normalizeOrderStatusRefreshTarget(req.body?.orderStatus);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const productIds = Array.isArray(req.body?.productIds)
    ? parseShippingRefreshIds(req.body.productIds.join('\n'))
    : parseShippingRefreshIds(req.body?.productIdsText || req.body?.productIds || '');
  if (productIds.length === 0) {
    return res.status(400).json({ error: 'productIds is required' });
  }

  const results = [];
  for (const productId of productIds) {
    const orders = await db.getAll(
      `SELECT o.id AS order_id, o.order_status, t.id AS task_id
       FROM orders o
       INNER JOIN tasks t ON o.task_id = t.id
       WHERE t.product_id = ?
       ORDER BY datetime(COALESCE(o.won_at, o.created_at)) DESC, o.id DESC`,
      [productId]
    );
    if (!orders.length) {
      results.push({ productId, success: false, error: '系统中没有这个商品订单' });
      continue;
    }

    const orderIds = orders.map(order => order.order_id);
    const beforeRows = await getOrderStatusAuditRows(db, orderIds);
    const updateResult = await db.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${orders.map(() => '?').join(',')})`,
      [targetOrderStatus, ...orderIds]
    );
    if (updateResult.rowCount) {
      await writeOrderStatusAuditLogs(db, beforeRows, {
        status: targetOrderStatus,
        source: 'admin_order_status_refresh',
        metadata: { productId, orderStatus: req.body?.orderStatus || '' }
      }).catch(() => null);
    }
    results.push({
      productId,
      success: true,
      orderIds,
      updatedCount: updateResult.rowCount || 0,
      orderStatus: targetOrderStatus,
      orderStatusText: getOrderStatusRefreshText(targetOrderStatus)
    });
  }

  res.json({
    success: true,
    results,
    updated: results.filter(item => item.success).length,
    failed: results.filter(item => !item.success).length
  });
});

router.get('/data-cleanup/config', async (req, res) => {
  res.json(await getDataCleanupConfig(db));
});

router.put('/data-cleanup/config', async (req, res) => {
  const cleanupHour = Number(req.body.cleanupHour);
  const retentionDays = Number(req.body.retentionDays);
  if (!Number.isFinite(cleanupHour) || cleanupHour < 0 || cleanupHour > 23 || Math.floor(cleanupHour) !== cleanupHour) {
    return res.status(400).json({ error: 'valid cleanupHour is required' });
  }
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || Math.floor(retentionDays) !== retentionDays) {
    return res.status(400).json({ error: 'valid retentionDays is required' });
  }
  const saved = await saveDataCleanupConfig(db, {
    enabled: Boolean(req.body.enabled),
    cleanupHour,
    retentionDays
  });
  res.json({ success: true, ...saved });
});

router.post('/data-cleanup/run', async (req, res) => {
  const config = await getDataCleanupConfig(db);
  const retentionDays = Number(req.body?.retentionDays || config.retentionDays);
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || Math.floor(retentionDays) !== retentionDays) {
    return res.status(400).json({ error: 'valid retentionDays is required' });
  }
  const result = await deleteStaleTaskData(db, {
    retentionDays,
    runType: 'manual'
  });
  res.json({ success: true, ...result });
});

router.post('/data-cleanup/won-date/preview', async (req, res) => {
  try {
    const result = await previewWonDateCleanup(db, req.body?.cleanupDate);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'valid cleanup date is required' });
  }
});

router.post('/data-cleanup/won-date/run', async (req, res) => {
  if (req.body?.confirm !== true) {
    return res.status(400).json({ error: 'confirm is required' });
  }
  try {
    const result = await runWonDateCleanup(db, req.body?.cleanupDate);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'valid cleanup date is required' });
  }
});

router.get('/data-cleanup/db-backups', async (req, res) => {
  const backups = await listDatabaseBackups();
  const databasePath = getDatabasePath(db);
  const backupDir = getDatabaseBackupDir();
  res.json({
    databasePath,
    displayDatabasePath: displayDatabaseBackupPath(databasePath),
    backupDir,
    displayBackupDir: displayDatabaseBackupPath(backupDir),
    backups,
    cleanupSchedule: '每周一 04:00 自动清空 04:00 前已存在的备份文件'
  });
});

router.post('/data-cleanup/db-backups', async (req, res) => {
  try {
    const backup = await createDatabaseBackup(db);
    res.json({
      success: true,
      ...backup,
      filePath: undefined,
      downloadUrl: `/api/admin/data-cleanup/db-backups/${encodeURIComponent(backup.fileName)}/download`
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'database backup failed' });
  }
});

router.get('/data-cleanup/db-backups/:fileName/download', async (req, res) => {
  const fileName = String(req.params.fileName || '');
  if (!isValidDatabaseBackupFileName(fileName)) {
    return res.status(400).json({ error: 'invalid backup file name' });
  }
  try {
    const filePath = resolveBackupFilePath(fileName);
    await fs.access(filePath);
    res.download(filePath, fileName);
  } catch (err) {
    res.status(404).json({ error: 'backup file not found' });
  }
});

router.get('/data-cleanup/logs', async (req, res) => {
  const current = Math.max(parseInt(req.query.current || '1', 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '10', 10) || 10, 1), 100);
  const offset = (current - 1) * pageSize;
  const items = await db.getAll(
    `SELECT *
     FROM data_cleanup_logs
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ? OFFSET ?`,
    [pageSize, offset]
  );
  const countResult = await db.getOne('SELECT COUNT(*) AS total FROM data_cleanup_logs');
  res.json({ items, total: countResult?.total || 0 });
});

// 操作日志
router.get('/logs', async (req, res) => {
  const { current = 1, pageSize = 50 } = req.query;
  const offset = (current - 1) * pageSize;
  const logsQuery = buildAdminLogsQuery({ pageSize, offset });
  const items = await db.getAll(logsQuery.sql, logsQuery.params);
  res.json({ items });
});

module.exports = router;
module.exports.applyUserFinanceConfig = applyUserFinanceConfig;
module.exports.saveUserClientRateOverride = saveUserClientRateOverride;
module.exports.buildOrderSettlement = buildOrderSettlement;
module.exports.buildAdminTasksListQuery = buildAdminTasksListQuery;
module.exports.buildAdminPendingTasksQuery = buildAdminPendingTasksQuery;
module.exports.buildAdminOrdersListQuery = buildAdminOrdersListQuery;
module.exports.buildAdminOrdersUserWonDateRangeQuery = buildAdminOrdersUserWonDateRangeQuery;
module.exports.buildOrderStatusDebugOrdersQuery = buildOrderStatusDebugOrdersQuery;
module.exports.buildOrderStatusDebugTasksQuery = buildOrderStatusDebugTasksQuery;
module.exports.buildProductDebugTasksQuery = buildProductDebugTasksQuery;
module.exports.buildProductDebugBidLogsQuery = buildProductDebugBidLogsQuery;
module.exports.buildProductDebugOrdersQuery = buildProductDebugOrdersQuery;
module.exports.buildProductDebugOrderLogsQuery = buildProductDebugOrderLogsQuery;
module.exports.buildProductDebugDiagnosticsQuery = buildProductDebugDiagnosticsQuery;
module.exports.buildProductDebugSnapshotQuery = buildProductDebugSnapshotQuery;
module.exports.buildProductDebugBiddingItemsQuery = buildProductDebugBiddingItemsQuery;
module.exports.buildProductDebugConfigQuery = buildProductDebugConfigQuery;
module.exports.buildOrderSettlementSelectQuery = buildOrderSettlementSelectQuery;
module.exports.buildAdminLogsQuery = buildAdminLogsQuery;
module.exports.buildTrustedInputReportQueries = buildTrustedInputReportQueries;
module.exports.buildBidFailureReportQueries = buildBidFailureReportQueries;
module.exports.buildRecentTaskFailureUserReportQuery = buildRecentTaskFailureUserReportQuery;
module.exports.buildAdminMessagesListQuery = buildAdminMessagesListQuery;
module.exports.mapAdminOrderListItem = mapAdminOrderListItem;
module.exports.buildOrderSettlementUpdateQuery = buildOrderSettlementUpdateQuery;
module.exports.reassignOrderOwner = reassignOrderOwner;
module.exports.updateOrderRemark = updateOrderRemark;
module.exports.calculateOrderPayable = calculateOrderPayable;
module.exports.canSettleShippingFeeText = canSettleShippingFeeText;
module.exports.ORDER_STATUS_PENDING_SETTLEMENT = ORDER_STATUS_PENDING_SETTLEMENT;
module.exports.ORDER_STATUS_COMPLETED = ORDER_STATUS_COMPLETED;
module.exports.ORDER_STATUS_PENDING_PAYMENT = ORDER_STATUS_PENDING_PAYMENT;
module.exports.ORDER_STATUS_BUNDLE_COMPLETED = ORDER_STATUS_BUNDLE_COMPLETED;
module.exports.ORDER_STATUS_PENDING_SHIPMENT = ORDER_STATUS_PENDING_SHIPMENT;
module.exports.getEffectiveShippingFeeText = getEffectiveShippingFeeText;
module.exports.normalizeOrderStatusRefreshTarget = normalizeOrderStatusRefreshTarget;
module.exports.normalizeProductType = normalizeProductType;
module.exports.refreshProductShippingFee = refreshProductShippingFee;
module.exports.refreshProductType = refreshProductType;
module.exports.parseShippingFeeToNumber = parseShippingFeeToNumber;
module.exports.parseStoreBundleChildProductIds = parseStoreBundleChildProductIds;
module.exports.backfillStoreBundle = backfillStoreBundle;
module.exports.deleteProductDataByProductId = deleteProductDataByProductId;
module.exports.createManualOrderImportBatch = createManualOrderImportBatch;
module.exports.confirmManualOrderImport = confirmManualOrderImport;
module.exports.deleteManualOrderImportBatch = deleteManualOrderImportBatch;
module.exports.normalizeManualOrderImportSummary = normalizeManualOrderImportSummary;
module.exports.markProductOrdersForResync = markProductOrdersForResync;
module.exports.markTrackingRescanByProductId = markTrackingRescanByProductId;
module.exports.requestScan = requestScan;
module.exports.requestPayment = requestPayment;
module.exports.requestYahooMessageFetch = requestYahooMessageFetch;
module.exports.requestYahooMessageSend = requestYahooMessageSend;
module.exports.clearPaymentAlertAndContinue = clearPaymentAlertAndContinue;
module.exports.normalizePositiveIntegerConfig = normalizePositiveIntegerConfig;
module.exports.normalizeBidStrategyScope = normalizeBidStrategyScope;
module.exports.buildGoogleSheetUrl = buildGoogleSheetUrl;
