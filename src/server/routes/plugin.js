const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const db = require('../models');
const { isYahooLoginError } = require('../services/yahooLoginStatus');
const {
  getOrderStatusAuditRows,
  writeOrderStatusAuditLogs
} = require('../services/orderStatusAudit');
const {
  appendRows: appendGoogleSheetRows,
  applyGoogleSheetsConfigFromDb,
  findRowsByProductIdWithAnyColor,
  isGoogleSheetsConfigured,
  updateRowsByProductId
} = require('../services/googleSheets');
const {
  saveCaptchaChallenge,
  getCaptchaChallenge,
  closeCaptchaChallenge
} = require('../services/manualCaptcha');
const {
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  DEFAULT_MULTI_BID_MIN_PRICE,
  YAHOO_LOW_PRICE_THRESHOLD,
  YAHOO_LOW_PRICE_BID_LIMIT,
  YAHOO_LOW_PRICE_INITIAL_BID,
  YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD
} = require('../../shared/domainConstants.cjs');
const {
  taxExcludedToTaxIncluded
} = require('../../shared/priceRules.cjs');
const {
  shouldSplitDirectBidByYahooLowPriceRule
} = require('../../shared/biddingRules.cjs');
const {
  normalizeShippingFeeText,
  parseShippingFeeToNumber
} = require('../../shared/shippingRules.cjs');
const {
  calculateSheetPayable,
  applySheetUserFinance
} = require('../../shared/payableRules.cjs');
const { upsertProductSnapshot } = require('../services/productRepository');

const DEFAULT_MULTI_BID_START_HOURS = 0.5;
const DEFAULT_MULTI_BID_INTERVAL_MINUTES = 5;
const DEFAULT_IDLE_SYNC_INTERVAL_MINUTES = 5;
const DEFAULT_BID_CONCURRENCY_LIMIT = 2;
const DEFAULT_TRANSACTION_START_HOUR = 1;
const TRANSACTION_START_DELAY_MINUTES = 1;
const DEFAULT_CONFIRM_RECEIPT_HOUR = 18;
const DEFAULT_CONFIRM_RECEIPT_COLOR = '#ffff00';
const DEFAULT_SCAN_START_HOUR = 1;
const DEFAULT_SCAN_END_HOUR = 20;
const DEFAULT_SCAN_EVERY_IDLE_RUNS = 5;
const DEFAULT_PAYMENT_JOB_LIMIT = 3;
const DEFAULT_PAYMENT_PAGE_STAY_SECONDS = 3;
const SHIPMENT_ALERTS_CONFIG_KEY = 'shipment_alerts';
const GOOGLE_SHEET_STATUS_PENDING_RECEIPT = '待收货';
const BUNDLE_SHEET_COLORS = [
  { red: 0.93, green: 0.97, blue: 1 },
  { red: 1, green: 0.95, blue: 0.88 },
  { red: 0.93, green: 1, blue: 0.92 },
  { red: 1, green: 0.92, blue: 0.95 },
  { red: 0.96, green: 0.94, blue: 1 }
];

function parseTimeMs(value) {
  let input = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(input)) {
    input = input.replace(' ', 'T') + 'Z';
  }
  const time = Date.parse(input);
  return Number.isFinite(time) ? time : null;
}

function normalizeManualPinCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 12);
}

function quotePowerShellString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

function buildWindowsSendKeysScript(pinCode, options = {}) {
  const pin = normalizeManualPinCode(pinCode);
  const windowTitle = String(options.windowTitle || '').trim().slice(0, 200);
  const preferredTitles = [
    windowTitle,
    '再認証 - Yahoo! JAPAN',
    'Yahoo! JAPAN',
    'Google 密码管理工具',
    'Google Password Manager',
    'Chrome'
  ].filter(Boolean);
  const nativeInputType = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GDaipaiNativeInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@`;
  return [
    "$ErrorActionPreference = 'Stop'",
    nativeInputType,
    '$shell = New-Object -ComObject WScript.Shell',
    `$targetTitle = ${quotePowerShellString(windowTitle)}`,
    `$titleCandidates = @(${preferredTitles.map(quotePowerShellString).join(', ')})`,
    '$chromeWindows = @(Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })',
    '$targetWindow = $null',
    "if ($targetTitle) { $targetWindow = $chromeWindows | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Contains($targetTitle) } | Select-Object -First 1 }",
    "if (-not $targetWindow) { $targetWindow = $chromeWindows | Where-Object { $_.MainWindowTitle -match 'Yahoo|再認証|Chrome' } | Sort-Object StartTime -Descending | Select-Object -First 1 }",
    '$matchedTitle = if ($targetWindow) { $targetWindow.MainWindowTitle } else { "" }',
    '$activated = $false',
    'if ($targetWindow) { [GDaipaiNativeInput]::SetForegroundWindow($targetWindow.MainWindowHandle) | Out-Null; $activated = $true }',
    'foreach ($title in $titleCandidates) { if (-not $activated -and $title) { $activated = $shell.AppActivate($title) } }',
    "if (-not $activated) { throw 'Chrome window activation failed before PIN input' }",
    'Start-Sleep -Milliseconds 600',
    '$handle = [GDaipaiNativeInput]::GetForegroundWindow()',
    '$rect = New-Object GDaipaiNativeInput+RECT',
    '$clicked = $false',
    'if ([GDaipaiNativeInput]::GetWindowRect($handle, [ref]$rect)) { $width = [Math]::Max(1, $rect.Right - $rect.Left); $x = [int]($rect.Left + ($width / 2) - 160); $y = [int]($rect.Top + 220); [GDaipaiNativeInput]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 120; [GDaipaiNativeInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80; [GDaipaiNativeInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero); $clicked = $true }',
    'Start-Sleep -Milliseconds 250',
    `$pin = ${quotePowerShellString(pin)}`,
    'foreach ($char in $pin.ToCharArray()) { $vk = [byte][int][char]$char; [GDaipaiNativeInput]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [GDaipaiNativeInput]::keybd_event($vk, 0, 0x0002, [UIntPtr]::Zero); Start-Sleep -Milliseconds 120 }',
    'Start-Sleep -Milliseconds 700',
    "Write-Output ('typed=' + $pin.Length + '; clicked=' + $clicked + '; activated=' + $activated + '; matchedTitle=' + $matchedTitle + '; foregroundHandle=' + $handle)"
  ].join('\n');
}

function typeManualPinWithSystemKeyboard(pinCode, options = {}) {
  const pin = normalizeManualPinCode(pinCode);
  if (!pin) {
    const error = new Error('valid pin is required');
    error.statusCode = 400;
    return Promise.reject(error);
  }
  const platform = options.platform || process.platform;
  if (platform !== 'win32') {
    const error = new Error('system keyboard PIN input is only supported on Windows');
    error.statusCode = 400;
    return Promise.reject(error);
  }
  const execFileImpl = options.execFileImpl || execFile;
  const script = buildWindowsSendKeysScript(pin, { windowTitle: options.windowTitle });
  const args = ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script];
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', args, {
      windowsHide: true,
      timeout: Number(options.timeoutMs || 8000)
    }, (error, stdout, stderr) => {
      if (error) {
        const wrapped = new Error(stderr || error.message || 'system keyboard PIN input failed');
        wrapped.statusCode = 500;
        reject(wrapped);
        return;
      }
      resolve({
        success: true,
        digits: pin.length,
        windowTitle: String(options.windowTitle || '').trim().slice(0, 200),
        stdout: String(stdout || '').trim()
      });
    });
  });
}

function getStrategyLeadMs(task) {
  if (isMultiBidTask(task)) return getMultiBidStartMs(task);
  if (!task?.strategy || task.strategy === 'direct') return 0;
  const minutesFromColumn = Number(task.start_minutes_before || 0);
  const secondsFromColumn = Number(task.start_seconds_before || 0);
  if (minutesFromColumn || secondsFromColumn) {
    return minutesFromColumn * 60 * 1000 + secondsFromColumn * 1000;
  }
  const match = String(task.strategy).match(/^(\d+)min$/);
  return match ? Number(match[1]) * 60 * 1000 : 0;
}

function isMultiBidTask(task) {
  return task?.strategy === 'multi_bid';
}

function getMultiBidStartMs(config = {}) {
  const hours = Number(config.multiBidStartHours ?? config.multi_bid_start_hours ?? DEFAULT_MULTI_BID_START_HOURS);
  return Math.max(hours > 0 ? hours : DEFAULT_MULTI_BID_START_HOURS, 0.01) * 60 * 60 * 1000;
}

function getMultiBidIntervalMs(config = {}) {
  const minutes = Number(config.multiBidIntervalMinutes ?? config.multi_bid_interval_minutes ?? DEFAULT_MULTI_BID_INTERVAL_MINUTES);
  return Math.max(minutes > 0 ? minutes : DEFAULT_MULTI_BID_INTERVAL_MINUTES, 1) * 60 * 1000;
}

function isMultiBidIntervalReady(task, nowMs, config = {}) {
  if (!isMultiBidTask(task)) return true;
  const referenceTime = task.last_bid_at || (task.status === 'bidding' ? task.updated_at || task.created_at : null);
  const lastBidMs = parseTimeMs(referenceTime);
  if (!lastBidMs) return true;
  return nowMs - lastBidMs >= getMultiBidIntervalMs(config);
}

function isDirectTask(task) {
  return !isMultiBidTask(task) && (!task?.strategy || task.strategy === 'direct' || getStrategyLeadMs(task) <= 0);
}

function isTaskNeedingEndTimeRefresh(task) {
  return !isDirectTask(task) && !parseTimeMs(task?.end_time);
}

function isTaskReadyForDispatch(task, nowMs = Date.now(), config = {}) {
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return false;
  if (isMultiBidTask(task) && !isMultiBidIntervalReady(task, nowMs, config)) {
    return false;
  }
  if (isDirectTask(task)) return true;
  if (!endMs) return true;
  if (endMs - nowMs > getStrategyLeadMs({ ...task, ...config })) return false;
  return isMultiBidIntervalReady(task, nowMs, config);
}

function getDispatchPriority(task) {
  if (isDirectTask(task)) return 0;
  if (isTaskNeedingEndTimeRefresh(task)) return 2;
  return 1;
}

function chooseNextPluginTask(tasks, nowMs = Date.now(), config = {}) {
  const readyTasks = tasks.filter(task => isTaskReadyForDispatch(task, nowMs, config));
  readyTasks.sort((a, b) => {
    const aPriority = getDispatchPriority(a);
    const bPriority = getDispatchPriority(b);
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aEnd = parseTimeMs(a.end_time) || Number.MAX_SAFE_INTEGER;
    const bEnd = parseTimeMs(b.end_time) || Number.MAX_SAFE_INTEGER;
    if (aEnd !== bEnd) return aEnd - bEnd;
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  });
  return readyTasks[0] || null;
}

async function expireOverduePendingTasks(database = db, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const result = await database.query(
    `UPDATE tasks
     SET status = 'failed',
         is_highest_bidder = 0,
         error_msg = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND end_time IS NOT NULL
       AND datetime(end_time) <= datetime(?)`,
    ['Auction ended before plugin execution', nowIso]
  );
  return result.rowCount || 0;
}

async function failPricedOutPendingTasks(database = db) {
  // current_price 和 max_price 都是税前口径，user_max_price 是税后口径。
  // 这里要做"当前价已超过你愿意出的税前金额"的判断，应该用 max_price（税前）作比较基准。
  const result = await database.query(
    `UPDATE tasks
     SET status = 'failed',
         is_highest_bidder = 0,
         error_msg = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE (
         status = 'pending'
         OR (status = 'bidding' AND strategy = 'multi_bid')
       )
       AND current_price IS NOT NULL
       AND max_price IS NOT NULL
       AND current_price > 0
       AND max_price > 0
       AND COALESCE(bid_mode, 'bid') <> 'buyout'
       AND current_price > max_price`,
    ['Current price is above max price before execution']
  );
  return result.rowCount || 0;
}

async function resetStaleProcessingTasks(database = db, nowMs = Date.now()) {
  const cutoffIso = new Date(nowMs - 60 * 1000).toISOString();
  const result = await database.query(
    `UPDATE tasks
     SET status = 'pending',
         error_msg = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing'
       AND datetime(updated_at) <= datetime(?)`,
    [cutoffIso]
  );
  return result.rowCount || 0;
}

async function claimTaskForProcessing(taskId, database = db) {
  const result = await database.query(
    `UPDATE tasks
     SET status = 'processing',
         error_msg = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND (
         status = 'pending'
         OR (status = 'bidding' AND strategy = 'multi_bid')
       )`,
    [taskId]
  );
  return { success: (result.rowCount || 0) > 0 };
}

async function getPluginTaskCandidates(database = db) {
  return database.getAll(
    "SELECT * FROM tasks WHERE status = 'pending' OR (status = 'bidding' AND strategy = 'multi_bid') ORDER BY created_at ASC LIMIT 100"
  );
}

async function claimReadyPluginTasks(limit = 1, database = db, nowMs = Date.now(), config = null) {
  const safeLimit = Math.max(1, Math.min(10, Math.floor(Number(limit || 1))));
  const multiBidConfig = config || await getMultiBidConfig(database);
  let remaining = await getPluginTaskCandidates(database);
  const claimed = [];
  while (claimed.length < safeLimit) {
    const task = chooseNextPluginTask(remaining, nowMs, multiBidConfig);
    if (!task) break;
    remaining = remaining.filter(item => Number(item.id) !== Number(task.id));
    const result = await claimTaskForProcessing(task.id, database);
    if (result?.success) {
      claimed.push(withMultiBidDispatchConfig(task, multiBidConfig));
    }
  }
  return claimed;
}

async function sweepPendingTasks(database = db, nowMs = Date.now()) {
  const overdue = await expireOverduePendingTasks(database, nowMs);
  const pricedOut = await failPricedOutPendingTasks(database);
  const processingReset = await resetStaleProcessingTasks(database, nowMs);
  return { overdue, pricedOut, processingReset, total: overdue + pricedOut + processingReset };
}

async function getMultiBidConfig(database = db) {
  const rows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('multi_bid_start_hours', 'multi_bid_interval_minutes', 'idle_sync_interval_minutes', 'multi_bid_min_price', 'bid_concurrency_limit', 'transaction_start_hour', 'scan_start_hour', 'scan_end_hour', 'scan_every_idle_runs')"
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  return {
    multiBidStartHours: Number(values.multi_bid_start_hours || DEFAULT_MULTI_BID_START_HOURS),
    multiBidIntervalMinutes: Number(values.multi_bid_interval_minutes || DEFAULT_MULTI_BID_INTERVAL_MINUTES),
    idleSyncIntervalMinutes: Number(values.idle_sync_interval_minutes || DEFAULT_IDLE_SYNC_INTERVAL_MINUTES),
    multiBidMinPrice: Number(values.multi_bid_min_price || DEFAULT_MULTI_BID_MIN_PRICE),
    bidConcurrencyLimit: Math.max(1, Math.min(10, Math.floor(Number(values.bid_concurrency_limit || DEFAULT_BID_CONCURRENCY_LIMIT)))),
    transactionStartHour: Number(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR),
    scanStartHour: Number(values.scan_start_hour ?? DEFAULT_SCAN_START_HOUR),
    scanEndHour: Number(values.scan_end_hour ?? DEFAULT_SCAN_END_HOUR),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? DEFAULT_SCAN_EVERY_IDLE_RUNS)
  };
}

function withMultiBidDispatchConfig(task, config) {
  if (!task || !isMultiBidTask(task)) return task;
  return {
    ...task,
    multi_bid_start_hours: config.multiBidStartHours,
    multi_bid_interval_minutes: config.multiBidIntervalMinutes,
    start_minutes_before: Math.round(config.multiBidStartHours * 60),
    start_seconds_before: 0
  };
}

async function setYahooLoginStatus(status, message = '') {
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('yahoo_login_status', ?, CURRENT_TIMESTAMP)`,
    [status]
  );
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('yahoo_login_message', ?, CURRENT_TIMESTAMP)`,
    [message || '']
  );
}

function getLocalDateKey(nowMs = Date.now()) {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function clampHour(value, fallback) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(hour)));
}

function getTransactionStartReadyMs(transactionStartHour, nowMs = Date.now()) {
  const readyAt = new Date(nowMs);
  readyAt.setHours(clampHour(transactionStartHour, DEFAULT_TRANSACTION_START_HOUR), TRANSACTION_START_DELAY_MINUTES, 0, 0);
  return readyAt.getTime();
}

function getTransactionStartSlot(transactionStartHour, nowMs = Date.now(), dateKey = '') {
  return `${dateKey || getLocalDateKey(nowMs)}-${String(clampHour(transactionStartHour, DEFAULT_TRANSACTION_START_HOUR)).padStart(2, '0')}`;
}

function parseSqliteTimestampMs(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : 0;
}

function inferTransactionStartLastRunSlot(config = {}, nowMs = Date.now()) {
  const explicit = String(config.transactionStartLastRunSlot || '').trim();
  if (explicit) return explicit;
  let log = null;
  try {
    log = config.transactionStartLastRunLog
      ? (typeof config.transactionStartLastRunLog === 'string' ? JSON.parse(config.transactionStartLastRunLog) : config.transactionStartLastRunLog)
      : null;
  } catch {
    log = null;
  }
  if (log?.source !== 'auto' || !log.createdAt) return '';
  const logMs = Date.parse(log.createdAt);
  if (!Number.isFinite(logMs) || getLocalDateKey(logMs) !== getLocalDateKey(nowMs)) return '';
  return getTransactionStartSlot(new Date(logMs).getHours(), logMs);
}

function isTransactionStartReady(config = {}, nowMs = Date.now()) {
  if (config.nowHour !== undefined || config.nowMinute !== undefined) {
    const transactionStartHour = clampHour(config.transactionStartHour, DEFAULT_TRANSACTION_START_HOUR);
    const now = new Date(nowMs);
    const nowHour = Number(config.nowHour ?? now.getHours());
    const nowMinute = Number(config.nowMinute ?? (config.nowHour !== undefined ? TRANSACTION_START_DELAY_MINUTES : now.getMinutes()));
    return nowHour > transactionStartHour ||
      (nowHour === transactionStartHour && nowMinute >= TRANSACTION_START_DELAY_MINUTES);
  }
  const readyMs = getTransactionStartReadyMs(config.transactionStartHour, nowMs);
  return nowMs >= readyMs;
}

function shouldAutoRequestTransactionStart(config = {}, nowMs = Date.now()) {
  const transactionStartHour = clampHour(config.transactionStartHour, DEFAULT_TRANSACTION_START_HOUR);
  if (!isTransactionStartReady({ ...config, transactionStartHour }, nowMs)) return false;
  const slot = getTransactionStartSlot(transactionStartHour, nowMs, config.today);
  if (inferTransactionStartLastRunSlot(config, nowMs) === slot) return false;
  const updatedMs = parseSqliteTimestampMs(config.transactionStartHourUpdatedAt);
  const readyMs = getTransactionStartReadyMs(transactionStartHour, nowMs);
  if (updatedMs && updatedMs > readyMs) return false;
  return true;
}

function getConfirmReceiptReadyMs(confirmReceiptHour, nowMs = Date.now()) {
  const readyAt = new Date(nowMs);
  readyAt.setHours(clampHour(confirmReceiptHour, DEFAULT_CONFIRM_RECEIPT_HOUR), TRANSACTION_START_DELAY_MINUTES, 0, 0);
  return readyAt.getTime();
}

function getConfirmReceiptSlot(confirmReceiptHour, nowMs = Date.now(), dateKey = '') {
  return `${dateKey || getLocalDateKey(nowMs)}-${String(clampHour(confirmReceiptHour, DEFAULT_CONFIRM_RECEIPT_HOUR)).padStart(2, '0')}`;
}

function isConfirmReceiptReady(config = {}, nowMs = Date.now()) {
  if (config.nowHour !== undefined || config.nowMinute !== undefined) {
    const confirmReceiptHour = clampHour(config.confirmReceiptHour, DEFAULT_CONFIRM_RECEIPT_HOUR);
    const now = new Date(nowMs);
    const nowHour = Number(config.nowHour ?? now.getHours());
    const nowMinute = Number(config.nowMinute ?? (config.nowHour !== undefined ? TRANSACTION_START_DELAY_MINUTES : now.getMinutes()));
    return nowHour > confirmReceiptHour ||
      (nowHour === confirmReceiptHour && nowMinute >= TRANSACTION_START_DELAY_MINUTES);
  }
  return nowMs >= getConfirmReceiptReadyMs(config.confirmReceiptHour, nowMs);
}

function shouldAutoRequestConfirmReceipt(config = {}, nowMs = Date.now()) {
  const confirmReceiptHour = clampHour(config.confirmReceiptHour, DEFAULT_CONFIRM_RECEIPT_HOUR);
  if (!isConfirmReceiptReady({ ...config, confirmReceiptHour }, nowMs)) return false;
  const slot = getConfirmReceiptSlot(confirmReceiptHour, nowMs, config.today);
  if (String(config.confirmReceiptLastRunSlot || '').trim() === slot) return false;
  const updatedMs = parseSqliteTimestampMs(config.confirmReceiptHourUpdatedAt);
  const readyMs = getConfirmReceiptReadyMs(confirmReceiptHour, nowMs);
  if (updatedMs && updatedMs > readyMs) return false;
  return true;
}

function getNextIdleAction(config = {}, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const nowHour = config.nowHour ?? now.getHours();
  const today = config.today || getLocalDateKey(nowMs);
  if (Number(config.manualOrderImportPending || 0) > 0) {
    return { action: 'scan', today, manualOrderImportPending: Number(config.manualOrderImportPending || 0) };
  }
  const transactionStartHour = clampHour(config.transactionStartHour, DEFAULT_TRANSACTION_START_HOUR);
  const transactionRequested = Number(config.transactionStartRequested || 0) === 1;
  if (transactionRequested || shouldAutoRequestTransactionStart({ ...config, transactionStartHour }, nowMs)) {
    return { action: 'transaction_start', today };
  }

  const scanStartHour = clampHour(config.scanStartHour, DEFAULT_SCAN_START_HOUR);
  const scanEndHour = clampHour(config.scanEndHour, DEFAULT_SCAN_END_HOUR);
  const scanEvery = Math.max(1, Math.floor(Number(config.scanEveryIdleRuns || DEFAULT_SCAN_EVERY_IDLE_RUNS)));
  const scanCounter = Math.max(0, Math.floor(Number(config.scanIdleCounter || 0)));
  const inScanWindow = scanStartHour <= scanEndHour
    ? Number(nowHour) >= scanStartHour && Number(nowHour) <= scanEndHour
    : Number(nowHour) >= scanStartHour || Number(nowHour) <= scanEndHour;
  if (inScanWindow && scanCounter >= scanEvery) {
    return { action: 'scan', today };
  }
  if (Number(config.paymentRequested || 0) === 1) {
    return { action: 'payment', today };
  }
  const confirmReceiptHour = clampHour(config.confirmReceiptHour, DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptRequested = Number(config.confirmReceiptRequested || 0) === 1;
  if (confirmReceiptRequested || shouldAutoRequestConfirmReceipt({ ...config, confirmReceiptHour }, nowMs)) {
    return { action: 'confirm_receipt', today };
  }
  return { action: 'none', today };
}

function getNextScanIdleCounter(action, config = {}) {
  const scanEvery = Math.max(1, Math.floor(Number(config.scanEveryIdleRuns || DEFAULT_SCAN_EVERY_IDLE_RUNS)));
  const scanCounter = Math.max(0, Math.floor(Number(config.scanIdleCounter || 0)));
  if (action === 'scan') return 0;
  if (scanCounter >= scanEvery) return 0;
  return scanCounter + 1;
}

async function completeIdleAction(action, database = db, nowMs = Date.now()) {
  const config = await getIdleActionConfig(database, nowMs);
  if (action === 'transaction_start') {
    await saveConfigValue(database, 'transaction_start_requested', '0');
    await saveConfigValue(database, 'transaction_start_requested_source', '');
    if (config.transactionStartRequestSource !== 'manual') {
      await saveConfigValue(database, 'transaction_start_last_run_date', config.today);
      await saveConfigValue(
        database,
        'transaction_start_last_run_slot',
        getTransactionStartSlot(config.transactionStartHour, nowMs)
      );
    }
  } else if (action === 'confirm_receipt') {
    await saveConfigValue(database, 'confirm_receipt_requested', '0');
    await saveConfigValue(database, 'confirm_receipt_requested_source', '');
    if (config.confirmReceiptRequestSource !== 'manual') {
      await saveConfigValue(
        database,
        'confirm_receipt_last_run_slot',
        getConfirmReceiptSlot(config.confirmReceiptHour, nowMs)
      );
    }
    await saveConfigValue(database, 'scan_idle_counter', getNextScanIdleCounter(action, config));
  } else if (action === 'scan') {
    await saveConfigValue(database, 'scan_idle_counter', '0');
  } else {
    await saveConfigValue(database, 'scan_idle_counter', getNextScanIdleCounter(action, config));
  }
  return { success: true };
}

async function getIdleActionConfig(database = db, nowMs = Date.now()) {
  await ensureScheduledTransactionStartRequest(database, nowMs);
  await ensureScheduledConfirmReceiptRequest(database, nowMs);
  const rows = await database.getAll(
    `SELECT key, value, updated_at FROM config
     WHERE key IN (
       'transaction_start_hour',
       'transaction_start_requested',
       'transaction_start_requested_source',
       'transaction_start_last_run_date',
       'transaction_start_last_run_slot',
       'transaction_start_last_run_log',
       'confirm_receipt_hour',
       'confirm_receipt_requested',
       'confirm_receipt_requested_source',
       'confirm_receipt_last_run_slot',
       'confirm_receipt_color',
       'scan_start_hour',
       'scan_end_hour',
       'scan_every_idle_runs',
       'scan_idle_counter',
       'payment_requested',
       'payment_job_limit',
       'payment_page_stay_seconds'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const updatedAt = Object.fromEntries(rows.map(row => [row.key, row.updated_at]));
  let manualOrderImportPending = 0;
  if (typeof database.getOne === 'function') {
    const pendingImport = await database.getOne(
      `SELECT COUNT(*) AS count
       FROM manual_order_import_batches
       WHERE status = 'requested'`
    );
    manualOrderImportPending = Number(pendingImport?.count || 0);
  }
  return {
    manualOrderImportPending,
    transactionStartHour: Number(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR),
    transactionStartHourUpdatedAt: updatedAt.transaction_start_hour || '',
    transactionStartRequested: Number(values.transaction_start_requested || 0),
    transactionStartRequestSource: values.transaction_start_requested_source || '',
    transactionStartLastRunDate: values.transaction_start_last_run_date || '',
    transactionStartLastRunSlot: values.transaction_start_last_run_slot || '',
    transactionStartLastRunLog: values.transaction_start_last_run_log || '',
    confirmReceiptHour: Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR),
    confirmReceiptHourUpdatedAt: updatedAt.confirm_receipt_hour || '',
    confirmReceiptRequested: Number(values.confirm_receipt_requested || 0),
    confirmReceiptRequestSource: values.confirm_receipt_requested_source || '',
    confirmReceiptLastRunSlot: values.confirm_receipt_last_run_slot || '',
    confirmReceiptColor: values.confirm_receipt_color || DEFAULT_CONFIRM_RECEIPT_COLOR,
    scanStartHour: Number(values.scan_start_hour ?? DEFAULT_SCAN_START_HOUR),
    scanEndHour: Number(values.scan_end_hour ?? DEFAULT_SCAN_END_HOUR),
    scanEveryIdleRuns: Number(values.scan_every_idle_runs ?? DEFAULT_SCAN_EVERY_IDLE_RUNS),
    scanIdleCounter: Number(values.scan_idle_counter || 0),
    paymentRequested: Number(values.payment_requested || 0),
    paymentJobLimit: parsePositiveInt(values.payment_job_limit, DEFAULT_PAYMENT_JOB_LIMIT),
    paymentPageStaySeconds: parsePositiveInt(values.payment_page_stay_seconds, DEFAULT_PAYMENT_PAGE_STAY_SECONDS),
    today: getLocalDateKey(nowMs),
    nowHour: new Date(nowMs).getHours(),
    transactionStartReady: isTransactionStartReady({
      transactionStartHour: Number(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR)
    }, nowMs),
    confirmReceiptReady: isConfirmReceiptReady({
      confirmReceiptHour: Number(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR)
    }, nowMs)
  };
}

async function saveConfigValue(database, key, value) {
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, String(value)]
  );
}

async function ensureScheduledTransactionStartRequest(database = db, nowMs = Date.now()) {
  const rows = await database.getAll(
    `SELECT key, value, updated_at FROM config
     WHERE key IN (
       'transaction_start_hour',
       'transaction_start_requested',
       'transaction_start_requested_source',
       'transaction_start_last_run_date',
       'transaction_start_last_run_slot',
       'transaction_start_last_run_log'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const updatedAt = Object.fromEntries(rows.map(row => [row.key, row.updated_at]));
  const today = getLocalDateKey(nowMs);
  const transactionStartHour = clampHour(values.transaction_start_hour ?? DEFAULT_TRANSACTION_START_HOUR, DEFAULT_TRANSACTION_START_HOUR);
  const transactionStartRequested = Number(values.transaction_start_requested || 0) === 1;
  const transactionStartRequestSource = values.transaction_start_requested_source || '';
  const transactionStartLastRunDate = values.transaction_start_last_run_date || '';
  const transactionStartLastRunSlot = inferTransactionStartLastRunSlot({
    transactionStartLastRunSlot: values.transaction_start_last_run_slot || '',
    transactionStartLastRunLog: values.transaction_start_last_run_log || ''
  }, nowMs);
  const shouldRequest = !transactionStartRequested &&
    shouldAutoRequestTransactionStart({
      transactionStartHour,
      transactionStartHourUpdatedAt: updatedAt.transaction_start_hour || '',
      transactionStartLastRunSlot,
      transactionStartLastRunLog: values.transaction_start_last_run_log || ''
    }, nowMs);

  if (shouldRequest) {
    await saveConfigValue(database, 'transaction_start_requested', '1');
    await saveConfigValue(database, 'transaction_start_requested_source', 'auto');
    return {
      updated: true,
      transactionStartRequested: 1,
      transactionStartRequestSource: 'auto',
      transactionStartHour,
      transactionStartLastRunDate,
      transactionStartLastRunSlot,
      today
    };
  }

  return {
    updated: false,
    transactionStartRequested: transactionStartRequested ? 1 : 0,
    transactionStartRequestSource,
    transactionStartHour,
    transactionStartLastRunDate,
    transactionStartLastRunSlot,
    today
  };
}

async function ensureScheduledConfirmReceiptRequest(database = db, nowMs = Date.now()) {
  const rows = await database.getAll(
    `SELECT key, value, updated_at FROM config
     WHERE key IN (
       'confirm_receipt_hour',
       'confirm_receipt_requested',
       'confirm_receipt_requested_source',
       'confirm_receipt_last_run_slot'
     )`
  );
  const values = Object.fromEntries(rows.map(row => [row.key, row.value]));
  const updatedAt = Object.fromEntries(rows.map(row => [row.key, row.updated_at]));
  const today = getLocalDateKey(nowMs);
  const confirmReceiptHour = clampHour(values.confirm_receipt_hour ?? DEFAULT_CONFIRM_RECEIPT_HOUR, DEFAULT_CONFIRM_RECEIPT_HOUR);
  const confirmReceiptRequested = Number(values.confirm_receipt_requested || 0) === 1;
  const confirmReceiptRequestSource = values.confirm_receipt_requested_source || '';
  const confirmReceiptLastRunSlot = values.confirm_receipt_last_run_slot || '';
  const shouldRequest = !confirmReceiptRequested &&
    shouldAutoRequestConfirmReceipt({
      confirmReceiptHour,
      confirmReceiptHourUpdatedAt: updatedAt.confirm_receipt_hour || '',
      confirmReceiptLastRunSlot
    }, nowMs);

  if (shouldRequest) {
    await saveConfigValue(database, 'confirm_receipt_requested', '1');
    await saveConfigValue(database, 'confirm_receipt_requested_source', 'auto');
    return {
      updated: true,
      confirmReceiptRequested: 1,
      confirmReceiptRequestSource: 'auto',
      confirmReceiptHour,
      confirmReceiptLastRunSlot,
      today
    };
  }

  return {
    updated: false,
    confirmReceiptRequested: confirmReceiptRequested ? 1 : 0,
    confirmReceiptRequestSource,
    confirmReceiptHour,
    confirmReceiptLastRunSlot,
    today
  };
}

function normalizeTransactionStartLogJob(job = {}) {
  return {
    orderId: job.orderId ?? job.order_id ?? null,
    productId: job.productId ?? job.product_id ?? '',
    productType: job.productType ?? job.product_type ?? '',
    shippingFeeText: job.shippingFeeText ?? job.shipping_fee_text ?? '',
    status: job.status || 'queued'
  };
}

async function saveTransactionStartRunLog(database, payload = {}) {
  const log = {
    createdAt: new Date().toISOString(),
    source: payload.source || (payload.includeAfterCutoff ? 'manual' : 'auto'),
    includeAfterCutoff: !!payload.includeAfterCutoff,
    total: Number(payload.total || 0),
    storeUpdated: Number(payload.storeUpdated || 0),
    missingTransactionUrl: Number(payload.missingTransactionUrl || 0),
    jobs: Array.isArray(payload.jobs) ? payload.jobs.map(normalizeTransactionStartLogJob) : [],
    results: Array.isArray(payload.results) ? payload.results : []
  };
  await saveConfigValue(database, 'transaction_start_last_run_log', JSON.stringify(log));
  return log;
}

async function appendTransactionStartRunLogResult(database, result = {}) {
  if (!database || typeof database.getOne !== 'function') return null;
  const row = await database.getOne("SELECT value FROM config WHERE key = 'transaction_start_last_run_log'");
  let log = null;
  try {
    log = row?.value ? JSON.parse(row.value) : null;
  } catch {
    log = null;
  }
  if (!log || typeof log !== 'object') return null;
  const nextResult = {
    at: new Date().toISOString(),
    orderIds: Array.isArray(result.orderIds) ? result.orderIds : [],
    productIds: Array.isArray(result.productIds) ? result.productIds : [],
    status: result.status || null,
    error: result.error || null,
    updated: Number(result.updated || 0)
  };
  log.results = Array.isArray(log.results) ? log.results : [];
  log.results.push(nextResult);
  log.results = log.results.slice(-100);
  await saveConfigValue(database, 'transaction_start_last_run_log', JSON.stringify(log));
  return log;
}

// GET /api/plugin/task
router.get('/task', async (req, res) => {
  const multiBidConfig = await getMultiBidConfig();
  const tasks = await getPluginTaskCandidates();
  const nowMs = Date.now();
  const task = chooseNextPluginTask(tasks, nowMs, multiBidConfig);
  res.json({
    task: withMultiBidDispatchConfig(task, multiBidConfig) || null,
    canIdleSync: true,
    bidConcurrencyLimit: multiBidConfig.bidConcurrencyLimit
  });
});

router.get('/tasks', async (req, res) => {
  const multiBidConfig = await getMultiBidConfig();
  const tasks = await claimReadyPluginTasks(req.query.limit || 1, db, Date.now(), multiBidConfig);
  res.json({
    success: true,
    tasks,
    bidConcurrencyLimit: multiBidConfig.bidConcurrencyLimit
  });
});

router.get('/idle-action/next', async (req, res) => {
  const config = await getIdleActionConfig();
  res.json({ success: true, ...getNextIdleAction(config), config });
});

router.post('/idle-action/complete', async (req, res) => {
  const action = String(req.body?.action || 'none');
  res.json(await completeIdleAction(action));
});

// PATCH /api/plugin/task/:id/status
router.patch('/task/:id/status', async (req, res) => {
  const { status, error_msg, bid_price, no_bid, not_highest } = req.body;
  if (status === 'processing') {
    const result = await claimTaskForProcessing(req.params.id);
    return res.json(result);
  }

  if (isYahooLoginError(error_msg)) {
    await setYahooLoginStatus('failed', error_msg);
  } else if (status === 'bidding') {
    await setYahooLoginStatus('ok');
  }

  if (status === 'bidding') {
    const result = await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           bid_count = CASE WHEN ? THEN COALESCE(bid_count, 0) ELSE COALESCE(bid_count, 0) + 1 END,
           last_bid_at = CURRENT_TIMESTAMP,
           is_highest_bidder = CASE WHEN ? THEN 0 ELSE 1 END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status != 'cancelled'`,
      [status, error_msg || null, no_bid ? 1 : 0, not_highest ? 1 : 0, req.params.id]
    );
    if (result.rowCount > 0 && bid_price) {
      await db.query(
        'INSERT INTO bid_logs (task_id, bid_price, result) VALUES (?, ?, ?)',
        [req.params.id, normalizeYenAmount(bid_price), 'bidding']
      );
    }
    return res.json({ success: result.rowCount > 0 });
  } else {
    const result = await db.query(
      `UPDATE tasks
       SET status = ?,
           error_msg = ?,
           is_highest_bidder = CASE WHEN ? = 'failed' THEN 0 ELSE is_highest_bidder END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND status != 'cancelled'`,
      [status, error_msg || null, status, req.params.id]
    );
    return res.json({ success: result.rowCount > 0 });
  }
});

router.patch('/task/:id/touch', async (req, res) => {
  const allowedStatus = ['pending', 'bidding', 'success'].includes(req.body?.status) ? req.body.status : null;
  await db.query(
    `UPDATE tasks
     SET status = COALESCE(?, status),
         last_bid_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status != 'cancelled'`,
    [allowedStatus, req.params.id]
  );
  res.json({ success: true });
});

async function heartbeatProcessingTask(taskId, database = db) {
  const result = await database.query(
    `UPDATE tasks
     SET updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status = 'processing'`,
    [taskId]
  );
  return { success: (result.rowCount || 0) > 0 };
}

router.patch('/task/:id/heartbeat', async (req, res) => {
  res.json(await heartbeatProcessingTask(req.params.id));
});

function normalizeYenAmount(value) {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(String(value).replace(/[^\d]/g, ''));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function resolveOrderFinalPrice(task, parsedFinalPrice) {
  return normalizeYenAmount(parsedFinalPrice);
}

function normalizeYahooWonTimeText(value, nowMs = Date.now()) {
  const match = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const now = new Date(nowMs);
  let year = now.getFullYear();
  let date = new Date(year, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  if (date.getTime() - nowMs > 24 * 60 * 60 * 1000) {
    date = new Date(year - 1, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function upsertOrderFromTask(taskId, options = {}, database = db) {
  const task = await database.getOne('SELECT * FROM tasks WHERE id = ?', [taskId]);
  if (!task) return;
  await upsertProductSnapshot(database, {
    product_id: task.product_id,
    product_url: task.product_url,
    product_title: task.product_title || task.product_id,
    product_image_url: task.product_image_url,
    current_price: task.current_price,
    buyout_price: task.buyout_price,
    bid_count: task.bid_count,
    tax_type: task.tax_type || 'tax_zero',
    product_type: task.product_type || (task.tax_type === 'tax_included' ? 'store' : 'normal'),
    shipping_fee_text: task.shipping_fee_text,
    end_time: task.end_time
  }, { source: 'fetch' });
  const existing = await database.getOne('SELECT id FROM orders WHERE task_id = ?', [taskId]);
  const finalPrice = resolveOrderFinalPrice(task, options.finalPrice);
  const wonTimeText = String(options.wonTimeText || '').trim() || null;
  const wonAt = normalizeYahooWonTimeText(wonTimeText);
  const transactionUrl = String(options.transactionUrl || '').trim() || null;
  if (existing) {
    await database.query(
      `UPDATE orders
       SET product_id = COALESCE(product_id, ?),
           product_title = ?, product_url = ?, final_price = COALESCE(?, final_price),
           won_at = COALESCE(?, won_at),
           won_time_text = COALESCE(?, won_time_text),
           transaction_url = COALESCE(?, transaction_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE task_id = ?`,
      [task.product_id, task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, transactionUrl, taskId]
    );
  } else {
    await database.query(
      `INSERT INTO orders (task_id, product_id, product_title, product_url, final_price, won_at, won_time_text, transaction_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskId, task.product_id, task.product_title || task.product_id, task.product_url, finalPrice, wonAt, wonTimeText, transactionUrl]
    );
  }
}

function normalizeBiddingStatus(value) {
  return value === 'highest' || value === 'outbid' ? value : null;
}

function isFollowupTaskReady(task, nowMs = Date.now()) {
  if (!task) return false;
  if (!Number(task.pending_followup_max_price || 0)) return false;
  // current_price 是税前价。followup 阈值 1200 留 20% 缓冲，> Yahoo 规则边界 1000。
  const current = Number(task.current_price || 0);
  if (!Number.isFinite(current) || current < YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD) return false;
  if (!['pending', 'processing', 'bidding'].includes(task.status)) return false;
  const endMs = parseTimeMs(task.end_time);
  if (endMs && endMs <= nowMs) return false;
  return true;
}

async function processPendingFollowupTasks(database = db, nowMs = Date.now()) {
  const candidates = await database.getAll(
    `SELECT id, user_id, product_id, product_url, product_title, product_image_url,
            current_price, buyout_price, tax_type, shipping_fee_text,
            pending_followup_max_price, status, end_time
     FROM tasks
     WHERE pending_followup_max_price IS NOT NULL
       AND status IN ('pending', 'processing', 'bidding')`
  );
  let created = 0;
  for (const task of candidates) {
    if (!isFollowupTaskReady(task, nowMs)) continue;
    const followupUserMaxPrice = Math.floor(Number(task.pending_followup_max_price));
    // followup 任务的口径与原任务保持一致：
    // - user_max_price 是用户视角（含税商品=含税值）
    // - max_price 是 Yahoo 表单接收的除税值
    const followupBidMaxPrice = task.tax_type === 'tax_included' && followupUserMaxPrice >= 10
      ? Math.floor((followupUserMaxPrice / 1.1) + 1e-6)
      : followupUserMaxPrice;
    const clientRequestId = `followup-${task.id}`;
    // 原子地清空标记，避免被并发触发多次
    const cleared = await database.query(
      `UPDATE tasks
       SET pending_followup_max_price = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND pending_followup_max_price IS NOT NULL`,
      [task.id]
    );
    if (!cleared.rowCount) continue;
    const existing = await database.getOne(
      'SELECT id FROM tasks WHERE user_id = ? AND client_request_id = ? LIMIT 1',
      [task.user_id, clientRequestId]
    );
    if (existing) continue;
    await database.query(
      `INSERT INTO tasks (
         user_id, product_id, product_url, product_title, product_image_url,
         current_price, buyout_price, tax_type, shipping_fee_text,
         max_price, user_max_price, strategy, bid_mode,
         status, end_time, client_request_id
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'direct', 'bid', 'pending', ?, ?)`,
      [
        task.user_id,
        task.product_id,
        task.product_url,
        task.product_title,
        task.product_image_url,
        task.current_price,
        task.buyout_price,
        task.tax_type || 'tax_zero',
        task.shipping_fee_text,
        followupBidMaxPrice,
        followupUserMaxPrice,
        task.end_time,
        clientRequestId
      ]
    );
    created += 1;
  }
  return created;
}

async function syncBiddingItems(items, database = db) {
  const biddingItems = Array.isArray(items) ? items : [];
  let highest = 0;
  let outbid = 0;

  await database.query(
    `UPDATE bidding_items
     SET status = 'stale',
         updated_at = CURRENT_TIMESTAMP`
  );

  for (const item of biddingItems) {
    const match = String(item.url || item.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const itemStatus = normalizeBiddingStatus(item.status);
    if (!itemStatus) continue;
    const rawPrice = normalizeYenAmount(item.price);
    // /my/bidding 列表页"現在 ××円"对商城商品是税后值，对普通商品是税前。
    // 数据库 current_price 统一存税前口径，写入前按商品快照的 tax_type 折回税前。
    const taskTaxRow = await database.getOne(
      `SELECT COALESCE(p.tax_type, t.tax_type) AS tax_type
       FROM tasks t
       LEFT JOIN products p ON p.product_id = t.product_id
       WHERE t.product_id = ?
       ORDER BY t.id DESC
       LIMIT 1`,
      [productId]
    );
    const taxType = taskTaxRow?.tax_type === 'tax_included' ? 'tax_included' : 'tax_zero';
    const currentPrice = rawPrice && taxType === 'tax_included' && rawPrice >= 10
      ? Math.floor((rawPrice / 1.1) + 1e-6)
      : rawPrice;
    const remainingTimeText = normalizePlainText(item.remainingTimeText || item.remaining_time_text).slice(0, 32);

    await database.query(
      `INSERT INTO bidding_items (
         product_id,
         product_url,
         product_title,
         product_image_url,
         current_price,
         remaining_time_text,
         status,
         synced_at,
         updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(product_id) DO UPDATE SET
         product_url = excluded.product_url,
         product_image_url = excluded.product_image_url,
         current_price = excluded.current_price,
         remaining_time_text = excluded.remaining_time_text,
         status = excluded.status,
         synced_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
      [
        productId,
        item.url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
        item.title || null,
        item.imageUrl || null,
        currentPrice,
        remainingTimeText || null,
        itemStatus
      ]
    );
    await upsertProductSnapshot(database, {
      product_id: productId,
      product_url: item.url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      product_title: item.title || null,
      product_image_url: item.imageUrl || null,
      current_price: currentPrice,
      tax_type: taxType
    }, { source: 'scan' });

    if (itemStatus === 'highest') {
      const result = await database.query(
        `UPDATE tasks
         SET status = 'bidding',
             is_highest_bidder = 1,
             product_image_url = COALESCE(?, product_image_url),
             current_price = COALESCE(?, current_price),
             error_msg = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND status IN ('bidding', 'success')`,
        [
          item.imageUrl || null,
          currentPrice,
          productId
        ]
      );
      highest += 1;
    } else {
      await database.query(
        `UPDATE tasks
         SET is_highest_bidder = 0,
             current_price = COALESCE(?, current_price),
             updated_at = CURRENT_TIMESTAMP
         WHERE product_id = ?
           AND status = 'bidding'`,
        [currentPrice, productId]
      );
      outbid += 1;
    }
  }

  const followupCreated = await processPendingFollowupTasks(database);
  return { highest, outbid, total: highest + outbid, followup: followupCreated };
}

async function getTransactionStartJobs(database = db, options = {}) {
  const includeAfterCutoff = options.includeAfterCutoff ? 1 : 0;
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.transaction_url,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.product_type, t.product_type) AS product_type,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE (o.order_status IS NULL OR o.order_status = '')
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC`
  );

  const jobs = [];
  const logJobs = [];
  let storeUpdated = 0;
  let missingTransactionUrl = 0;
  for (const row of rows) {
    if (row.product_type === 'store') {
      const beforeRows = await getOrderStatusAuditRows(database, [row.order_id]);
      const result = await database.query(
        `UPDATE orders
         SET order_status = ?,
             transaction_started_at = CURRENT_TIMESTAMP,
             transaction_start_error = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND (order_status IS NULL OR order_status = '')`,
        [ORDER_STATUS_PENDING_PAYMENT, row.order_id]
      );
      storeUpdated += result.rowCount || 0;
      if (result.rowCount) {
        await writeOrderStatusAuditLogs(database, beforeRows, {
          status: ORDER_STATUS_PENDING_PAYMENT,
          source: 'transaction_start_jobs_store',
          metadata: {
            productId: row.product_id,
            productType: row.product_type,
            shippingFeeText: row.shipping_fee_text || '',
            includeAfterCutoff: !!includeAfterCutoff
          }
        }).catch(() => null);
      }
      logJobs.push({
        orderId: row.order_id,
        productId: row.product_id,
        productType: row.product_type || 'store',
        shippingFeeText: row.shipping_fee_text || '',
        status: ORDER_STATUS_PENDING_PAYMENT
      });
      continue;
    }
    const job = {
      orderId: row.order_id,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      shippingFeeText: row.shipping_fee_text || '',
      transactionUrl: row.transaction_url || ''
    };
    jobs.push(job);
    logJobs.push(job);
  }
  return { jobs, logJobs, storeUpdated, missingTransactionUrl, total: rows.length };
}

function normalizeOrderStatus(value) {
  return [
    ORDER_STATUS_PENDING_PAYMENT,
    ORDER_STATUS_WAITING_SHIPPING,
    ORDER_STATUS_PENDING_BUNDLE,
    ORDER_STATUS_CANCELLED
  ].includes(value) ? value : null;
}

async function updateTransactionStartStatus(payload = {}, database = db) {
  const error = String(payload.error || '').trim();
  let ids = Array.isArray(payload.orderIds)
    ? payload.orderIds
    : (payload.orderId ? [payload.orderId] : []);
  if ((!ids || !ids.length) && Array.isArray(payload.productIds) && payload.productIds.length) {
    const productIds = payload.productIds
      .map(id => String(id || '').trim().toLowerCase())
      .filter(Boolean);
    if (productIds.length) {
      const productPlaceholders = productIds.map(() => '?').join(',');
      const rows = await database.getAll(
        `SELECT o.id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE t.product_id IN (${productPlaceholders})
           AND t.status = 'success'
           AND (o.order_status IS NULL OR o.order_status = '')`,
        productIds
      );
      ids = rows.map(row => row.id);
    }
  }
  const orderIds = ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
  if (!orderIds.length) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const placeholders = orderIds.map(() => '?').join(',');
  if (error) {
    const result = await database.query(
      `UPDATE orders
       SET transaction_start_error = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})
         AND (order_status IS NULL OR order_status = '')`,
      [error, ...orderIds]
    );
    await appendTransactionStartRunLogResult(database, {
      orderIds,
      productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
      error,
      updated: result.rowCount || 0
    }).catch(() => null);
    const productIds = Array.isArray(payload.productIds) && payload.productIds.length
      ? payload.productIds
      : [payload.productId || ''];
    for (const productId of productIds) {
      await savePluginDiagnostic(database, {
        type: 'transaction_start',
        level: 'error',
        productId,
        orderId: orderIds[0],
        action: payload.action || '',
        method: payload.method || '',
        message: error,
        diagnostics: payload.diagnostics || error,
        url: payload.url || ''
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0 };
  }

  const status = normalizeOrderStatus(payload.status);
  if (!status) {
    const err = new Error('valid status is required');
    err.statusCode = 400;
    throw err;
  }
  const bundleGroupId = status === ORDER_STATUS_PENDING_BUNDLE
    ? String(payload.bundleGroupId || '').trim()
    : null;
  if (status === ORDER_STATUS_PENDING_BUNDLE && !bundleGroupId) {
    const err = new Error('bundleGroupId is required');
    err.statusCode = 400;
    throw err;
  }
  const beforeRows = await getOrderStatusAuditRows(database, orderIds);
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         bundle_group_id = COALESCE(?, bundle_group_id),
         transaction_started_at = CURRENT_TIMESTAMP,
         transaction_start_error = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})
       AND (order_status IS NULL OR order_status = '')`,
    [status, bundleGroupId, ...orderIds]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status,
      source: 'transaction_start_status',
      metadata: {
        productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
        bundleGroupId,
        payloadStatus: payload.status || ''
      }
    }).catch(() => null);
  }
  await appendTransactionStartRunLogResult(database, {
    orderIds,
    productIds: Array.isArray(payload.productIds) ? payload.productIds : [],
    status,
    updated: result.rowCount || 0
  }).catch(() => null);
  return { updated: result.rowCount || 0 };
}

function normalizePlainText(value, maxLength = 128) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeDiagnosticText(value, maxLength = 2000) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

async function savePluginDiagnostic(database = db, payload = {}) {
  const type = normalizePlainText(payload.type || 'general', 64);
  const levelValue = normalizePlainText(payload.level || 'info', 16).toLowerCase();
  const level = ['debug', 'info', 'warn', 'error'].includes(levelValue) ? levelValue : 'info';
  const productId = normalizePlainText(payload.productId || payload.product_id || '', 32).toLowerCase();
  const orderId = Number(payload.orderId || payload.order_id || 0);
  const action = normalizePlainText(payload.action || '', 64);
  const method = normalizePlainText(payload.method || '', 64);
  const message = normalizeDiagnosticText(payload.message || payload.error || '', 1000);
  const diagnostics = normalizeDiagnosticText(payload.diagnostics || '', 3000);
  const url = normalizeDiagnosticText(payload.url || '', 1000);
  const result = await database.query(
    `INSERT INTO plugin_diagnostics
       (type, level, product_id, order_id, action, method, message, diagnostics, url, created_at)
     VALUES (?, ?, NULLIF(?, ''), NULLIF(?, 0), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), CURRENT_TIMESTAMP)`,
    [type, level, productId, Number.isInteger(orderId) && orderId > 0 ? orderId : 0, action, method, message, diagnostics, url]
  );
  return { inserted: result.rowCount || 0 };
}

async function getPluginDiagnostics(database = db, filters = {}) {
  const where = [];
  const params = [];
  const productId = normalizePlainText(filters.productId || filters.product_id || '', 32).toLowerCase();
  const orderId = Number(filters.orderId || filters.order_id || 0);
  const type = normalizePlainText(filters.type || '', 64);
  if (productId) {
    where.push('product_id = ?');
    params.push(productId);
  }
  if (Number.isInteger(orderId) && orderId > 0) {
    where.push('order_id = ?');
    params.push(orderId);
  }
  if (type) {
    where.push('type = ?');
    params.push(type);
  }
  const rawLimit = Number(filters.limit || 100);
  const limit = Math.min(500, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 100));
  const rows = await database.getAll(
    `SELECT id, type, level, product_id, order_id, action, method, message, diagnostics, url, created_at
     FROM plugin_diagnostics
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY datetime(created_at) DESC, id DESC
     LIMIT ?`,
    [...params, limit]
  );
  return { diagnostics: rows, total: rows.length };
}

const getTaxIncludedFinalPrice = taxExcludedToTaxIncluded;

function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function getSheetFinanceBaseConfig(database = db) {
  const rows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('jpy_to_cny_rate', 'bank_fee_jpy', 'handling_fee_cny', 'large_amount_fee_cny')"
  );
  const values = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
  let rate = Number(values.jpy_to_cny_rate || 0);
  if (!rate && typeof database.getOne === 'function') {
    const latestRate = await database.getOne('SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1').catch(() => null);
    rate = Number(latestRate?.rate || 0);
  }
  return {
    rate: rate || 0.049,
    bankFeeJpy: Number(values.bank_fee_jpy || 0),
    handlingFeeCny: Number(values.handling_fee_cny || 0),
    largeAmountFeeCny: Number(values.large_amount_fee_cny || 0)
  };
}

function getBundleSheetColor(bundleGroupId) {
  const text = String(bundleGroupId || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i)) % BUNDLE_SHEET_COLORS.length;
  return BUNDLE_SHEET_COLORS[hash];
}

function formatSheetDate(value) {
  const text = String(value || '').trim();
  return text ? text.slice(0, 10) : '';
}

function buildDaipaiSheetRow(order = {}, baseConfig = {}) {
  const payable = calculateSheetPayable(order, baseConfig);
  return [
    formatSheetDate(order.won_at || order.created_at),
    order.username || '',
    order.product_url || '',
    order.product_title || '',
    Number(order.final_price || 0),
    order.shipping_fee_text || '',
    order.bundle_shipping_fee_text || '',
    payable.totalJpy,
    order.shipping_company || '',
    order.tracking_number || ''
  ];
}

async function getOrdersForSheetAppend(orderId, database = db) {
  const target = await database.getOne(
    `SELECT id, bundle_group_id
     FROM orders
     WHERE id = ?`,
    [orderId]
  );
  if (!target) return { orders: [], isBundle: false };
  const hasBundleShipping = target.bundle_group_id
    ? await database.getOne(
      `SELECT 1 AS yes
       FROM orders
       WHERE bundle_group_id = ?
         AND COALESCE(bundle_shipping_fee_text, '') <> ''
       LIMIT 1`,
      [target.bundle_group_id]
    )
    : null;
  const where = hasBundleShipping ? 'o.bundle_group_id = ?' : 'o.id = ?';
  const params = hasBundleShipping ? [target.bundle_group_id] : [orderId];
  const orders = await database.getAll(
    `SELECT o.id,
            o.won_at,
            o.created_at,
            o.final_price,
            o.order_status,
            o.bundle_group_id,
            o.bundle_shipping_fee_text,
            o.google_sheet_appended_at,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text,
            COALESCE(p.tax_type, t.tax_type) AS tax_type,
            o.shipping_company,
            o.tracking_number,
            u.username,
            ufo.rate_adjustment AS user_rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     INNER JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE ${where}
       AND o.order_status IN (?, ?)
       AND o.google_sheet_appended_at IS NULL
     ORDER BY o.id ASC`,
    [...params, ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]
  );
  return { orders, isBundle: Boolean(hasBundleShipping), bundleGroupId: target.bundle_group_id || '' };
}

async function appendPendingReceiptOrderToGoogleSheet(orderId, database = db) {
  await applyGoogleSheetsConfigFromDb(database);
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured' };
  const { orders, isBundle, bundleGroupId } = await getOrdersForSheetAppend(orderId, database);
  if (!orders.length) return { skipped: true, reason: 'no appendable orders' };
  const baseConfig = await getSheetFinanceBaseConfig(database);
  const rows = orders.map(order => buildDaipaiSheetRow(order, baseConfig));
  const appendResult = await appendGoogleSheetRows({
    rows,
    backgroundColor: isBundle ? getBundleSheetColor(bundleGroupId) : null
  });
  if (!appendResult?.skipped) {
    const ids = orders.map(order => order.id);
    const placeholders = ids.map(() => '?').join(',');
    await database.query(
      `UPDATE orders
       SET google_sheet_appended_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`,
      ids
    );
  }
  return appendResult;
}

async function getOrderForSheetUpdate(orderId, database = db) {
  return database.getOne(
    `SELECT o.id,
            o.won_at,
            o.created_at,
            o.final_price,
            o.order_status,
            o.bundle_group_id,
            o.bundle_shipping_fee_text,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text,
            COALESCE(p.tax_type, t.tax_type) AS tax_type,
            o.shipping_company,
            o.tracking_number,
            u.username,
            ufo.rate_adjustment AS user_rate_adjustment,
            ufo.bank_fee_jpy AS user_bank_fee_jpy,
            ufo.handling_fee_cny AS user_handling_fee_cny,
            ufo.large_amount_fee_cny AS user_large_amount_fee_cny
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     INNER JOIN users u ON t.user_id = u.id
     LEFT JOIN user_finance_overrides ufo ON ufo.user_id = u.id
     WHERE o.id = ?
       AND o.order_status IN (?, ?)`,
    [orderId, ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]
  );
}

async function updatePendingReceiptOrderGoogleSheet(orderId, database = db) {
  await applyGoogleSheetsConfigFromDb(database);
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured' };
  const order = await getOrderForSheetUpdate(orderId, database);
  if (!order) return { skipped: true, reason: 'order not updateable' };
  const baseConfig = await getSheetFinanceBaseConfig(database);
  const row = buildDaipaiSheetRow(order, baseConfig);
  return updateRowsByProductId(order.product_id, row);
}

async function updateExistingWonOrderFromSync(existingOrder = {}, order = {}, database = db) {
  const orderId = Number(existingOrder.id || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) return { updated: false };
  const trackingNumber = normalizePlainText(order.trackingNumber);
  if (!trackingNumber) return { updated: false };
  if (existingOrder.order_status !== ORDER_STATUS_PENDING_SHIPMENT) {
    await database.query(
      `UPDATE orders
       SET tracking_number = COALESCE(NULLIF(?, ''), tracking_number),
           transaction_url = COALESCE(NULLIF(?, ''), transaction_url),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [trackingNumber, String(order.transactionUrl || '').trim(), orderId]
    );
    return { updated: false };
  }

  const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         tracking_number = ?,
         transaction_url = COALESCE(NULLIF(?, ''), transaction_url),
         tracking_rescan_requested = 0,
         shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = ?`,
    [ORDER_STATUS_PENDING_RECEIPT, trackingNumber, String(order.transactionUrl || '').trim(), orderId, ORDER_STATUS_PENDING_SHIPMENT]
  );
  if (result.rowCount) {
    await autoCloseShipmentAlerts(orderId, database).catch(() => null);
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_PENDING_RECEIPT,
      source: 'won_sync_tracking_shipped',
      metadata: { orderId, trackingNumber }
    }).catch(() => null);
    await appendPendingReceiptOrderToGoogleSheet(orderId, database).catch(error => {
      console.warn('[Yahoo Bid] Google Sheet append skipped/failed:', error.message || error);
    });
  }
  return { updated: Boolean(result.rowCount) };
}

function parseShipmentAlerts(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function syncYahooWonOrders(orders = [], database = db) {
  let updated = 0;
  let skippedExisting = 0;
  let forcedResync = 0;
  let missingPrice = 0;
  for (const order of orders) {
    const match = String(order.url || order.productId || '').match(/[a-zA-Z]?\d{8,10}/);
    if (!match) continue;
    const productId = match[0].toLowerCase();
    const task = await database.getOne(
      `SELECT id, force_orders_resync
       FROM tasks
       WHERE product_id = ? AND status IN ('bidding', 'success', 'failed')
       ORDER BY force_orders_resync DESC, datetime(COALESCE(last_bid_at, updated_at, created_at)) DESC, id DESC
       LIMIT 1`,
      [productId]
    );
    if (!task) continue;
    const isForced = Number(task.force_orders_resync || 0) === 1;
    const existingOrder = await database.getOne('SELECT id, order_status, tracking_number FROM orders WHERE task_id = ?', [task.id]);
    if (existingOrder && !isForced) {
      const existingUpdate = await updateExistingWonOrderFromSync(existingOrder, order, database);
      if (existingUpdate.updated) {
        updated += 1;
        continue;
      }
      skippedExisting += 1;
      continue;
    }
    const finalPrice = normalizeYenAmount(order.price);
    if (!finalPrice) {
      missingPrice += 1;
      continue;
    }
    await database.query(
      `UPDATE tasks
       SET status = 'success',
           error_msg = NULL,
           force_orders_resync = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [task.id]
    );
    await upsertOrderFromTask(task.id, {
      finalPrice,
      wonTimeText: order.wonTimeText,
      transactionUrl: order.transactionUrl
    }, database);
    if (order.trackingNumber) {
      await database.query('UPDATE orders SET tracking_number = ?, updated_at = CURRENT_TIMESTAMP WHERE task_id = ?', [order.trackingNumber, task.id]);
    }
    if (isForced) forcedResync += 1;
    updated += 1;
  }
  return { updated, failed: 0, skippedExisting, forcedResync, missingPrice };
}

function normalizeManualImportProductId(value) {
  const match = String(value || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function normalizeManualImportYenAmount(value) {
  const match = String(value || '').match(/(\d[\d,]*)/);
  return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
}

function normalizeManualImportDateTime(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2} /.test(text)) return text;
  return null;
}

async function getManualOrderImportJob(database = db) {
  const batch = await database.getOne(
    `SELECT *
     FROM manual_order_import_batches
     WHERE status = 'requested'
     ORDER BY datetime(created_at) ASC, id ASC
     LIMIT 1`
  );
  if (!batch) return { job: null };
  await database.query(
    `UPDATE manual_order_import_batches
     SET status = 'scanning', error_msg = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'requested'`,
    [batch.id]
  );
  return {
    job: {
      batchId: batch.id,
      startDate: batch.start_date,
      endDate: batch.end_date,
      maxPages: Math.max(1, Math.min(50, Number(batch.max_pages || 10)))
    }
  };
}

async function updateManualOrderImportStatus(payload = {}, database = db) {
  const batchId = Number(payload.batchId || payload.batch_id || 0);
  if (!Number.isInteger(batchId) || batchId <= 0) {
    const err = new Error('batchId is required');
    err.statusCode = 400;
    throw err;
  }
  const status = String(payload.status || '').trim();
  const errorMsg = String(payload.error || '').trim();
  if (errorMsg || status === 'failed') {
    await database.query(
      `UPDATE manual_order_import_batches
       SET status = 'failed',
           error_msg = ?,
           scanned_pages = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [errorMsg || 'manual import scan failed', Number(payload.scannedPages || 0), batchId]
    );
    return { failed: true };
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  let candidateCount = 0;
  let skippedExisting = 0;
  let scannedCount = 0;
  for (const item of items) {
    const productId = normalizeManualImportProductId(item.productId || item.product_id || item.url);
    if (!productId) continue;
    scannedCount += 1;
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
      continue;
    }
    await database.query(
      `INSERT INTO manual_order_import_items
        (batch_id, product_id, product_url, product_title, product_image_url,
         final_price, won_at, won_time_text, transaction_url,
         shipping_fee_text, tax_type, product_type, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(batch_id, product_id) DO UPDATE SET
         product_url = excluded.product_url,
         product_title = excluded.product_title,
         product_image_url = excluded.product_image_url,
         final_price = COALESCE(NULLIF(excluded.final_price, 0), manual_order_import_items.final_price),
         won_at = excluded.won_at,
         won_time_text = excluded.won_time_text,
         transaction_url = excluded.transaction_url,
         shipping_fee_text = excluded.shipping_fee_text,
         tax_type = excluded.tax_type,
         product_type = excluded.product_type,
         updated_at = CURRENT_TIMESTAMP`,
      [
        batchId,
        productId,
        item.productUrl || item.product_url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
        item.productTitle || item.title || item.product_title || productId,
        item.productImageUrl || item.imageUrl || item.product_image_url || '',
        normalizeManualImportYenAmount(item.finalPrice || item.price || item.final_price),
        normalizeManualImportDateTime(item.wonAt || item.won_at),
        item.wonTimeText || item.won_time_text || '',
        item.transactionUrl || item.transaction_url || '',
        item.shippingFeeText || item.shipping_fee_text || '',
        item.taxType || item.tax_type || 'tax_zero',
        item.productType || item.product_type || 'normal'
      ]
    );
    candidateCount += 1;
  }

  const totalCandidates = await database.getOne(
    `SELECT COUNT(*) AS count FROM manual_order_import_items WHERE batch_id = ? AND status = 'pending_user'`,
    [batchId]
  );
  await database.query(
    `UPDATE manual_order_import_batches
     SET status = 'ready',
         scanned_pages = ?,
         scanned_count = ?,
         candidate_count = ?,
         skipped_existing_count = ?,
         scanned_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      Number(payload.scannedPages || 0),
      scannedCount,
      Number(totalCandidates?.count || candidateCount),
      skippedExisting,
      batchId
    ]
  );
  return { ready: true, candidateCount: Number(totalCandidates?.count || candidateCount), skippedExisting };
}

async function getShipmentAlerts(database = db) {
  const row = await database.getOne(
    `SELECT value FROM config WHERE key = ?`,
    [SHIPMENT_ALERTS_CONFIG_KEY]
  );
  return parseShipmentAlerts(row?.value);
}

async function saveShipmentAlerts(database, alerts) {
  await saveConfigValue(database, SHIPMENT_ALERTS_CONFIG_KEY, JSON.stringify(alerts || []));
}

function calculateOverdueShipmentDays(sinceValue, nowMs = Date.now()) {
  const sinceMs = parseTimeMs(sinceValue);
  if (!sinceMs) return 0;
  const days = Math.floor((nowMs - sinceMs) / (24 * 60 * 60 * 1000));
  return Number.isFinite(days) && days > 7 ? days : 0;
}

async function addPendingShipmentAlert(payload = {}, database = db, nowMs = Date.now()) {
  const orderId = Number(payload.orderId || 0);
  const productId = normalizePlainText(payload.productId, 32);
  const daysOverdue = Number(payload.daysOverdue || 0);
  if (!Number.isInteger(orderId) || orderId <= 0 || !productId || daysOverdue <= 7) {
    return { added: false };
  }
  const id = `shipment-${orderId}-${daysOverdue}`;
  const alerts = await getShipmentAlerts(database);
  if (alerts.some(alert => alert.id === id)) return { added: false, duplicate: true };
  alerts.push({
    id,
    orderId,
    productId,
    productTitle: normalizePlainText(payload.productTitle, 160),
    daysOverdue,
    createdDate: getLocalDateKey(nowMs),
    createdAt: new Date(nowMs).toISOString(),
    closedAt: null,
    autoClosedAt: null
  });
  await saveShipmentAlerts(database, alerts);
  return { added: true, id };
}

async function autoCloseShipmentAlerts(orderId, database = db) {
  const targetOrderId = Number(orderId || 0);
  if (!Number.isInteger(targetOrderId) || targetOrderId <= 0) return { closed: 0 };
  const alerts = await getShipmentAlerts(database);
  let closed = 0;
  const now = new Date().toISOString();
  const next = alerts.map(alert => {
    if (Number(alert.orderId) !== targetOrderId || alert.closedAt || alert.autoClosedAt) return alert;
    closed += 1;
    return { ...alert, autoClosedAt: now };
  });
  if (closed) await saveShipmentAlerts(database, next);
  return { closed };
}

async function getScanJobs(database = db) {
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.order_status,
            o.transaction_url,
            o.bundle_group_id,
            o.tracking_rescan_requested,
            COALESCE((
              SELECT MAX(l.created_at)
              FROM order_status_change_logs l
              WHERE l.order_id = o.id
                AND l.new_status = ?
            ), o.updated_at, o.created_at) AS pending_shipment_since,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.product_type, t.product_type) AS product_type,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE (o.order_status IN (?, ?, ?)
            OR (o.order_status = ? AND COALESCE(o.tracking_rescan_requested, 0) = 1))
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC`,
    [ORDER_STATUS_PENDING_SHIPMENT, ORDER_STATUS_PENDING_SHIPMENT, ORDER_STATUS_WAITING_SHIPPING, ORDER_STATUS_PENDING_BUNDLE, ORDER_STATUS_PENDING_RECEIPT]
  );
  return {
    jobs: rows.map(row => ({
      orderId: row.order_id,
      orderStatus: Number(row.tracking_rescan_requested || 0) === 1 ? ORDER_STATUS_PENDING_SHIPMENT : row.order_status,
      originalOrderStatus: row.order_status,
      trackingRescanRequested: Number(row.tracking_rescan_requested || 0) === 1,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      shippingFeeText: row.shipping_fee_text || '',
      bundleGroupId: row.bundle_group_id || '',
      transactionUrl: row.transaction_url || '',
      pendingShipmentSince: row.pending_shipment_since || ''
    })),
    total: rows.length
  };
}

async function updateScanStatus(payload = {}, database = db) {
  const orderId = Number(payload.orderId || 0);
  const shippingFeeText = normalizeShippingFeeText(payload.shippingFeeText);
  const bundleShippingFeeText = normalizeShippingFeeText(payload.bundleShippingFeeText);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  if (payload.cancelled === true) {
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND order_status = ?`,
      [ORDER_STATUS_CANCELLED, orderId, ORDER_STATUS_PENDING_SHIPMENT]
    );
    if (result.rowCount) {
      await autoCloseShipmentAlerts(orderId, database).catch(() => null);
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_CANCELLED,
        source: 'scan_pending_shipment_cancelled',
        metadata: { orderId }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, cancelled: true };
  }
  if (payload.shipped === true) {
    const shippingCompany = normalizePlainText(payload.shippingCompany);
    const trackingNumber = normalizePlainText(payload.trackingNumber);
    const trackingRescanRequested = payload.trackingRescanRequested === true;
    if (!trackingNumber) {
      const err = new Error('valid trackingNumber is required');
      err.statusCode = 400;
      throw err;
    }
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           shipping_company = ?,
           tracking_number = ?,
           tracking_rescan_requested = 0,
           shipped_at = COALESCE(shipped_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND (order_status = ? OR COALESCE(tracking_rescan_requested, 0) = 1)`,
      [ORDER_STATUS_PENDING_RECEIPT, shippingCompany || null, trackingNumber, orderId, ORDER_STATUS_PENDING_SHIPMENT]
    );
    if (result.rowCount) {
      await autoCloseShipmentAlerts(orderId, database).catch(() => null);
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_PENDING_RECEIPT,
        source: 'scan_pending_shipment_shipped',
          metadata: { orderId, shippingCompany, trackingNumber }
        }).catch(() => null);
      if (trackingRescanRequested) {
        await updatePendingReceiptOrderGoogleSheet(orderId, database).catch(error => {
          console.warn('[Yahoo Bid] Google Sheet update skipped/failed:', error.message || error);
        });
      } else {
        await appendPendingReceiptOrderToGoogleSheet(orderId, database).catch(error => {
          console.warn('[Yahoo Bid] Google Sheet append skipped/failed:', error.message || error);
        });
      }
    }
    return { updated: result.rowCount || 0, shipped: true, shippingCompany, trackingNumber, trackingRescanRequested };
  }
  if (payload.pendingShipment === true) {
    const daysOverdue = Number(payload.daysOverdue || 0);
    const alertResult = await addPendingShipmentAlert({
      orderId,
      productId: payload.productId,
      productTitle: payload.productTitle,
      daysOverdue
    }, database).catch(() => ({ added: false }));
    return { updated: 0, pendingShipment: true, daysOverdue, alert: alertResult };
  }
  if (payload.bundleRejected === true) {
    const beforeRows = typeof database.getAll === 'function'
      ? await database.getAll(
        `SELECT o.id AS order_id, o.order_status AS old_status, t.product_id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE o.bundle_group_id = (
           SELECT bundle_group_id FROM orders WHERE id = ?
         )
           AND o.bundle_group_id IS NOT NULL`,
        [orderId]
      )
      : [];
    const result = await database.query(
      `UPDATE orders
       SET order_status = NULL,
           bundle_group_id = NULL,
           bundle_shipping_fee_text = NULL,
           transaction_start_error = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE bundle_group_id = (
         SELECT bundle_group_id FROM orders WHERE id = ?
       )
         AND bundle_group_id IS NOT NULL`,
      [orderId]
    );
    if (result.rowCount) {
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: null,
        source: 'scan_bundle_rejected',
        metadata: { orderId }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, bundleRejected: true };
  }
  if (bundleShippingFeeText) {
    const beforeRows = typeof database.getAll === 'function'
      ? await database.getAll(
        `SELECT o.id AS order_id, o.order_status AS old_status, t.product_id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE o.bundle_group_id = (
           SELECT bundle_group_id FROM orders WHERE id = ?
         )
           AND o.bundle_group_id IS NOT NULL
           AND o.order_status = ?`,
        [orderId, ORDER_STATUS_PENDING_BUNDLE]
      )
      : [];
    const result = await database.query(
      `UPDATE orders
       SET bundle_shipping_fee_text = CASE WHEN id = ? THEN ? ELSE ? END,
           order_status = CASE WHEN id = ? THEN ? ELSE ? END,
           updated_at = CURRENT_TIMESTAMP
       WHERE bundle_group_id = (
         SELECT bundle_group_id FROM orders WHERE id = ?
       )
         AND bundle_group_id IS NOT NULL
         AND order_status = ?`,
      [
        orderId,
        bundleShippingFeeText,
        '0円',
        orderId,
        ORDER_STATUS_PENDING_PAYMENT,
        ORDER_STATUS_BUNDLE_COMPLETED,
        orderId,
        ORDER_STATUS_PENDING_BUNDLE
      ]
    );
    if (result.rowCount) {
      const statusesByOrderId = Object.fromEntries(
        beforeRows.map(row => [
          row.order_id,
          Number(row.order_id) === orderId ? ORDER_STATUS_PENDING_PAYMENT : ORDER_STATUS_BUNDLE_COMPLETED
        ])
      );
      await writeOrderStatusAuditLogs(database, beforeRows, {
        statusesByOrderId,
        source: 'scan_bundle_shipping',
        metadata: { orderId, bundleShippingFeeText }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, bundleShippingFeeText };
  }
  if (payload.pending === true) {
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [ORDER_STATUS_WAITING_SHIPPING, orderId]
    );
    if (result.rowCount) {
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_WAITING_SHIPPING,
        source: 'scan_waiting_shipping_pending',
        metadata: { orderId }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, pending: true };
  }
  if (!shippingFeeText) {
    const err = new Error('valid shippingFeeText is required');
    err.statusCode = 400;
    throw err;
  }

  const taskSnapshot = typeof database.getOne === 'function'
    ? await database.getOne(
      `SELECT t.product_id,
              COALESCE(p.product_url, t.product_url) AS product_url,
              COALESCE(p.product_title, t.product_title) AS product_title,
              COALESCE(p.product_image_url, t.product_image_url) AS product_image_url,
              COALESCE(p.current_price, t.current_price) AS current_price,
              COALESCE(p.buyout_price, t.buyout_price) AS buyout_price,
              COALESCE(p.bid_count, t.bid_count) AS bid_count,
              COALESCE(p.tax_type, t.tax_type) AS tax_type,
              COALESCE(p.product_type, t.product_type) AS product_type,
              COALESCE(p.end_time, t.end_time) AS end_time
       FROM tasks t
       INNER JOIN orders o ON o.task_id = t.id
       LEFT JOIN products p ON p.product_id = t.product_id
       WHERE o.id = ?
         AND o.order_status = ?
       LIMIT 1`,
      [orderId, ORDER_STATUS_WAITING_SHIPPING]
    )
    : null;

  await database.query(
    `UPDATE tasks
     SET shipping_fee_text = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT task_id
       FROM orders
       WHERE id = ?
         AND order_status = ?
     )`,
    [shippingFeeText, orderId, ORDER_STATUS_WAITING_SHIPPING]
  );
  if (taskSnapshot?.product_id) {
    await upsertProductSnapshot(database, {
      ...taskSnapshot,
      shipping_fee_text: shippingFeeText
    }, { source: 'fetch' });
  }
  const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
  const result = await database.query(
    `UPDATE orders
     SET order_status = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = ?`,
    [ORDER_STATUS_PENDING_PAYMENT, orderId, ORDER_STATUS_WAITING_SHIPPING]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_PENDING_PAYMENT,
      source: 'scan_waiting_shipping_resolved',
      metadata: { orderId, shippingFeeText }
    }).catch(() => null);
  }
  return { updated: result.rowCount || 0, shippingFeeText };
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const intValue = Math.floor(parsed);
  return intValue > 0 ? intValue : fallback;
}

function randomIntInclusive(min, max, randomFn = Math.random) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  if (high <= low) return low;
  const raw = Number(randomFn());
  const randomValue = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : Math.random();
  return low + Math.floor(randomValue * (high - low + 1));
}

function getPaymentJobLimitRange(values = {}) {
  const legacyLimit = parsePositiveInt(values.payment_job_limit, DEFAULT_PAYMENT_JOB_LIMIT);
  const minValue = parsePositiveInt(values.payment_job_limit_min, legacyLimit);
  const maxValue = parsePositiveInt(values.payment_job_limit_max, legacyLimit);
  return {
    min: Math.min(minValue, maxValue),
    max: Math.max(minValue, maxValue)
  };
}

function normalizeReceiptColorConfig(value, fallback = DEFAULT_CONFIRM_RECEIPT_COLOR) {
  const text = String(value || '').trim().toLowerCase();
  const hex = text.startsWith('#') ? text : `#${text}`;
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : fallback;
}

async function isConfirmReceiptSheetColorMatched(productId, colorHex, options = {}) {
  const targetProductId = String(productId || '').trim();
  if (!targetProductId) return false;
  if (!options.findRowsByProductIdWithAnyColor) await applyGoogleSheetsConfigFromDb(db);
  const resolver = options.findRowsByProductIdWithAnyColor || findRowsByProductIdWithAnyColor;
  if (typeof resolver !== 'function') return false;
  const result = await resolver(targetProductId, colorHex);
  return Boolean(result?.matched || (Array.isArray(result?.rows) && result.rows.length));
}

async function getConfirmReceiptJobs(database = db, options = {}) {
  const configRows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('confirm_receipt_color')"
  );
  const values = Object.fromEntries((configRows || []).map(row => [row.key, row.value]));
  const colorHex = normalizeReceiptColorConfig(values.confirm_receipt_color || DEFAULT_CONFIRM_RECEIPT_COLOR);
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.order_status,
            o.transaction_url,
            o.bundle_group_id,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.product_type, t.product_type) AS product_type
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE o.order_status IN (?, ?, ?)
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC`,
    [ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_PENDING_PAYMENT, ORDER_STATUS_PENDING_SETTLEMENT]
  );
  const jobs = [];
  for (const row of rows) {
    const orderStatus = row.order_status || '';
    const isReceiptJob = orderStatus === ORDER_STATUS_PENDING_RECEIPT;
    let sheetMatched = !isReceiptJob;
    let sheetError = '';
    if (isReceiptJob) {
      try {
        sheetMatched = await isConfirmReceiptSheetColorMatched(row.product_id, colorHex, options);
      } catch (error) {
        sheetError = error.message || String(error);
      }
    }
    if (!sheetMatched) continue;
    if (!isReceiptJob && !row.transaction_url) continue;
    jobs.push({
      orderId: row.order_id,
      orderStatus,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      transactionUrl: row.transaction_url || '',
      bundleGroupId: row.bundle_group_id || '',
      receiptColor: colorHex,
      jobType: isReceiptJob ? 'confirm_receipt' : 'cancel_check',
      sheetMatched: true,
      sheetError
    });
  }
  return {
    jobs,
    total: jobs.length,
    scanned: rows.length,
    receiptColor: colorHex
  };
}

async function updateConfirmReceiptStatus(payload = {}, database = db) {
  if (payload.empty === true) {
    await saveConfigValue(database, 'confirm_receipt_requested', '0');
    await saveConfigValue(database, 'confirm_receipt_alert_message', '');
    return { confirmReceiptRequested: 0 };
  }
  const error = String(payload.error || '').trim();
  if (error) {
    await saveConfigValue(database, 'confirm_receipt_requested', '0');
    await saveConfigValue(database, 'confirm_receipt_alert_message', `确认收货失败：商品ID ${String(payload.productId || '-')}，原因：${error}`);
    return { confirmReceiptRequested: 0 };
  }
  const orderId = Number(payload.orderId || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const status = String(payload.status || '').trim();
  if (status === 'cancelled') {
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND order_status IN (?, ?, ?)`,
      [
        ORDER_STATUS_CANCELLED,
        orderId,
        ORDER_STATUS_PENDING_PAYMENT,
        ORDER_STATUS_PENDING_SETTLEMENT,
        ORDER_STATUS_PENDING_RECEIPT
      ]
    );
    if (result.rowCount) {
      await saveConfigValue(database, 'confirm_receipt_alert_message', '');
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_CANCELLED,
        source: 'confirm_receipt_cancel_check',
        metadata: { orderId, productId: payload.productId || '' }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, cancelled: true };
  }
  if (status !== 'success' && status !== 'already_completed') {
    const err = new Error('valid confirm receipt status is required');
    err.statusCode = 400;
    throw err;
  }
  const bundleGroupId = String(payload.bundleGroupId || '').trim();
  let beforeRows = [];
  let result;
  if (bundleGroupId) {
    beforeRows = typeof database.getAll === 'function'
      ? await database.getAll(
        `SELECT o.id AS order_id, o.order_status AS old_status, t.product_id
         FROM orders o
         INNER JOIN tasks t ON o.task_id = t.id
         WHERE o.bundle_group_id = ?
           AND o.order_status IN (?, ?)`,
        [bundleGroupId, ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]
      )
      : [];
    result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE bundle_group_id = ?
         AND order_status IN (?, ?)`,
      [ORDER_STATUS_COMPLETED, bundleGroupId, ORDER_STATUS_PENDING_RECEIPT, ORDER_STATUS_BUNDLE_COMPLETED]
    );
  } else {
    beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND order_status = ?`,
      [ORDER_STATUS_COMPLETED, orderId, ORDER_STATUS_PENDING_RECEIPT]
    );
  }
  if (result.rowCount) {
    await saveConfigValue(database, 'confirm_receipt_alert_message', '');
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_COMPLETED,
      source: 'confirm_receipt_status',
      metadata: { orderId, bundleGroupId, status }
    }).catch(() => null);
  }
  return { updated: result.rowCount || 0 };
}

async function getPaymentJobs(database = db, options = {}) {
  const configRows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('payment_job_limit', 'payment_job_limit_min', 'payment_job_limit_max')"
  );
  const values = Object.fromEntries((configRows || []).map(row => [row.key, row.value]));
  const range = getPaymentJobLimitRange(values);
  const limit = randomIntInclusive(range.min, range.max, options.random || Math.random);
  const rows = await database.getAll(
    `SELECT o.id AS order_id,
            o.transaction_url,
            o.total_amount_cny,
            o.final_price,
            CASE
              WHEN COALESCE(o.bundle_group_id, '') <> '' THEN COALESCE((
                SELECT SUM(og.final_price)
                FROM orders og
                INNER JOIN tasks tg ON og.task_id = tg.id
                WHERE og.bundle_group_id = o.bundle_group_id
                  AND og.order_status IN (?, ?)
                  AND tg.status = 'success'
              ), o.final_price)
              ELSE o.final_price
            END AS payment_final_price,
            o.bundle_shipping_fee_text,
            o.bundle_group_id,
            t.product_id,
            COALESCE(p.product_url, t.product_url) AS product_url,
            COALESCE(p.product_title, t.product_title) AS product_title,
            COALESCE(p.product_type, t.product_type) AS product_type,
            COALESCE(p.shipping_fee_text, t.shipping_fee_text) AS shipping_fee_text
     FROM orders o
     INNER JOIN tasks t ON o.task_id = t.id
     LEFT JOIN products p ON p.product_id = t.product_id
     WHERE o.order_status = ?
       AND o.total_amount_cny IS NOT NULL
       AND t.status = 'success'
     ORDER BY datetime(COALESCE(o.won_at, o.created_at)) ASC, o.id ASC
     LIMIT ?`,
    [ORDER_STATUS_PENDING_SETTLEMENT, ORDER_STATUS_BUNDLE_COMPLETED, ORDER_STATUS_PENDING_SETTLEMENT, limit]
  );
  return {
    jobs: rows.map(row => ({
      orderId: row.order_id,
      productId: row.product_id,
      productUrl: row.product_url,
      productTitle: row.product_title,
      productType: row.product_type || 'normal',
      transactionUrl: row.transaction_url || '',
      payableCny: row.total_amount_cny,
      finalPrice: row.final_price,
      paymentFinalPrice: row.payment_final_price,
      effectiveShippingFeeText: row.bundle_shipping_fee_text || row.shipping_fee_text || '',
      bundleGroupId: row.bundle_group_id || ''
    })),
    total: rows.length,
    limit,
    limitMin: range.min,
    limitMax: range.max
  };
}

async function savePaymentConfigValue(database, key, value) {
  await database.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)`,
    [key, String(value)]
  );
}

function getPaymentActionLabel(errorText) {
  const match = String(errorText || '').match(/(?:^|;\s*)action=([^;]+)/i);
  const action = match ? match[1].trim().toLowerCase() : '';
  if (!action) return '';
  if (action.includes('review')) return '确认付款';
  if (action.includes('final')) return '提交支付';
  if (action.includes('shipping')) return '选择运费';
  if (action.includes('transaction')) return '填写交易信息';
  if (action.includes('payment') || action.includes('purchase')) return '进入付款流程';
  return '';
}

function summarizePaymentError(errorText) {
  const text = String(errorText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '付款失败';

  const actionLabel = getPaymentActionLabel(text);
  if (/payment next page did not appear/i.test(text)) {
    return actionLabel ? `${actionLabel}后页面未跳转` : '点击确认后页面未跳转';
  }
  if (/payment completion page did not appear/i.test(text)) return '提交支付后未出现完成页';
  if (/store confirmation change button not found/i.test(text)) return '店铺确认事项：未找到変更按钮';
  if (/store confirmation apply button not found/i.test(text)) return '店铺确认事项：未找到変更する按钮';
  if (/store confirmation edit page did not appear/i.test(text)) return '店铺确认事项：点击変更后未进入编辑页';
  if (/store confirmation review page did not return/i.test(text)) return '店铺确认事项：点击変更する后未返回付款确认页';
  if (/store confirmation .*click point not found/i.test(text)) return '店铺确认事项：未找到真实点击位置';
  if (/payment expected amount unavailable/i.test(text)) return '未识别到页面应付金额';
  const amountMismatch = text.match(/payment amount mismatch:\s*expected\s*([^,;]+),\s*found\s*([^,;]+)/i);
  if (amountMismatch) return `付款金额不一致（应付 ${amountMismatch[1].trim()}，页面 ${amountMismatch[2].trim()}）`;
  if (/payment amount mismatch/i.test(text)) return '付款金额不一致';
  if (/payment review button not found/i.test(text)) return '未找到付款确认按钮';
  if (/payment finalize button not found/i.test(text)) return '未找到最终支付按钮';
  if (/shipping option .* not selectable/i.test(text)) return '未能选择匹配的运费选项';
  if (/transaction info input flow failed/i.test(text)) return '交易信息输入流程失败';
  if (/button not found/i.test(text)) return actionLabel ? `${actionLabel}按钮未找到` : '页面按钮未找到';

  const compact = text
    .replace(/;\s*(?:url|controls|candidates|rect|html|body|pageSample|visibleState|options|stateSummary|candidateSummary)=.*$/i, '')
    .replace(/(?:^|;\s*)(?:synthetic|trusted)=[^;]*/gi, '')
    .replace(/(?:^|;\s*)action=([^;]+)/i, (_match, action) => {
      const label = getPaymentActionLabel(`action=${action}`);
      return label ? `${label}：` : '';
    })
    .replace(/[;；]\s*/g, '，')
    .replace(/，+/g, '，')
    .replace(/^，|，$/g, '')
    .trim();

  if (!compact) return '付款失败';
  return compact.length > 60 ? `${compact.slice(0, 60)}...` : compact;
}

async function updatePaymentStatus(payload = {}, database = db) {
  if (payload.empty === true) {
    await savePaymentConfigValue(database, 'payment_requested', '0');
    return { paymentRequested: 0 };
  }

  const error = String(payload.error || '').trim();
  if (error) {
    const productId = String(payload.productId || '').trim() || '-';
    const reason = summarizePaymentError(error);
    await savePaymentConfigValue(database, 'payment_requested', '0');
    await savePaymentConfigValue(database, 'payment_alert_message', `付款失败：商品ID ${productId}，原因：${reason}`);
    await savePluginDiagnostic(database, {
      type: 'payment',
      level: 'error',
      productId,
      orderId: payload.orderId,
      action: payload.action || '',
      method: payload.method || '',
      message: error,
      diagnostics: payload.diagnostics || error,
      url: payload.url || ''
    }).catch(() => null);
    return { paymentRequested: 0 };
  }

  const orderId = Number(payload.orderId || 0);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    const err = new Error('orderId is required');
    err.statusCode = 400;
    throw err;
  }
  const paymentStatus = String(payload.status || '').trim();
  if (paymentStatus === 'cancelled') {
    const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
    const result = await database.query(
      `UPDATE orders
       SET order_status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND order_status IN (?, ?, ?)`,
      [
        ORDER_STATUS_CANCELLED,
        orderId,
        ORDER_STATUS_PENDING_PAYMENT,
        ORDER_STATUS_PENDING_SETTLEMENT,
        ORDER_STATUS_PENDING_RECEIPT
      ]
    );
    await savePaymentConfigValue(database, 'payment_requested', '0');
    if (result.rowCount) {
      await savePaymentConfigValue(database, 'payment_alert_message', '');
      await writeOrderStatusAuditLogs(database, beforeRows, {
        status: ORDER_STATUS_CANCELLED,
        source: 'payment_cancelled_page',
        metadata: { orderId, productId: payload.productId || '' }
      }).catch(() => null);
    }
    return { updated: result.rowCount || 0, cancelled: true };
  }
  const isSuccessfulPayment = paymentStatus === 'success'
    || paymentStatus === 'already_paid'
    || payload.alreadyPaid === true;
  if (!isSuccessfulPayment) {
    const err = new Error('valid payment status is required');
    err.statusCode = 400;
    throw err;
  }
  const beforeRows = await getOrderStatusAuditRows(database, [orderId]);
  const result = await database.query(
    `UPDATE orders
     SET order_status = 'pending_shipment',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND order_status = 'pending_settlement'`,
    [orderId]
  );
  if (result.rowCount) {
    await writeOrderStatusAuditLogs(database, beforeRows, {
      status: ORDER_STATUS_PENDING_SHIPMENT,
      source: 'payment_status',
      metadata: {
        paymentStatus,
        alreadyPaid: payload.alreadyPaid === true
      }
    }).catch(() => null);
  }
  return { updated: result.rowCount || 0 };
}

router.post('/bidding/sync', async (req, res) => {
  const incomingItems = req.body?.items || req.body?.bidding || [];
  const result = await syncBiddingItems(incomingItems);
  await db.query(
    `INSERT OR REPLACE INTO config (key, value, updated_at)
     VALUES ('last_bidding_sync_count', ?, CURRENT_TIMESTAMP)`,
    [String(Array.isArray(incomingItems) ? incomingItems.length : 0)]
  );
  await setYahooLoginStatus('ok');
  res.json({ success: true, ...result });
});

router.post('/orders/sync', async (req, res) => {
  const orders = Array.isArray(req.body?.orders) ? req.body.orders : [];
  const result = await syncYahooWonOrders(orders, db);
  await setYahooLoginStatus('ok');
  res.json({ success: true, ...result });
});

router.post('/diagnostics', async (req, res) => {
  try {
    const result = await savePluginDiagnostic(db, req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'diagnostic save failed' });
  }
});

router.get('/diagnostics', async (req, res) => {
  try {
    const result = await getPluginDiagnostics(db, req.query || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message || 'diagnostic query failed' });
  }
});

router.get('/transaction-start/jobs', async (req, res) => {
  const config = await getIdleActionConfig();
  const includeAfterCutoff = req.query?.includeAfterCutoff === '1';
  const result = await getTransactionStartJobs(db, {
    includeAfterCutoff,
    transactionStartHour: config.transactionStartHour
  });
  await saveTransactionStartRunLog(db, {
    source: includeAfterCutoff ? 'manual' : 'auto',
    includeAfterCutoff,
    total: result.total,
    storeUpdated: result.storeUpdated,
    missingTransactionUrl: result.missingTransactionUrl,
    jobs: result.logJobs || result.jobs
  }).catch(() => null);
  res.json({ success: true, ...result });
});

router.post('/transaction-start/status', async (req, res) => {
  try {
    const result = await updateTransactionStartStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'update failed' });
  }
});

router.get('/scan/jobs', async (req, res) => {
  const result = await getScanJobs(db);
  res.json({ success: true, ...result });
});

router.get('/manual-order-import/jobs', async (req, res) => {
  try {
    const result = await getManualOrderImportJob(db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual import jobs failed' });
  }
});

router.post('/manual-order-import/status', async (req, res) => {
  try {
    const result = await updateManualOrderImportStatus(req.body || {}, db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'manual import update failed' });
  }
});

router.post('/scan/status', async (req, res) => {
  try {
    const result = await updateScanStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'scan update failed' });
  }
});

router.get('/confirm-receipt/jobs', async (req, res) => {
  try {
    const result = await getConfirmReceiptJobs(db);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'confirm receipt jobs failed' });
  }
});

router.post('/confirm-receipt/status', async (req, res) => {
  try {
    const result = await updateConfirmReceiptStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'confirm receipt update failed' });
  }
});

router.get('/payment/jobs', async (req, res) => {
  const config = await getIdleActionConfig();
  const result = await getPaymentJobs(db);
  res.json({
    success: true,
    paymentPageStaySeconds: config.paymentPageStaySeconds,
    ...result
  });
});

router.post('/payment/status', async (req, res) => {
  try {
    const result = await updatePaymentStatus(req.body || {});
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'payment update failed' });
  }
});

router.post('/manual-captcha/challenge', async (req, res) => {
  try {
    const challenge = await saveCaptchaChallenge(db, req.body || {});
    res.json({ success: true, challenge: { ...challenge, imageDataUrl: challenge.imageDataUrl } });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message || 'captcha challenge failed' });
  }
});

router.get('/manual-captcha/answer/:id', async (req, res) => {
  const challenge = await getCaptchaChallenge(db);
  if (!challenge || challenge.id !== String(req.params.id || '')) {
    return res.json({ success: true, found: false, answered: false });
  }
  res.json({
    success: true,
    found: true,
    answered: !!challenge.answer,
    answer: challenge.answer || ''
  });
});

router.get('/manual-captcha/current', async (req, res) => {
  const challenge = await getCaptchaChallenge(db);
  if (!challenge) {
    return res.json({ success: true, found: false, answered: false });
  }
  res.json({
    success: true,
    found: true,
    id: challenge.id,
    type: challenge.type || 'captcha',
    answered: !!challenge.answer,
    answer: challenge.answer || '',
    pageUrl: challenge.pageUrl || '',
    productId: challenge.productId || '',
    source: challenge.source || '',
    createdAt: challenge.createdAt || '',
    answeredAt: challenge.answeredAt || ''
  });
});

router.post('/manual-captcha/close', async (req, res) => {
  const result = await closeCaptchaChallenge(db, req.body?.id || '');
  res.json({ success: true, ...result });
});

router.post('/manual-pin/type', async (req, res) => {
  try {
    const result = await typeManualPinWithSystemKeyboard(req.body?.pin || req.body?.answer || '', {
      windowTitle: req.body?.windowTitle || req.body?.title || ''
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'manual PIN system keyboard input failed'
    });
  }
});

router.post('/yahoo-login/status', async (req, res) => {
  const status = req.body?.status === 'ok' ? 'ok' : 'failed';
  const message = req.body?.message || (status === 'ok' ? '' : '需要登录 Yahoo');
  await setYahooLoginStatus(status, message);
  res.json({ success: true });
});

router.patch('/task/:id/snapshot', async (req, res) => {
  const {
    product_image_url,
    current_price,
    buyout_price,
    tax_type,
    end_time,
    status
  } = req.body || {};
  await db.query(
    `UPDATE tasks
     SET product_image_url = COALESCE(?, product_image_url),
         current_price = COALESCE(?, current_price),
         buyout_price = COALESCE(?, buyout_price),
         tax_type = COALESCE(?, tax_type),
         end_time = COALESCE(?, end_time),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND status != 'cancelled'`,
    [
      product_image_url || null,
      current_price || null,
      buyout_price || null,
      tax_type || null,
      end_time || null,
      status || null,
      req.params.id
    ]
  );
  const task = await db.getOne(
    `SELECT id, product_id, product_url, product_title, product_image_url,
            current_price, buyout_price, bid_count, tax_type, product_type,
            shipping_fee_text, end_time
     FROM tasks
     WHERE id = ?`,
    [req.params.id]
  );
  if (task) {
    await upsertProductSnapshot(db, task, { source: 'fetch' });
  }
  await processPendingFollowupTasks();
  res.json({ success: true });
});

// GET /api/plugin/config - get plugin config
router.get('/config', async (req, res) => {
  const intervalMs = await db.getOne("SELECT value FROM config WHERE key = 'worker_interval_ms'");
  const rate = await db.getOne("SELECT rate FROM exchange_config ORDER BY updated_at DESC LIMIT 1");
  const multiBidConfig = await getMultiBidConfig();
  res.json({
    workerIntervalMs: parseInt(intervalMs?.value || '10000'),
    jpyToCnyRate: parseFloat(rate?.rate || '0.049'),
    multiBidStartHours: multiBidConfig.multiBidStartHours,
    multiBidIntervalMinutes: multiBidConfig.multiBidIntervalMinutes,
    idleSyncIntervalMinutes: multiBidConfig.idleSyncIntervalMinutes,
    multiBidMinPrice: multiBidConfig.multiBidMinPrice,
    bidConcurrencyLimit: multiBidConfig.bidConcurrencyLimit,
    transactionStartHour: multiBidConfig.transactionStartHour,
    scanStartHour: multiBidConfig.scanStartHour,
    scanEndHour: multiBidConfig.scanEndHour,
    scanEveryIdleRuns: multiBidConfig.scanEveryIdleRuns
  });
});

module.exports = router;
module.exports.getStrategyLeadMs = getStrategyLeadMs;
module.exports.normalizeManualPinCode = normalizeManualPinCode;
module.exports.buildWindowsSendKeysScript = buildWindowsSendKeysScript;
module.exports.typeManualPinWithSystemKeyboard = typeManualPinWithSystemKeyboard;
module.exports.getMultiBidStartMs = getMultiBidStartMs;
module.exports.getMultiBidIntervalMs = getMultiBidIntervalMs;
module.exports.isMultiBidTask = isMultiBidTask;
module.exports.isTaskNeedingEndTimeRefresh = isTaskNeedingEndTimeRefresh;
module.exports.isTaskReadyForDispatch = isTaskReadyForDispatch;
module.exports.chooseNextPluginTask = chooseNextPluginTask;
module.exports.getMultiBidConfig = getMultiBidConfig;
module.exports.DEFAULT_MULTI_BID_MIN_PRICE = DEFAULT_MULTI_BID_MIN_PRICE;
module.exports.DEFAULT_PAYMENT_JOB_LIMIT = DEFAULT_PAYMENT_JOB_LIMIT;
module.exports.DEFAULT_PAYMENT_PAGE_STAY_SECONDS = DEFAULT_PAYMENT_PAGE_STAY_SECONDS;
module.exports.DEFAULT_CONFIRM_RECEIPT_HOUR = DEFAULT_CONFIRM_RECEIPT_HOUR;
module.exports.DEFAULT_CONFIRM_RECEIPT_COLOR = DEFAULT_CONFIRM_RECEIPT_COLOR;
module.exports.randomIntInclusive = randomIntInclusive;
module.exports.getPaymentJobLimitRange = getPaymentJobLimitRange;
module.exports.ORDER_STATUS_PENDING_PAYMENT = ORDER_STATUS_PENDING_PAYMENT;
module.exports.ORDER_STATUS_WAITING_SHIPPING = ORDER_STATUS_WAITING_SHIPPING;
module.exports.ORDER_STATUS_PENDING_BUNDLE = ORDER_STATUS_PENDING_BUNDLE;
module.exports.ORDER_STATUS_BUNDLE_COMPLETED = ORDER_STATUS_BUNDLE_COMPLETED;
module.exports.ORDER_STATUS_PENDING_SETTLEMENT = ORDER_STATUS_PENDING_SETTLEMENT;
module.exports.ORDER_STATUS_PENDING_SHIPMENT = ORDER_STATUS_PENDING_SHIPMENT;
module.exports.ORDER_STATUS_PENDING_RECEIPT = ORDER_STATUS_PENDING_RECEIPT;
module.exports.ORDER_STATUS_CANCELLED = ORDER_STATUS_CANCELLED;
module.exports.ORDER_STATUS_COMPLETED = ORDER_STATUS_COMPLETED;
module.exports.getNextIdleAction = getNextIdleAction;
module.exports.getNextScanIdleCounter = getNextScanIdleCounter;
module.exports.completeIdleAction = completeIdleAction;
module.exports.ensureScheduledTransactionStartRequest = ensureScheduledTransactionStartRequest;
module.exports.ensureScheduledConfirmReceiptRequest = ensureScheduledConfirmReceiptRequest;
module.exports.getTransactionStartReadyMs = getTransactionStartReadyMs;
module.exports.getTransactionStartSlot = getTransactionStartSlot;
module.exports.isTransactionStartReady = isTransactionStartReady;
module.exports.shouldAutoRequestTransactionStart = shouldAutoRequestTransactionStart;
module.exports.getConfirmReceiptReadyMs = getConfirmReceiptReadyMs;
module.exports.getConfirmReceiptSlot = getConfirmReceiptSlot;
module.exports.isConfirmReceiptReady = isConfirmReceiptReady;
module.exports.shouldAutoRequestConfirmReceipt = shouldAutoRequestConfirmReceipt;
module.exports.getTransactionStartJobs = getTransactionStartJobs;
module.exports.saveTransactionStartRunLog = saveTransactionStartRunLog;
module.exports.updateTransactionStartStatus = updateTransactionStartStatus;
module.exports.syncYahooWonOrders = syncYahooWonOrders;
module.exports.getScanJobs = getScanJobs;
module.exports.updateScanStatus = updateScanStatus;
module.exports.buildDaipaiSheetRow = buildDaipaiSheetRow;
module.exports.calculateSheetPayable = calculateSheetPayable;
module.exports.getOrdersForSheetAppend = getOrdersForSheetAppend;
module.exports.getOrderForSheetUpdate = getOrderForSheetUpdate;
module.exports.appendPendingReceiptOrderToGoogleSheet = appendPendingReceiptOrderToGoogleSheet;
module.exports.calculateOverdueShipmentDays = calculateOverdueShipmentDays;
module.exports.addPendingShipmentAlert = addPendingShipmentAlert;
module.exports.autoCloseShipmentAlerts = autoCloseShipmentAlerts;
module.exports.getShipmentAlerts = getShipmentAlerts;
module.exports.getPaymentJobs = getPaymentJobs;
module.exports.summarizePaymentError = summarizePaymentError;
module.exports.updatePaymentStatus = updatePaymentStatus;
module.exports.savePluginDiagnostic = savePluginDiagnostic;
module.exports.getPluginDiagnostics = getPluginDiagnostics;
module.exports.normalizeReceiptColorConfig = normalizeReceiptColorConfig;
module.exports.getConfirmReceiptJobs = getConfirmReceiptJobs;
module.exports.updateConfirmReceiptStatus = updateConfirmReceiptStatus;
module.exports.expireOverduePendingTasks = expireOverduePendingTasks;
module.exports.failPricedOutPendingTasks = failPricedOutPendingTasks;
module.exports.resetStaleProcessingTasks = resetStaleProcessingTasks;
module.exports.heartbeatProcessingTask = heartbeatProcessingTask;
module.exports.claimTaskForProcessing = claimTaskForProcessing;
module.exports.claimReadyPluginTasks = claimReadyPluginTasks;
module.exports.sweepPendingTasks = sweepPendingTasks;
module.exports.isYahooLoginError = isYahooLoginError;
module.exports.syncBiddingItems = syncBiddingItems;
module.exports.processPendingFollowupTasks = processPendingFollowupTasks;
module.exports.isFollowupTaskReady = isFollowupTaskReady;
module.exports.shouldSplitDirectBidByYahooLowPriceRule = shouldSplitDirectBidByYahooLowPriceRule;
module.exports.YAHOO_LOW_PRICE_THRESHOLD = YAHOO_LOW_PRICE_THRESHOLD;
module.exports.YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD = YAHOO_LOW_PRICE_FOLLOWUP_THRESHOLD;
module.exports.YAHOO_LOW_PRICE_BID_LIMIT = YAHOO_LOW_PRICE_BID_LIMIT;
module.exports.YAHOO_LOW_PRICE_INITIAL_BID = YAHOO_LOW_PRICE_INITIAL_BID;
module.exports.resolveOrderFinalPrice = resolveOrderFinalPrice;
module.exports.normalizeYahooWonTimeText = normalizeYahooWonTimeText;
