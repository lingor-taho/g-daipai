const API_BASES = ['http://127.0.0.1:3034', 'http://localhost:3034'];
const DEFAULT_POLL_INTERVAL_MS = 10000;
const POLL_ALARM_NAME = 'poll-pending-tasks';
const AUTO_BID_ENABLED = true;
const TRANSACTION_START_ENABLED = globalThis.__G_DAIPAI_TRANSACTION_START_ENABLED__ !== false;
const PAYMENT_FINALIZE_COMPLETE_TIMEOUT_MS = 60000;
const TASK_EXECUTION_TIMEOUT_MS = 30000;
const MULTI_BID_TASK_EXECUTION_TIMEOUT_MS = 180000;
const MULTI_BID_TASK_PROGRESS_EXTENSION_MS = 60000;
const MULTI_BID_TASK_MAX_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
const BID_PENDING_FINAL_RETRY_DELAY_MS = 10000;
const BID_PENDING_FINAL_FAST_RETRY_DELAY_MS = 1500;
const MANUAL_CAPTCHA_WAIT_TIMEOUT_MS = 10 * 60 * 1000;
const MESSAGE_JOB_TIMEOUT_MS = 30000;
const BIDDING_SYNC_MAX_PAGES = 50;
const PENDING_SHIPMENT_SCAN_RENDER_WAIT_MS = 8000;
const PENDING_SHIPMENT_SCAN_POLL_MS = 500;
const CONFIRM_RECEIPT_CANCEL_CHECK_RENDER_WAIT_MS = 8000;
const CONFIRM_RECEIPT_CANCEL_CHECK_POLL_MS = 500;
const MANUAL_CAPTCHA_FALLBACK_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED = true;

let fetchFailureCount = 0;
let pluginConfigFetchFailureCount = 0;
let pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
let pollIntervalTimerId = null;
let pollingStarted = false;
let idleSyncIntervalMs = 5 * 60 * 1000;
let bidConcurrencyLimit = 2;
let lastIdleSyncAt = 0;
let lastMonitorSyncAt = 0;
let lastWorkflowSyncAt = 0;
const activeBidRuns = new Map();
let monitorRunning = false;
let workflowRunning = false;
let manualVerificationFlowActive = false;
let manualVerificationTabId = null;
const ignoredManualVerificationTabIds = new Set();
const managedTaskTabs = new Set();
const managedTaskTabsByTaskId = new Map();
const activeBidProgressExtenders = new Map();

async function apiFetch(path, options) {
  let lastError;
  for (const base of API_BASES) {
    try {
      const res = await fetch(`${base}${path}`, options);
      fetchFailureCount = 0;
      return res;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('API request failed');
}

async function fetchPendingTask() {
  try {
    const res = await apiFetch('/api/plugin/task');
    const data = await res.json();
    return {
      task: data.task || null,
      canIdleSync: data.canIdleSync === true
    };
  } catch (e) {
    fetchFailureCount += 1;
    const log = fetchFailureCount === 1 || fetchFailureCount % 6 === 0 ? console.warn : console.debug;
    log('[Yahoo Bid] API unavailable, polling will retry:', e.message || e);
    return { task: null, canIdleSync: false };
  }
}

async function markTaskStatus(taskId, status, errorMsg = null, extra = {}) {
  try {
    const res = await apiFetch(`/api/plugin/task/${taskId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, error_msg: errorMsg, ...extra })
    });
    return await res.json().catch(() => ({ success: res.ok }));
  } catch (e) {
    console.error('[Yahoo Bid] Failed to update task status:', e);
    return null;
  }
}

async function touchTaskSchedule(taskId, status) {
  try {
    await apiFetch(`/api/plugin/task/${taskId}/touch`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
  } catch (e) {
    console.error('[Yahoo Bid] Failed to touch task schedule:', e);
  }
}

async function heartbeatProcessingTask(taskId) {
  if (!taskId) return null;
  try {
    const res = await apiFetch(`/api/plugin/task/${taskId}/heartbeat`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });
    return await res.json().catch(() => ({ success: res.ok }));
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to heartbeat processing task:', e);
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    function finish(fn, value) {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      fn(value);
    }

    const tid = setTimeout(() => {
      finish(reject, new Error('Product page load timeout'));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      finish(resolve);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId)
      .then(tab => {
        if (tab?.status === 'complete') finish(resolve);
      })
      .catch(error => finish(reject, error));
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildTaskTimeoutError(timeoutMs = TASK_EXECUTION_TIMEOUT_MS) {
  const error = new Error(`Task execution timeout after ${Math.round(timeoutMs / 1000)}s; task tab closed`);
  error.closeTab = true;
  return error;
}

function getTaskExecutionTimeoutMs(task = {}) {
  return task?.strategy === 'multi_bid' ? MULTI_BID_TASK_EXECUTION_TIMEOUT_MS : TASK_EXECUTION_TIMEOUT_MS;
}

function getTaskProgressExtensionMs(task = {}) {
  return task?.strategy === 'multi_bid' ? MULTI_BID_TASK_PROGRESS_EXTENSION_MS : 0;
}

function getTaskExecutionMaxTimeoutMs(task = {}) {
  return task?.strategy === 'multi_bid' ? MULTI_BID_TASK_MAX_EXECUTION_TIMEOUT_MS : getTaskExecutionTimeoutMs(task);
}

function buildBuyoutPendingFinalResult(task = {}, result = {}) {
  return {
    success: true,
    bidPrice: Number(task.max_price || task.user_max_price || 0) || undefined,
    pendingFinal: false,
    closeTab: true,
    stage: 'buyout-final-pending-waiting-for-won-sync',
    previousStage: result?.stage || ''
  };
}

function isBuyoutPurchaseCompleteSnapshot(snapshot = {}) {
  const url = String(snapshot.url || '').toLowerCase();
  const title = String(snapshot.title || '');
  const body = String(snapshot.bodyText || '');
  return /buy\.auctions\.yahoo\.co\.jp\/order\/thank-you\b/i.test(url) ||
    /\/order\/thank-you\b/i.test(url) ||
    /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f|\u8cfc\u5165\u624b\u7d9a\u304d\u306e\u5b8c\u4e86/.test(`${title} ${body}`);
}

async function recoverBuyoutCompletionAfterMessageDisconnect(tab, task, stage) {
  if (task?.bid_mode !== 'buyout' || !tab?.id) return null;
  const snapshot = await getTabPageDiagnosticSnapshot(tab.id).catch(() => null);
  if (!isBuyoutPurchaseCompleteSnapshot(snapshot)) return null;
  return buildBuyoutPendingFinalResult(task, {
    stage: stage || 'buyout-message-disconnected-after-completion'
  });
}

function isBuyoutFinalPending(task = {}, result = {}) {
  return task?.bid_mode === 'buyout' &&
    result?.success &&
    result?.pendingFinal &&
    /buyout-final/i.test(String(result?.stage || ''));
}

function isStoreBuyoutTask(task = {}) {
  return task?.bid_mode === 'buyout' &&
    String(task.product_type || task.productType || '') === 'store';
}

function isBuyoutStoreConfirmationRequired(task = {}, result = {}) {
  return isStoreBuyoutTask(task) &&
    result?.success &&
    result?.storeConfirmationRequired === true;
}

function getPendingFinalRetryDelayMs(task = {}, result = {}) {
  if (task?.bid_mode === 'buyout' || /buyout-final/i.test(String(result?.stage || ''))) {
    return BID_PENDING_FINAL_RETRY_DELAY_MS;
  }
  return BID_PENDING_FINAL_FAST_RETRY_DELAY_MS;
}

function withTimeout(promise, timeoutMs, errorFactory = () => buildTaskTimeoutError(timeoutMs)) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(errorFactory()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function withProgressTimeout(promise, timeoutMs, options = {}) {
  const startedAt = Date.now();
  const extensionMs = Math.max(0, Number(options.extensionMs || 0));
  const maxTimeoutMs = Math.max(timeoutMs, Number(options.maxTimeoutMs || timeoutMs));
  const errorFactory = options.errorFactory || (elapsedMs => buildTaskTimeoutError(elapsedMs));
  let timeoutId;
  let rejectTimeout;
  let deadlineAt = startedAt + timeoutMs;

  function schedule() {
    clearTimeout(timeoutId);
    const delay = Math.max(0, deadlineAt - Date.now());
    timeoutId = setTimeout(() => rejectTimeout(errorFactory(Date.now() - startedAt)), delay);
  }

  function extend() {
    if (!extensionMs) return deadlineAt - Date.now();
    deadlineAt = Math.min(deadlineAt + extensionMs, startedAt + maxTimeoutMs);
    schedule();
    return deadlineAt - Date.now();
  }

  const timeout = new Promise((_, reject) => {
    rejectTimeout = reject;
    schedule();
  });
  const unregister = typeof options.registerProgressHandler === 'function'
    ? options.registerProgressHandler(extend)
    : null;

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId);
    if (typeof unregister === 'function') unregister();
  });
}

function normalizeProgressTaskId(taskId) {
  return taskId == null ? '' : String(taskId);
}

function registerBidProgressExtender(taskId, extendFn) {
  const key = normalizeProgressTaskId(taskId);
  if (!key || typeof extendFn !== 'function') return () => {};
  activeBidProgressExtenders.set(key, extendFn);
  return () => {
    if (activeBidProgressExtenders.get(key) === extendFn) {
      activeBidProgressExtenders.delete(key);
    }
  };
}

function handleBidProgressMessage(msg = {}) {
  const key = normalizeProgressTaskId(msg.taskId);
  const extend = activeBidProgressExtenders.get(key);
  if (!extend) return false;
  extend(msg);
  return true;
}

function isMessageChannelClosed(error) {
  return /message channel closed|Receiving end does not exist|Could not establish connection|back\/forward cache|message channel is closed/i.test(error?.message || '');
}

function isNoTabWithIdError(error) {
  return /No tab with id/i.test(error?.message || String(error || ''));
}

function isContentScriptTargetGoneError(error) {
  const text = error?.message || String(error || '');
  return isNoTabWithIdError(error) || /Frame with ID \d+ was removed|The tab was closed/i.test(text);
}

function isTabsTemporarilyUneditableError(error) {
  return /Tabs cannot be edited right now|user may be dragging a tab/i.test(error?.message || String(error || ''));
}

function isTransientServerTabError(error) {
  return isContentScriptTargetGoneError(error) || isTabsTemporarilyUneditableError(error);
}

function buildServerTabError(error) {
  const message = error?.message || String(error || 'unknown tab error');
  return new Error(`Server tab error: ${message}`);
}

function isTransientFetchError(error) {
  const text = error?.message || String(error || '');
  return /Failed to fetch|NetworkError|Load failed|ERR_CONNECTION|ECONNREFUSED|ECONNRESET/i.test(text);
}

function logBackgroundIssue(label, error) {
  const logger = isTransientFetchError(error) ? console.warn : console.error;
  logger(label, error);
}

function isNoServiceWorkerLifecycleError(error) {
  const text = error?.message || String(error || '');
  return /^\s*No SW\s*$/i.test(text);
}

if (typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('unhandledrejection', event => {
    if (!isNoServiceWorkerLifecycleError(event?.reason)) return;
    event.preventDefault?.();
    console.debug('[Yahoo Bid] Ignored Chrome service worker lifecycle rejection:', event.reason?.message || event.reason);
  });
}

async function openTaskPage(task, options = {}) {
  const auctionId = normalizeAuctionId(task.product_url);
  if (!auctionId) throw new Error('Invalid product ID');

  const targetUrl = `https://auctions.yahoo.co.jp/jp/auction/${auctionId}`;
  await chrome.storage.session.set({
    currentTask: {
      taskId: task.id,
      maxPrice: task.max_price,
      userMaxPrice: task.user_max_price || task.max_price,
      currentPrice: task.current_price || 0,
      taxType: task.tax_type || 'tax_zero',
      multiBidIncrement: task.multi_bid_increment || 0,
      bidMode: task.bid_mode || 'bid',
      productType: task.product_type || task.productType || 'normal',
      strategy: task.strategy || 'direct',
      auctionId,
      executeBid: false
    }
  });

  const existingTabId = managedTaskTabsByTaskId.get(task.id);
  if (task.strategy === 'multi_bid' && existingTabId) {
    try {
      const existingTab = await chrome.tabs.get(existingTabId);
      if (existingTab?.id) {
        await chrome.tabs.update(existingTab.id, { active: true });
        return existingTab;
      }
    } catch (_) {
      managedTaskTabsByTaskId.delete(task.id);
      managedTaskTabs.delete(existingTabId);
    }
  }

  const tab = await chrome.tabs.create({ url: targetUrl, active: true });
  managedTaskTabs.add(tab.id);
  managedTaskTabsByTaskId.set(task.id, tab.id);
  if (typeof options.onTabCreated === 'function') {
    options.onTabCreated(tab);
  }

  try {
    if (tab.status !== 'complete') {
      await waitForTabComplete(tab.id);
    }
  } catch (e) {
    e.closeTab = true;
    throw e;
  }
  return tab;
}

async function executeTaskInTab(tab, task) {
  const auctionId = normalizeAuctionId(task.product_url);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  const result = await chrome.tabs.sendMessage(tab.id, {
    type: 'EXECUTE_BID',
    auctionId,
    maxPrice: task.max_price,
    userMaxPrice: task.user_max_price || task.max_price,
      currentPrice: task.current_price || 0,
      taxType: task.tax_type || 'tax_zero',
      multiBidIncrement: task.multi_bid_increment || 0,
      bidMode: task.bid_mode || 'bid',
      productType: task.product_type || task.productType || 'normal',
    strategy: task.strategy || 'direct'
  });

  if (!result?.success) {
    throw buildBidError(result, 'bid execution failed');
  }

  return result;
}

async function sendBidMessageV2(tabId, task) {
  const auctionId = normalizeAuctionId(task.product_url);
  return chrome.tabs.sendMessage(tabId, {
    type: 'EXECUTE_BID',
    taskId: task.id,
    auctionId,
    maxPrice: task.max_price,
    userMaxPrice: task.user_max_price || task.max_price,
      currentPrice: task.current_price || 0,
      taxType: task.tax_type || 'tax_zero',
      multiBidIncrement: task.multi_bid_increment || 0,
      bidMode: task.bid_mode || 'bid',
      productType: task.product_type || task.productType || 'normal',
    strategy: task.strategy || 'direct'
  });
}

async function injectContentScript(tabId, options = {}) {
  if (!tabId) {
    const error = new Error('No tab with id: ' + tabId);
    if (options.ignoreMissingTab) return false;
    throw error;
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
    return true;
  } catch (e) {
    if (isNoTabWithIdError(e)) {
      console.warn('[Yahoo Bid] Skip injecting content script because tab no longer exists:', tabId);
      if (options.ignoreMissingTab) return false;
      throw e;
    }
    if (isContentScriptTargetGoneError(e)) {
      console.warn('[Yahoo Bid] Skip injecting content script because content script target disappeared:', tabId, e.message || e);
      if (options.ignoreMissingTab) return false;
      throw e;
    }
    console.error('[Yahoo Bid] Failed to inject content script:', e);
    throw e;
  }
}

async function closeTaskTab(tabId) {
  if (!managedTaskTabs.has(tabId)) {
    return;
  }
  try {
    await chrome.tabs.remove(tabId);
    managedTaskTabs.delete(tabId);
    for (const [taskId, mappedTabId] of managedTaskTabsByTaskId.entries()) {
      if (mappedTabId === tabId) managedTaskTabsByTaskId.delete(taskId);
    }
  } catch (e) {
    console.warn('[Yahoo Bid] Failed to close task tab:', e);
  }
}

async function getTabPageDiagnosticSnapshot(tabId) {
  if (!tabId) return {};
  let tab = null;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (e) {
    return { tabId, error: e?.message || String(e || '') };
  }

  let page = {};
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        url: window.location.href || '',
        title: document.title || '',
        bodyText: (document.body?.innerText || document.body?.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1200)
      })
    });
    page = result?.[0]?.result || {};
  } catch (e) {
    page = { pageError: e?.message || String(e || '') };
  }

  return {
    tabId,
    windowId: tab?.windowId || '',
    tabStatus: tab?.status || '',
    tabActive: tab?.active === true,
    url: page.url || tab?.url || '',
    title: page.title || tab?.title || '',
    bodyText: page.bodyText || '',
    pageError: page.pageError || ''
  };
}

function formatDiagnosticParts(parts = {}) {
  return Object.entries(parts)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, ' ').trim().slice(0, 1200)}`)
    .join(',');
}

async function closeTabIfExists(tabId) {
  if (!tabId) return;
  try {
    await chrome.tabs.remove(tabId);
  } catch (e) {
    console.warn('[Yahoo Bid] Failed to close tab:', e);
  } finally {
    managedTaskTabs.delete(tabId);
    for (const [taskId, mappedTabId] of managedTaskTabsByTaskId.entries()) {
      if (mappedTabId === tabId) managedTaskTabsByTaskId.delete(taskId);
    }
  }
}

function parseTimeMs(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function getStrategyLeadMs(task) {
  if (!task?.strategy || task.strategy === 'direct') return 0;
  const minutesFromColumn = Number(task.start_minutes_before || 0);
  const secondsFromColumn = Number(task.start_seconds_before || 0);
  if (minutesFromColumn || secondsFromColumn) {
    return minutesFromColumn * 60 * 1000 + secondsFromColumn * 1000;
  }
  const match = String(task.strategy).match(/^(\d+)min$/);
  return match ? Number(match[1]) * 60 * 1000 : 0;
}

function isDirectTask(task) {
  return !task?.strategy || task.strategy === 'direct' || getStrategyLeadMs(task) <= 0;
}

function isInsideStrategyWindow(task, endTime) {
  if (isDirectTask(task)) return true;
  const endMs = parseTimeMs(endTime);
  if (!endMs) return false;
  const nowMs = Date.now();
  return endMs > nowMs && endMs - nowMs <= getStrategyLeadMs(task);
}

async function updateTaskSnapshot(taskId, snapshot, status) {
  await apiFetch(`/api/plugin/task/${taskId}/snapshot`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_title: snapshot?.title || null,
      product_image_url: snapshot?.imageUrl || null,
      current_price: snapshot?.currentPrice || null,
      buyout_price: snapshot?.buyoutPrice || null,
      tax_type: snapshot?.taxType || null,
      end_time: snapshot?.endTime || null,
      status
    })
  });
}

async function getPageProductSnapshot(tabId, task) {
  const auctionId = normalizeAuctionId(task.product_url);
  return chrome.tabs.sendMessage(tabId, {
    type: 'GET_PRODUCT_SNAPSHOT',
    auctionId
  });
}

async function ensureTaskReadyByCurrentEndTime(tab, task) {
  const snapshot = await getPageProductSnapshot(tab.id, task);
  if (!snapshot?.auctionId) {
    throw new Error('Unable to read product end time');
  }

  const actualEndTime = snapshot.endTime || task.end_time;
  const changedEndTime = actualEndTime && actualEndTime !== task.end_time;
  const actualEndMs = parseTimeMs(actualEndTime);
  if (actualEndMs && actualEndMs <= Date.now()) {
    await updateTaskSnapshot(task.id, { ...snapshot, endTime: actualEndTime }, 'failed');
    await closeTaskTab(tab.id);
    throw new Error('Auction ended according to product page snapshot');
  }

  if (isDirectTask(task)) {
    if (changedEndTime || snapshot.currentPrice) {
      await updateTaskSnapshot(task.id, { ...snapshot, endTime: actualEndTime }, 'processing');
    }
    return true;
  }

  if (!isInsideStrategyWindow(task, actualEndTime)) {
    await updateTaskSnapshot(task.id, { ...snapshot, endTime: actualEndTime }, 'pending');
    await closeTaskTab(tab.id);
    console.log('[Yahoo Bid] Task is not inside strategy window, end time refreshed:', task.id, actualEndTime, changedEndTime ? '(changed)' : '');
    return false;
  }

  if (changedEndTime || snapshot.currentPrice) {
    await updateTaskSnapshot(task.id, { ...snapshot, endTime: actualEndTime }, 'processing');
  }
  return true;
}

function shouldCloseTaskTab(result) {
  return Boolean(result?.closeTab || result?.outbid || result?.currentPrice);
}

function shouldKeepTaskTabOpen(task, result) {
  return task?.strategy === 'multi_bid' && result?.success && !result?.noBid && !result?.closeTab;
}

function buildBidError(result, fallbackMessage) {
  const error = new Error(result?.error || fallbackMessage);
  error.closeTab = shouldCloseTaskTab(result);
  error.bidResult = result || null;
  error.diagnostics = result?.diagnostics || '';
  error.url = result?.url || '';
  return error;
}

async function postBidFailureDiagnostic(task, error, context = {}) {
  const bidResult = error?.bidResult || {};
  const contextDiagnostics = context.diagnostics || '';
  const diagnostics = bidResult.diagnostics || error?.diagnostics || contextDiagnostics || '';
  if (!diagnostics && !bidResult.url && !error?.url && !context.url) return;
  const isBackgroundDiagnostic = Boolean(contextDiagnostics) && !bidResult.diagnostics && !error?.diagnostics;
  const isTimeoutDiagnostic = /timeout/i.test(error?.message || '') || context.timedOut;
  await postPluginDiagnostic({
    type: 'bid_failure',
    level: 'error',
    productId: normalizeAuctionId(task?.product_url || task?.product_id || ''),
    action: isTimeoutDiagnostic ? 'bid_timeout' : 'bid',
    method: isBackgroundDiagnostic ? 'background' : 'content-script',
    message: error?.message || bidResult.error || 'bid failed',
    diagnostics,
    url: bidResult.url || error?.url || context.url || task?.product_url || ''
  });
}

async function executeTaskInTabV2(tab, task) {
  await injectContentScript(tab.id);

  let result;
  try {
    result = await sendBidMessageV2(tab.id, task);
  } catch (e) {
    if (!isMessageChannelClosed(e)) {
      throw e;
    }
    const completed = await recoverBuyoutCompletionAfterMessageDisconnect(tab, task, 'buyout-message-disconnected-after-completion');
    if (completed) return completed;
    await sleep(3000);
    await injectContentScript(tab.id);
    result = await sendBidMessageV2(tab.id, task);
  }

  if (!result?.success) {
    throw buildBidError(result, 'bid execution failed');
  }

  for (let attempt = 0; attempt < 2 && isBuyoutStoreConfirmationRequired(task, result); attempt += 1) {
    const state = await getPaymentPageState(tab.id);
    if (!state?.hasStoreConfirmationSection) {
      throw buildBidError({
        ...result,
        success: false,
        error: 'buyout store confirmation section not detected by background'
      }, 'buyout store confirmation section not detected');
    }
    const storeResult = await completeStoreConfirmationItems(tab, state, task);
    if (!storeResult?.success) {
      throw buildBidError({
        ...result,
        success: false,
        error: storeResult?.error || 'buyout store confirmation flow failed'
      }, 'buyout store confirmation flow failed');
    }
    const nextTab = storeResult.tab || tab;
    await injectContentScript(nextTab.id);
    result = await sendBidMessageV2(nextTab.id, task);
    if (!result?.success) {
      throw buildBidError(result, 'bid execution failed after store confirmation');
    }
  }

  if (isBuyoutStoreConfirmationRequired(task, result)) {
    throw buildBidError({
      ...result,
      success: false,
      error: 'buyout store confirmation repeated'
    }, 'buyout store confirmation repeated');
  }

  if (result.pendingFinal) {
    if (isBuyoutFinalPending(task, result)) {
      return buildBuyoutPendingFinalResult(task, result);
    }
    let finalResult = result;
    for (let attempt = 0; attempt < 3 && finalResult?.pendingFinal; attempt += 1) {
      await sleep(getPendingFinalRetryDelayMs(task, finalResult));
      await injectContentScript(tab.id);
      try {
        finalResult = await sendBidMessageV2(tab.id, task);
      } catch (e) {
        if (!isMessageChannelClosed(e)) {
          throw e;
        }
        const completed = await recoverBuyoutCompletionAfterMessageDisconnect(tab, task, 'buyout-final-message-disconnected-after-completion');
        if (completed) return completed;
        await sleep(3000);
        await injectContentScript(tab.id);
        finalResult = await sendBidMessageV2(tab.id, task);
      }
      if (finalResult?.success && !finalResult.pendingFinal) return finalResult;
      if (!finalResult?.success) {
        throw buildBidError(finalResult, 'final bid confirmation failed');
      }
    }
    if (isBuyoutFinalPending(task, finalResult)) {
      return buildBuyoutPendingFinalResult(task, finalResult);
    }
    throw buildBidError(finalResult, 'final bid confirmation pending timeout');
  }

  return result;
}

function normalizeAuctionId(input) {
  const match = (input || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function extractMeta(html, pattern) {
  const match = html.match(pattern);
  return match ? match[1].trim() : '';
}

function extractProductFromHtml(html, auctionId, standardUrl) {
  const title = extractMeta(html, /<title>([^<]+)<\/title>/)
    .replace(/ - .*/, '')
    .trim();
  const imageUrl = extractMeta(html, /<meta[^>]*(?:property|name)="(?:og:image|twitter:image)"[^>]*content="([^"]+)"/);
  const priceText = extractMeta(html, /itemprop="price"[^>]*content="([^"]+)"/) ||
    extractMeta(html, /["']price["']\s*:\s*"?([\d,]+)/) ||
    extractMeta(html, /class="[^"]*price[^"]*"[^>]*>[\s\S]*?([\d,]+)\s*(?:\u5186|JPY)?/);
  const endTime = extractMeta(html, /itemprop="endDate"[^>]*content="([^"]+)"/) ||
    extractMeta(html, /endDate["\s][^"]{0,5}["']([^"']+)["']/);
  const postageText = extractMeta(html, /<div\b[^>]*id=["']itemPostage["'][^>]*>([\s\S]*?)<\/div>/i)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const shippingPrice = postageText.match(/([\d,]+)\s*円/);
  const shippingFeeText = /着払い/.test(postageText) ? '着払い'
    : /落札者負担/.test(postageText) ? '落札者負担'
      : /無料/.test(postageText) ? '無料'
        : shippingPrice ? `${shippingPrice[1].replace(/,/g, '')}円` : '';

  return {
    auctionId,
    url: standardUrl,
    title: title || ('Product ' + auctionId),
    imageUrl: imageUrl || '',
    currentPrice: priceText ? parseInt(priceText.replace(/,/g, ''), 10) || 0 : 0,
    shippingFeeText,
    endTime: endTime || ''
  };
}

async function fetchProductInfo(url) {
  const auctionId = normalizeAuctionId(url);
  if (!auctionId) throw new Error('invalid product url');
  const standardUrl = `https://auctions.yahoo.co.jp/jp/auction/${auctionId}`;

  const res = await fetch(standardUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,*/*',
      'Accept-Language': 'ja-JP,ja;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
  const html = await res.text();
  return extractProductFromHtml(html, auctionId, standardUrl);
}

async function syncOrderHistory(orders) {
  if (!Array.isArray(orders)) return null;
  try {
    const res = await apiFetch('/api/plugin/orders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    });
    return await res.json().catch(() => null);
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to sync order history:', e);
    return null;
  }
}

async function syncBiddingItems(items) {
  if (!Array.isArray(items)) return;
  try {
    await apiFetch('/api/plugin/bidding/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to sync bidding items:', e);
  }
}

async function fetchNextIdleAction() {
  try {
    const res = await apiFetch('/api/plugin/idle-action/next');
    return await res.json();
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to fetch idle action:', e);
    return { action: 'none' };
  }
}

async function completeIdleAction(action) {
  try {
    await apiFetch('/api/plugin/idle-action/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action || 'none' })
    });
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to complete idle action:', e);
  }
}

async function fetchTransactionStartJobs(options = {}) {
  const params = new URLSearchParams();
  if (options.includeAfterCutoff) params.set('includeAfterCutoff', '1');
  const query = params.toString();
  const res = await apiFetch(`/api/plugin/transaction-start/jobs${query ? `?${query}` : ''}`);
  const data = await res.json();
  return Array.isArray(data.jobs) ? data.jobs : [];
}

async function updateTransactionStartStatus(payload) {
  await apiFetch('/api/plugin/transaction-start/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function fetchScanJobs() {
  const res = await apiFetch('/api/plugin/scan/jobs');
  const data = await res.json();
  return Array.isArray(data.jobs) ? data.jobs : [];
}

async function updateScanStatus(payload) {
  await apiFetch('/api/plugin/scan/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function postScanDiagnostic(job, result, message, level = 'warn') {
  const diagnostics = [
    `orderStatus=${job?.orderStatus || ''}`,
    `bundleGroupId=${job?.bundleGroupId || ''}`,
    `resultType=${result?.type || ''}`,
    `transactionUrl=${job?.transactionUrl || ''}`
  ].join(',');
  await postPluginDiagnostic({
    type: 'scan',
    level,
    productId: job?.productId || '',
    orderId: job?.orderId || 0,
    action: job?.orderStatus === 'pending_bundle' ? 'bundle_scan' : 'scan',
    method: 'content-script',
    message,
    diagnostics,
    url: job?.transactionUrl || ''
  });
}

async function postTransactionStartDiagnostic(job, tab, message, level = 'error', extra = {}) {
  const currentTab = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  const state = tab?.id ? await getBundleActionState(tab.id).catch(() => null) : null;
  const diagnostics = [
    `orderId=${job?.orderId || 0}`,
    `productId=${job?.productId || ''}`,
    `shippingFeeText=${job?.shippingFeeText || ''}`,
    `transactionUrl=${job?.transactionUrl || ''}`,
    `tabId=${tab?.id || ''}`,
    `tabStatus=${currentTab?.status || ''}`,
    `url=${currentTab?.url || tab?.url || ''}`,
    `state=${state ? JSON.stringify(state).slice(0, 1200) : ''}`,
    ...Object.entries(extra || {}).map(([key, value]) => `${key}=${String(value || '').slice(0, 500)}`)
  ].join(',');
  await postPluginDiagnostic({
    type: 'transaction_start',
    level,
    productId: job?.productId || '',
    orderId: job?.orderId || 0,
    action: 'bundle_start',
    method: 'background',
    message,
    diagnostics,
    url: currentTab?.url || tab?.url || job?.transactionUrl || ''
  });
}

async function fetchManualOrderImportJob() {
  const res = await apiFetch('/api/plugin/manual-order-import/jobs');
  const data = await res.json();
  return data?.job || null;
}

async function updateManualOrderImportStatus(payload) {
  await apiFetch('/api/plugin/manual-order-import/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function fetchPaymentJobs() {
  const res = await apiFetch('/api/plugin/payment/jobs');
  const data = await res.json();
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    paymentPageStaySeconds: Number(data.paymentPageStaySeconds ?? 3)
  };
}

async function updatePaymentStatus(payload) {
  await apiFetch('/api/plugin/payment/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function fetchYahooMessageJobs() {
  const res = await apiFetch('/api/plugin/yahoo-messages/jobs');
  const data = await res.json();
  return Array.isArray(data.jobs) ? data.jobs : [];
}

async function updateYahooMessageStatus(payload) {
  await apiFetch('/api/plugin/yahoo-messages/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  });
}

function getYahooTradeMessageExtractScript() {
  return `(() => {
    const normal = document.querySelector('#messagelist');
    if (normal) return { success: true, messageHtml: normal.outerHTML, pageType: 'normal' };
    const store = document.querySelector('ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]');
    if (store) return { success: true, messageHtml: store.outerHTML, pageType: 'store' };
    const fallback = [...document.querySelectorAll('ul, .acMdMsgForm, [id*="message"], [class*="Msg"]')]
      .find(node => /送信|あなた|ストア|メッセージ|取引/.test((node.innerText || node.textContent || '').trim()));
    if (fallback) return { success: true, messageHtml: fallback.outerHTML, pageType: 'fallback' };
    return { success: false, error: 'message list not found' };
  })()`;
}

function getYahooTradeMessageSendScript(messageText) {
  const encoded = JSON.stringify(String(messageText || ''));
  return `(() => {
    const messageText = ${encoded};
    const textarea = document.querySelector('#textarea') ||
      document.querySelector('textarea[placeholder*="メッセージ"]') ||
      document.querySelector('textarea');
    if (!textarea) return { success: false, error: 'message textarea not found' };
    textarea.focus();
    textarea.value = messageText;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: messageText }));
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    const button = document.querySelector('#submitButton') ||
      document.querySelector('#msg button[type="submit"], #msg button') ||
      [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
        .find(node => /送信/.test(String(node.value || node.innerText || node.textContent || '').trim()));
    if (!button) return { success: false, error: 'message submit button not found' };
    if (button.disabled) return { success: false, error: 'message submit button disabled' };
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    button.click();
    return { success: true };
  })()`;
}

async function extractYahooTradeMessages(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normal = document.querySelector('#messagelist');
      if (normal) return { success: true, messageHtml: normal.outerHTML, pageType: 'normal' };
      const store = document.querySelector('ul.sc-c46fd2ce-0, ul[class*="sc-c46fd2ce-0"]');
      if (store) return { success: true, messageHtml: store.outerHTML, pageType: 'store' };
      const fallback = [...document.querySelectorAll('ul, .acMdMsgForm, [id*="message"], [class*="Msg"]')]
        .find(node => /送信|あなた|ストア|メッセージ|取引/.test((node.innerText || node.textContent || '').trim()));
      if (fallback) return { success: true, messageHtml: fallback.outerHTML, pageType: 'fallback' };
      return { success: false, error: 'message list not found' };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'message extraction returned no result' };
}

async function sendYahooTradeMessage(tabId, messageText) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [String(messageText || '')],
    func: messageText => {
      const textarea = document.querySelector('#textarea') ||
        document.querySelector('textarea[placeholder*="メッセージ"]') ||
        document.querySelector('textarea');
      if (!textarea) return { success: false, error: 'message textarea not found' };
      textarea.focus();
      textarea.value = messageText;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: messageText }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      const button = document.querySelector('#submitButton') ||
        document.querySelector('#msg button[type="submit"], #msg button') ||
        [...document.querySelectorAll('button, input[type="submit"], input[type="button"]')]
          .find(node => /送信/.test(String(node.value || node.innerText || node.textContent || '').trim()));
      if (!button) return { success: false, error: 'message submit button not found' };
      if (button.disabled) return { success: false, error: 'message submit button disabled' };
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      button.click();
      return { success: true };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'message send returned no result' };
}

function extractAuctionIdFromText(value) {
  const match = String(value || '').match(/[a-zA-Z]?\d{8,10}/);
  return match ? match[0].toLowerCase() : '';
}

function getDiagnosticValue(diagnostics, key) {
  const pattern = new RegExp(`(?:^|,)${key}=([^,]*)`);
  const match = String(diagnostics || '').match(pattern);
  return match ? match[1] : '';
}

async function postPluginDiagnostic(payload = {}) {
  const diagnostics = String(payload.diagnostics || '');
  const url = String(payload.url || getDiagnosticValue(diagnostics, 'url') || '');
  const productId = String(payload.productId || payload.product_id || extractAuctionIdFromText(`${url} ${diagnostics}`) || '').toLowerCase();
  try {
    await apiFetch('/api/plugin/diagnostics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        productId,
        url,
        action: payload.action || getDiagnosticValue(diagnostics, 'action') || '',
        method: payload.method || getDiagnosticValue(diagnostics, 'method') || ''
      })
    });
  } catch (e) {
    console.warn('[Yahoo Bid] Failed to post plugin diagnostic:', e?.message || e);
  }
}

async function fetchConfirmReceiptJobs() {
  const res = await apiFetch('/api/plugin/confirm-receipt/jobs');
  const data = await res.json();
  return Array.isArray(data.jobs) ? data.jobs : [];
}

async function updateConfirmReceiptStatus(payload) {
  await apiFetch('/api/plugin/confirm-receipt/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function postManualCaptchaChallenge(payload) {
  await apiFetch('/api/plugin/manual-captcha/challenge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function fetchManualCaptchaAnswer(id) {
  const res = await apiFetch(`/api/plugin/manual-captcha/answer/${encodeURIComponent(id)}`);
  return await res.json();
}

async function fetchCurrentManualCaptchaChallenge() {
  const res = await apiFetch('/api/plugin/manual-captcha/current');
  return await res.json();
}

async function closeManualCaptchaChallenge(id) {
  await apiFetch('/api/plugin/manual-captcha/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }).catch(() => null);
}

async function typeManualPinWithSystemKeyboard(answer, context = {}) {
  const pin = String(answer || '').replace(/\D/g, '');
  if (!pin) return { success: false, error: 'pin digits are required' };
  try {
    const res = await apiFetch('/api/plugin/manual-pin/type', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pin,
        windowTitle: String(context.windowTitle || context.title || '').slice(0, 200)
      })
    });
    const result = await res.json().catch(() => ({ success: res.ok }));
    return result?.success
      ? {
          success: true,
          method: 'systemSendKeys',
          digits: result.digits || pin.length,
          diagnostics: [
            `method=systemSendKeys`,
            result.windowTitle ? `windowTitle=${String(result.windowTitle).slice(0, 120)}` : '',
            result.stdout ? `stdout=${String(result.stdout).slice(0, 240)}` : ''
          ].filter(Boolean).join(',')
        }
      : {
          success: false,
          error: result?.error || 'system keyboard PIN input failed',
          diagnostics: result?.stdout ? `method=systemSendKeys,stdout=${String(result.stdout).slice(0, 240)}` : 'method=systemSendKeys'
        };
  } catch (e) {
    return { success: false, error: e.message || 'system keyboard PIN input failed' };
  }
}

function formatPaymentStateDiagnostics(state = {}) {
  const parts = [];
  if (state.url) parts.push(`url=${String(state.url).slice(0, 240)}`);
  if (state.title) parts.push(`title=${String(state.title).slice(0, 160)}`);
  if (Array.isArray(state.controlsSample) && state.controlsSample.length) {
    const controls = state.controlsSample
      .map(value => String(value || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20)
      .join(' | ')
      .slice(0, 500);
    if (controls) parts.push(`controls=${controls}`);
  }
  return parts.join('; ');
}

function buildPaymentFailurePayload(job, error) {
  const state = error?.gDaipaiPaymentState || error?.paymentState || null;
  const diagnostics = [
    error?.diagnostics || '',
    state ? formatPaymentStateDiagnostics(state) : ''
  ].filter(Boolean).join('; ');
  return {
    orderId: job?.orderId,
    productId: job?.productId,
    error: error?.message || String(error || 'payment failed'),
    diagnostics: diagnostics || undefined,
    url: state?.url || undefined
  };
}

function formatTrustedInputDiagnostics(value = {}) {
  const parts = [];
  if (value.method) parts.push(`method=${value.method}`);
  if (value.action) parts.push(`action=${value.action}`);
  if (value.tabId) parts.push(`tabId=${value.tabId}`);
  if (value.windowId) parts.push(`windowId=${value.windowId}`);
  if (value.tabStatus) parts.push(`tabStatus=${value.tabStatus}`);
  if (value.tabActive !== undefined) parts.push(`tabActive=${value.tabActive}`);
  if (value.windowFocused !== undefined) parts.push(`windowFocused=${value.windowFocused}`);
  if (value.windowState) parts.push(`windowState=${value.windowState}`);
  if (value.title) parts.push(`title=${String(value.title).slice(0, 120)}`);
  if (value.url) parts.push(`url=${String(value.url).slice(0, 240)}`);
  if (value.text) parts.push(`text=${String(value.text).slice(0, 120)}`);
  if (value.point) parts.push(`point=${value.point}`);
  return parts.join(',');
}

async function getTrustedInputDiagnostics(tabId, action, method, point = null) {
  const tab = tabId ? await chrome.tabs.get(tabId).catch(() => null) : null;
  const windowInfo = tab?.windowId && chrome.windows?.get
    ? await chrome.windows.get(tab.windowId).catch(() => null)
    : null;
  const pointText = point?.rect
    ? `${Math.round(point.x || 0)}x${Math.round(point.y || 0)}@${Math.round(point.rect.width || 0)}x${Math.round(point.rect.height || 0)}`
    : (point?.x !== undefined ? `${Math.round(point.x)}x${Math.round(point.y || 0)}` : '');
  return formatTrustedInputDiagnostics({
    method,
    action,
    tabId: tab?.id || tabId,
    windowId: tab?.windowId || '',
    tabStatus: tab?.status || '',
    tabActive: tab?.active,
    windowFocused: windowInfo?.focused,
    windowState: windowInfo?.state || '',
    title: tab?.title || '',
    url: tab?.url || '',
    text: point?.text || '',
    point: pointText
  });
}

function buildConfirmReceiptFailurePayload(job, error) {
  return {
    orderId: job?.orderId,
    productId: job?.productId,
    error: error?.message || String(error || 'confirm receipt failed')
  };
}

function parseYenAmount(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (!text || /\u7121\u6599|\u7740\u6255\u3044|\u51fa\u54c1\u8005\u8ca0\u62c5/.test(text)) return 0;
  const match = text.match(/([\d,]+)\s*\u5186/);
  if (!match) return null;
  return Number(match[1].replace(/,/g, '')) || 0;
}

function getRandomSource() {
  return typeof globalThis.__G_DAIPAI_RANDOM__ === 'function'
    ? globalThis.__G_DAIPAI_RANDOM__
    : Math.random;
}

function getRandomIntInclusive(min, max, randomFn = getRandomSource()) {
  const low = Math.ceil(Number(min));
  const high = Math.floor(Number(max));
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  if (high <= low) return low;
  const raw = Number(randomFn());
  const randomValue = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : Math.random();
  return low + Math.floor(randomValue * (high - low + 1));
}

function getExpectedPaymentAmountJpy(job = {}) {
  const finalPrice = getPaymentJobFinalPriceJpy(job);
  const shippingText = job.effectiveShippingFeeText || job.shippingFeeText || '';
  const shipping = parseYenAmount(shippingText);
  if (finalPrice === null || shipping === null) return null;
  return finalPrice + shipping;
}

async function fetchPendingTasks(limit = 1) {
  try {
    const safeLimit = Math.max(1, Math.min(10, Math.floor(Number(limit || 1))));
    const res = await apiFetch(`/api/plugin/tasks?limit=${safeLimit}`);
    const data = await res.json();
    if (Number(data?.bidConcurrencyLimit || 0) > 0) {
      bidConcurrencyLimit = Math.max(1, Math.min(10, Math.floor(Number(data.bidConcurrencyLimit))));
    }
    return Array.isArray(data.tasks) ? data.tasks : [];
  } catch (e) {
    fetchFailureCount += 1;
    const log = fetchFailureCount === 1 || fetchFailureCount % 6 === 0 ? console.warn : console.debug;
    log('[Yahoo Bid] API unavailable, bid task polling will retry:', e.message || e);
    return [];
  }
}

function getPaymentJobFinalPriceJpy(job = {}) {
  const finalPrice = Number(job.paymentFinalPrice ?? job.payment_final_price ?? job.finalPrice ?? job.final_price ?? 0);
  return Number.isFinite(finalPrice) && finalPrice > 0 ? finalPrice : null;
}

function canTreatUnknownPaymentShippingAsZero(job = {}) {
  const shippingText = String(job.effectiveShippingFeeText || job.shippingFeeText || '');
  return String(job.productType || job.product_type || '') === 'store' && /\u843d\u672d\u8005\u8ca0\u62c5/.test(shippingText);
}

function isStorePaymentJob(job = {}) {
  return String(job.productType || job.product_type || '') === 'store';
}

function isStorePaymentReviewPage(state = {}) {
  return /:\/\/buy\.auctions\.yahoo\.co\.jp\/order\/review\b/.test(String(state?.url || ''));
}

function isStorePaymentStatusPage(job = {}, state = {}) {
  return isStorePaymentJob(job) && /:\/\/buy\.auctions\.yahoo\.co\.jp\/order\/status\b/.test(String(state?.url || ''));
}

function isPaymentEntryOrTerminalState(state = {}) {
  return Boolean(
    state?.cancelled ||
    state?.alreadyPaid ||
    state?.complete ||
    state?.hasReviewButton ||
    state?.hasSinglePurchaseProcedureButton ||
    state?.hasPurchaseProcedureButton ||
    state?.hasEasyPaymentButton ||
    state?.hasTransactionInfoInputButton ||
    (state?.hasStoreBundlePurchaseNotice && state?.hasPaymentCloseButton)
  );
}

function getExpectedPaymentShippingFeeJpy(job = {}) {
  return parseYenAmount(job.effectiveShippingFeeText || job.shippingFeeText || '');
}

function getPaymentActionPatternSource(action) {
  const patterns = {
    easyPayment: '\\u0059\\u0061\\u0068\\u006f\\u006f\\u0021\\u304b\\u3093\\u305f\\u3093\\u6c7a\\u6e08\\u3067\\u652f\\u6255\\u3046',
    paymentClose: '^\\s*\\u9589\\u3058\\u308b\\s*$',
    singlePurchaseProcedure: '\\u5358\\u54c1\\u3067\\u8cfc\\u5165\\u624b\\u7d9a\\u304d\\u3059\\u308b',
    purchaseProcedure: '\\u8cfc\\u5165\\u624b\\u7d9a\\u304d\\u3059\\u308b',
    transactionInfoInput: '\\u53d6\\u5f15\\u60c5\\u5831\\u3092\\u5165\\u529b\\u3059\\u308b',
    placementOk: '^\\s*OK\\s*$',
    transactionDecide: '^\\s*\\u6c7a\\u5b9a\\u3059\\u308b\\s*$',
    transactionConfirm: '^\\s*\\u78ba\\u5b9a\\u3059\\u308b\\s*$',
    review: '^\\s*\\u78ba\\u8a8d\\u3059\\u308b\\s*$',
    finalize: '\\u8cfc\\u5165\\u3092\\u78ba\\u5b9a\\u3059\\u308b'
  };
  return patterns[action] || '';
}

function parsePaymentAmountJpyFromText(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const toAmount = value => Number(String(value || '').replace(/,/g, '')) || 0;
  const exactTotalPatterns = [
    /\u304a\u652f\u6255\u3044\u91d1\u984d\s*[（(]\s*\u5408\u8a08\s*[）)][^\d]{0,20}([\d,]+)\s*\u5186/g,
    /\u652f\u6255\u3044\u91d1\u984d\s*[（(]\s*\u5408\u8a08\s*[）)][^\d]{0,20}([\d,]+)\s*\u5186/g,
    /\u304a\u652f\u6255\u3044\u91d1\u984d\s*\u5408\u8a08[^\d]{0,20}([\d,]+)\s*\u5186/g,
    /\u652f\u6255\u3044\u91d1\u984d\s*\u5408\u8a08[^\d]{0,20}([\d,]+)\s*\u5186/g
  ];
  for (const pattern of exactTotalPatterns) {
    const matches = [...normalized.matchAll(pattern)].map(match => toAmount(match[1])).filter(amount => amount > 0);
    if (matches.length) return matches[matches.length - 1];
  }

  const paymentAmountMatches = [...normalized.matchAll(/\u304a\u652f\u6255\u3044\u91d1\u984d[^\d]{0,30}([\d,]+)\s*\u5186/g)]
    .filter(match => !/\u5168\u984d\u8fd4\u91d1/.test(normalized.slice(Math.max(0, match.index || 0), (match.index || 0) + 80)))
    .map(match => toAmount(match[1]))
    .filter(amount => amount > 0);
  if (paymentAmountMatches.length) return paymentAmountMatches[paymentAmountMatches.length - 1];

  const yenMatches = [...normalized.matchAll(/([\d,]+)\s*\u5186/g)]
    .map(match => toAmount(match[1]))
    .filter(amount => amount > 0);
  return yenMatches.length ? Math.max(...yenMatches) : 0;
}

function buildPaymentPageStateFromSnapshot(snapshot = {}) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const bodyText = normalize(snapshot.bodyText || '');
  const transactionStatusText = normalize(snapshot.transactionStatusText || snapshot.primaryStatusText || '');
  const lifecycleText = transactionStatusText || bodyText;
  const controls = Array.isArray(snapshot.controls) ? snapshot.controls.map(normalize).filter(Boolean) : [];
  const hasControl = pattern => controls.some(text => pattern.test(text));
  const paymentAmountJpy = parsePaymentAmountJpyFromText(bodyText);
  const paymentMethodFeeMatch = bodyText.match(/\u624b\u6570\u6599[^\d]{0,20}([\d,]+)\s*\u5186/);
  const paymentMethodFeeJpy = paymentMethodFeeMatch ? Number(paymentMethodFeeMatch[1].replace(/,/g, '')) || 0 : 0;
  const shippingOptions = Array.isArray(snapshot.shippingOptions)
    ? snapshot.shippingOptions
      .map(option => ({
        amountJpy: Number(option?.amountJpy || 0),
        checked: !!option?.checked,
        disabled: !!option?.disabled,
        text: normalize(option?.text || '')
      }))
      .filter(option => option.amountJpy > 0)
    : [];
  const selectedShippingOption = shippingOptions.find(option => option.checked);
  const waitingShipmentText = /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(lifecycleText);
  const hasPlacementDefaultModal = /\u7f6e\u304d\u914d\u5834\u6240[\s\S]{0,40}\u521d\u671f\u8a2d\u5b9a\u3055\u308c\u307e\u3057\u305f/.test(bodyText);
  const hasStoreBundlePurchaseNotice = /\u307e\u3068\u3081\u3066\u8cfc\u5165\u624b\u7d9a\u304d\u3067\u304d\u308b\u5546\u54c1/.test(bodyText);
  const hasStoreConfirmationSection = PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED && (
    Boolean(snapshot.hasStoreConfirmationSection)
  );
  const hasStoreConfirmationEditPage = Boolean(snapshot.hasStoreConfirmationEditPage) ||
    (hasStoreConfirmationSection && hasControl(/^\s*\u5909\u66f4\u3059\u308b\s*$/));
  const hasAppraisalSection = Boolean(snapshot.hasAppraisalSection) ||
    (/\u9451\u5b9a/.test(bodyText) && (/\u9451\u5b9a\u3057\u306a\u3044/.test(bodyText) || controls.some(text => /\u9451\u5b9a\u3057\u306a\u3044/.test(text))));
  const alreadyPaid = (/\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(lifecycleText) && waitingShipmentText)
    || (/\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(lifecycleText) && waitingShipmentText);
  const cancelled = isYahooTransactionCancelledText(lifecycleText);
  return {
    url: snapshot.url || '',
    title: snapshot.title || '',
    transactionStatusText,
    textSample: bodyText.slice(0, 500),
    controlsSample: controls.slice(0, 20),
    paymentAmountJpy,
    paymentMethodFeeJpy,
    hasStoreConfirmationSection,
    hasStoreConfirmationEditPage,
    hasAppraisalSection,
    hasNoAppraisalSelected: Boolean(snapshot.hasNoAppraisalSelected),
    shippingOptions,
    selectedShippingAmountJpy: selectedShippingOption ? selectedShippingOption.amountJpy : null,
    alreadyPaid,
    cancelled,
    complete: /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(lifecycleText),
    processing: /\u305f\u3060\u3044\u307e\u6c7a\u6e08\u51e6\u7406\u4e2d\u3067\u3059/.test(lifecycleText),
    hasEasyPaymentButton: hasControl(/Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046/),
    hasPaymentCloseButton: hasControl(/^\s*\u9589\u3058\u308b\s*$/),
    hasStoreBundlePurchaseNotice,
    hasSinglePurchaseProcedureButton: hasControl(/\u5358\u54c1\u3067\u8cfc\u5165\u624b\u7d9a\u304d\u3059\u308b/),
    hasPurchaseProcedureButton: hasControl(/\u8cfc\u5165\u624b\u7d9a\u304d\u3059\u308b/),
    hasTransactionInfoInputButton: hasControl(/\u53d6\u5f15\u60c5\u5831\u3092\u5165\u529b\u3059\u308b/),
    hasPlacementOkButton: hasPlacementDefaultModal && hasControl(/^\s*OK\s*$/),
    hasTransactionDecideButton: hasControl(/^\s*\u6c7a\u5b9a\u3059\u308b\s*$/),
    hasTransactionConfirmButton: hasControl(/^\s*\u78ba\u5b9a\u3059\u308b\s*$/),
    hasReviewButton: hasControl(/^\s*\u78ba\u8a8d\u3059\u308b\s*$/),
    hasFinalizeButton: hasControl(/\u8cfc\u5165\u3092\u78ba\u5b9a\u3059\u308b/)
  };
}

async function getPaymentPageState(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const bodyText = normalize(document.body?.innerText || document.body?.textContent || '');
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
        .map(el => getText(el))
        .filter(Boolean);
      const isLifecycleStatusText = text => (
        /\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(text) ||
        /\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044/.test(text) ||
        /\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(text) ||
        /\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(text) ||
        /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(text) ||
        /\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f/.test(text) ||
        /\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f/.test(text) ||
        /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(text) ||
        /\u305f\u3060\u3044\u307e\u6c7a\u6e08\u51e6\u7406\u4e2d\u3067\u3059/.test(text) ||
        /\u843d\u672d\u8005\u524a\u9664/.test(text) ||
        /\u53d6\u5f15\u304c\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(text) ||
        /\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(text)
      );
      const extractPrimaryTransactionStatusText = () => {
        const normalStatus = [...document.querySelectorAll('.acMdStatusCmt .elAdvnc p.fntB')]
          .map(el => getText(el))
          .filter(Boolean);
        if (normalStatus.length) return normalize(normalStatus.join('\n'));

        const storeStatus = [...document.querySelectorAll('main header p.sc-5968173-0 span, main header p.sc-5968173-0')]
          .map(el => getText(el))
          .find(text => text && isLifecycleStatusText(text));
        if (storeStatus) return storeStatus;

        const purchaseAction = document.querySelector('#pap');
        let node = purchaseAction?.previousElementSibling || null;
        let depth = 0;
        while (node && depth < 8) {
          const text = getText(node);
          if (text && text.length < 240 && isLifecycleStatusText(text)) return text;
          node = node.previousElementSibling;
          depth += 1;
        }
        return '';
      };
      const transactionStatusText = extractPrimaryTransactionStatusText();
      const parseAmount = text => {
        const match = String(text || '').match(/([\d,]+)\s*\u5186/);
        return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
      };
      const isVisibleElement = el => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!(rect && rect.width > 0 && rect.height > 0);
      };
      const isVisibleRadioOption = radio => {
        if (!radio) return false;
        let node = radio;
        while (node && node !== document.body) {
          const style = window.getComputedStyle?.(node);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
          node = node.parentElement;
        }
        const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
        const container = radio.closest('label, li, tr, dd, div');
        return isVisibleElement(radio) || isVisibleElement(label) || isVisibleElement(container);
      };
      const optionTextFromRadio = radio => {
        const parts = [];
        const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
        if (label) parts.push(getText(label));
        let node = radio.closest('label, li, tr, dd, div');
        let depth = 0;
        while (node && node !== document.body && depth < 5) {
          const text = getText(node);
          if (text) parts.push(text);
          node = node.parentElement;
          depth += 1;
        }
        return normalize(parts.join(' '));
      };
      const shippingHeader = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')]
        .find(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el)) || getText(el).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      const shippingKeywords = /\u914d\u9001|\u9001\u6599|\u304a\u3066\u304c\u308b|\u3086\u3046|\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8|\u30ec\u30bf\u30fc\u30d1\u30c3\u30af|\u5b9a\u5f62|\u5b85\u6025\u4fbf/;
      const paymentKeywords = /\u30af\u30ec\u30b8\u30c3\u30c8|\u30b3\u30f3\u30d3\u30cb|PayPay|\u9280\u884c\u632f\u8fbc|\u652f\u6255|\u624b\u6570\u6599/;
      const shippingOptions = [...document.querySelectorAll('input[type="radio"]')]
        .map((radio, index) => {
          const text = optionTextFromRadio(radio);
          const radioName = String(radio.name || radio.getAttribute?.('name') || '');
          const radioValue = String(radio.value || radio.getAttribute?.('value') || '');
          const isKnownShippingRadio = radioName === 'shipMethodPullDown' || /^postage\d*/i.test(radioValue);
          const afterShippingHeader = shippingHeader
            ? isKnownShippingRadio || shippingHeader.contains?.(radio) || !!(shippingHeader.compareDocumentPosition(radio) & Node.DOCUMENT_POSITION_FOLLOWING)
            : shippingKeywords.test(text);
          const looksLikePaymentMethod = paymentKeywords.test(text) && !shippingKeywords.test(text);
          return {
            index,
            amountJpy: parseAmount(text),
            checked: !!radio.checked,
            disabled: !!radio.disabled,
            text,
            visible: isVisibleRadioOption(radio),
            isKnownShippingRadio,
            isShipping: afterShippingHeader && !looksLikePaymentMethod
          };
        })
        .filter(option => option.isShipping && (option.visible || option.isKnownShippingRadio) && option.amountJpy > 0)
        .map(({ amountJpy, checked, disabled, text, visible }) => ({ amountJpy, checked, disabled, visible, text: text.slice(0, 200) }));
      const appraisalSections = [
        document.querySelector('#appraisal'),
        ...document.querySelectorAll('section')
      ].filter(Boolean);
      const appraisalSection = appraisalSections.find(section => {
        if (section.id === 'appraisal') return true;
        const heading = section.querySelector?.('h1,h2,h3,header');
        return /^\s*\u9451\u5b9a\s*$/.test(getText(heading || section));
      }) || null;
      const appraisalRadios = appraisalSection ? [...appraisalSection.querySelectorAll('input[type="radio"]')] : [];
      const storeConfirmationBlock = document.querySelector('#cartopt');
      const storeConfirmationTitle = storeConfirmationBlock
        ? [...storeConfirmationBlock.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')]
          .find(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)) && isVisibleElement(el))
        : null;
      const directStoreConfirmationChange = storeConfirmationBlock
        ? storeConfirmationBlock.querySelector('a[data-cl-params*="_cl_link:cartopt"], a')
        : null;
      const hasStoreConfirmationSection = Boolean(
        storeConfirmationBlock &&
        storeConfirmationTitle &&
        directStoreConfirmationChange &&
        isVisibleElement(storeConfirmationBlock) &&
        isVisibleElement(directStoreConfirmationChange)
      );
      return {
        success: true,
        snapshot: {
          url: location.href,
          title: document.title || '',
          bodyText,
          transactionStatusText,
          controls,
          hasStoreConfirmationSection,
          hasStoreConfirmationEditPage: Boolean(document.querySelector('#confirm a[data-cl-params*="_cl_link:update"]')),
          hasAppraisalSection: Boolean(appraisalSection),
          hasNoAppraisalSelected: appraisalRadios.some(radio => radio.checked && (radio.value === 'unset' || /\u9451\u5b9a\u3057\u306a\u3044/.test(optionTextFromRadio(radio)))),
          shippingOptions
        }
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  if (!result?.success) return null;
  if (result.state) return result.state;
  return buildPaymentPageStateFromSnapshot(result.snapshot || {});
}

async function selectPaymentNoAppraisalOption(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: marker => {
      void marker;
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const appraisalSections = [
        document.querySelector('#appraisal'),
        ...document.querySelectorAll('section')
      ].filter(Boolean);
      const section = appraisalSections.find(item => {
        if (item.id === 'appraisal') return true;
        const heading = item.querySelector?.('h1,h2,h3,header');
        return /^\s*\u9451\u5b9a\s*$/.test(getText(heading || item));
      }) || null;
      if (!section) return { success: true, skipped: true };

      const getRadioText = radio => {
        const parts = [];
        const labelByParent = radio.closest?.('label');
        if (labelByParent) parts.push(getText(labelByParent));
        if (radio.id) {
          const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(radio.id) : String(radio.id).replace(/"/g, '\\"');
          const labelByFor = document.querySelector(`label[for="${escapedId}"]`);
          if (labelByFor) parts.push(getText(labelByFor));
        }
        const container = radio.closest?.('li,dd,tr,div');
        if (container) parts.push(getText(container));
        return normalize(parts.join(' '));
      };
      const radios = [...section.querySelectorAll('input[type="radio"]')];
      const noAppraisalRadio = radios.find(radio => radio.value === 'unset') ||
        radios.find(radio => /\u9451\u5b9a\u3057\u306a\u3044/.test(getRadioText(radio)));
      if (!noAppraisalRadio) return { success: false, error: 'payment no-appraisal radio not found' };
      if (noAppraisalRadio.disabled) return { success: false, error: 'payment no-appraisal radio disabled' };

      const label = noAppraisalRadio.closest?.('label') || null;
      const clickTarget = label || noAppraisalRadio;
      clickTarget.scrollIntoView?.({ block: 'center', inline: 'center' });
      clickTarget.focus?.();
      if (!noAppraisalRadio.checked) {
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        if (typeof PointerEvent !== 'undefined') clickTarget.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        clickTarget.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        if (typeof PointerEvent !== 'undefined') clickTarget.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        clickTarget.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        clickTarget.click?.();
      }
      if (!noAppraisalRadio.checked) {
        noAppraisalRadio.checked = true;
        noAppraisalRadio.dispatchEvent(new Event('input', { bubbles: true }));
        noAppraisalRadio.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return {
        success: Boolean(noAppraisalRadio.checked),
        selected: Boolean(noAppraisalRadio.checked),
        text: getRadioText(noAppraisalRadio).slice(0, 120)
      };
    },
    args: ['__gdaipai_select_no_appraisal__']
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'payment no-appraisal selection failed' };
}

async function runMainWorldPaymentActionClick(tabId, action) {
  const pattern = getPaymentActionPatternSource(action);
  if (!pattern) return { success: false, error: 'unknown payment action' };
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (patternStr, actionName) => {
      const pattern = new RegExp(patternStr);
      const getText = el => [
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const controlSelector = actionName === 'review'
        ? 'a, button, input[type="button"], input[type="submit"], [role="button"]'
        : 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const isClickable = el => {
        const rect = el.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0 && !(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
      };
      const isPreferredConfirm = el => actionName === 'review' && /_cl_link:confirm/.test(String(el.getAttribute?.('data-cl-params') || ''));
      const isReviewControl = el => {
        const tag = String(el?.tagName || '').toUpperCase();
        return tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || el?.getAttribute?.('role') === 'button';
      };
      const hasClickableTarget = el => isClickable(el) ||
        controls.some(child => child !== el && child.closest?.('a, button, input, [role="button"]') === el && pattern.test(getText(child)) && isClickable(child));
      const matches = controls.filter(el => pattern.test(getText(el)));
      const reviewAnchorMatches = actionName === 'review'
        ? matches.filter(el => String(el.tagName || '').toUpperCase() === 'A')
        : [];
      const reviewControlMatches = actionName === 'review' ? matches.filter(isReviewControl) : [];
      const targetMatches = actionName === 'review'
        ? (reviewAnchorMatches.length ? reviewAnchorMatches : reviewControlMatches)
        : matches;
      const button = targetMatches.find(el => isPreferredConfirm(el) && hasClickableTarget(el)) ||
        targetMatches.find(el => hasClickableTarget(el)) ||
        targetMatches.find(el => isPreferredConfirm(el)) ||
        targetMatches[0];
      if (!button) return { success: false, error: actionName === 'review' ? 'payment review button not found: exact anchor/button not found' : 'payment button not found' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.focus?.();
      const type = String(button.type || '').toLowerCase();
      if (button.form && typeof button.form.requestSubmit === 'function' && (type === 'submit' || (!type && button.tagName === 'BUTTON'))) {
        button.form.requestSubmit(button);
        return { success: true, method: 'requestSubmit', action: actionName, text: getText(button) };
      }
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      if (typeof PointerEvent !== 'undefined') {
        button.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      }
      button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      if (typeof PointerEvent !== 'undefined') {
        button.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      }
      button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      button.click();
      return { success: true, method: 'click', action: actionName, text: getText(button) };
    },
    args: [pattern, action]
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'payment click failed' };
}

async function getPaymentActionClickPoint(tabId, action) {
  const pattern = getPaymentActionPatternSource(action);
  if (!pattern) return { success: false, error: 'unknown payment action' };
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (patternStr, actionName) => {
      const pattern = new RegExp(patternStr);
      const getText = el => [
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const controlSelector = actionName === 'review'
        ? 'a, button, input[type="button"], input[type="submit"], [role="button"]'
        : 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const candidates = controls.map(el => {
        const rect = el.getBoundingClientRect?.();
        return {
          tagName: el.tagName,
          text: getText(el).slice(0, 80),
          disabled: Boolean(el.disabled || el.getAttribute?.('aria-disabled') === 'true'),
          role: el.getAttribute?.('role') || '',
          href: el.href || '',
          rect: rect ? { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) } : null
        };
      }).filter(item => item.text);
      const isClickable = el => {
        const rect = el.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0 && !(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
      };
      const isPreferredConfirm = el => /_cl_link:confirm/.test(String(el.getAttribute?.('data-cl-params') || ''));
      const isReviewControl = el => {
        const tag = String(el?.tagName || '').toUpperCase();
        return tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || el?.getAttribute?.('role') === 'button';
      };
      const hasClickableTarget = el => isClickable(el) ||
        controls.some(child => child !== el && child.closest?.('a, button, input, [role="button"]') === el && pattern.test(getText(child)) && isClickable(child));
      const matches = controls.filter(el => pattern.test(getText(el)));
      const reviewAnchorMatches = actionName === 'review'
        ? matches.filter(el => String(el.tagName || '').toUpperCase() === 'A')
        : [];
      const reviewControlMatches = actionName === 'review' ? matches.filter(isReviewControl) : [];
      const targetMatches = actionName === 'review'
        ? (reviewAnchorMatches.length ? reviewAnchorMatches : reviewControlMatches)
        : matches;
      const button = targetMatches.find(el => actionName === 'review' && isPreferredConfirm(el) && hasClickableTarget(el)) ||
        targetMatches.find(el => hasClickableTarget(el)) ||
        targetMatches.find(el => actionName === 'review' && isPreferredConfirm(el)) ||
        targetMatches[0];
      if (!button) return { success: false, error: actionName === 'review' ? 'payment review button not found: exact anchor/button not found for trusted click' : 'payment button not found for trusted click', candidates: candidates.slice(0, 20) };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rectTarget = button.getBoundingClientRect?.()?.width > 0 && button.getBoundingClientRect?.()?.height > 0
        ? button
        : controls.find(el => el !== button && el.closest?.('a, button, input, [role="button"]') === button && pattern.test(getText(el)) && isClickable(el));
      const rect = rectTarget?.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { success: false, error: 'payment button has no clickable rect', candidates: candidates.slice(0, 20) };
      }
      return {
        success: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        text: getText(button),
        candidates: candidates.slice(0, 20)
      };
    },
    args: [pattern, action]
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'payment button not found for trusted click' };
}

function formatPaymentClickDiagnostics(action, clickResult, trustedClick, state, waitError) {
  const parts = [
    `action=${action}`,
    `synthetic=${clickResult?.success ? 'success' : 'failed'}:${clickResult?.method || ''}:${clickResult?.text || clickResult?.error || ''}`,
    `trusted=${trustedClick?.success ? 'success' : 'failed'}:${trustedClick?.method || ''}:${trustedClick?.text || trustedClick?.error || ''}`
  ];
  if (waitError?.message) parts.push(`wait=${waitError.message}`);
  if (state?.url) parts.push(`url=${state.url}`);
  if (trustedClick?.diagnostics) parts.push(`diagnostics=${trustedClick.diagnostics}`);
  if (Array.isArray(state?.controlsSample)) parts.push(`controls=${state.controlsSample.join(' | ').slice(0, 500)}`);
  if (Array.isArray(trustedClick?.candidates)) {
    parts.push(`candidates=${JSON.stringify(trustedClick.candidates).slice(0, 1000)}`);
  }
  return parts.join('; ');
}

async function dispatchTrustedPaymentActionClick(tab, action) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for trusted payment click' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);

  const point = await getPaymentActionClickPoint(tabId, action);
  let diagnostics = await getTrustedInputDiagnostics(tabId, action, 'debuggerMouse', point);
  if (!point?.success) return { ...point, diagnostics };

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await sleep(300);
    diagnostics = await getTrustedInputDiagnostics(tabId, action, 'debuggerMouse', point);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action,
      method: 'debuggerMouse',
      message: 'trusted payment mouse click dispatched',
      diagnostics
    });
    return { success: true, method: 'debuggerMouse', text: point.text, candidates: point.candidates, diagnostics };
  } catch (e) {
    diagnostics = await getTrustedInputDiagnostics(tabId, action, 'debuggerMouse', point).catch(() => diagnostics);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action,
      method: 'debuggerMouse',
      message: e.message || 'trusted payment mouse click failed',
      diagnostics
    });
    return { success: false, error: e.message || 'trusted payment mouse click failed', diagnostics };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function waitForPaymentStateAcrossTabs(tab, predicate, previousIds, timeoutMs = 30000) {
  const startAt = Date.now();
  const originalTabId = tab?.id;
  const previous = previousIds instanceof Set ? previousIds : new Set(previousIds || []);
  const created = new Set(tab?._gdaipaiCreatedTabIds || []);
  if (originalTabId) created.add(originalTabId);

  while (Date.now() - startAt < timeoutMs) {
    const candidates = new Map();
    const original = originalTabId ? await chrome.tabs.get(originalTabId).catch(() => null) : null;
    if (original?.id) candidates.set(original.id, original);

    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const candidate of tabs) {
      if (!candidate?.id || !isLikelyYahooTransactionCleanupTab(candidate)) continue;
      if (candidate.id === originalTabId || created.has(candidate.id) || !previous.has(candidate.id)) {
        candidates.set(candidate.id, candidate);
        if (!previous.has(candidate.id)) created.add(candidate.id);
      }
    }

    for (const candidate of candidates.values()) {
      if (candidate.status !== 'complete') continue;
      const state = await getPaymentPageState(candidate.id).catch(() => null);
      if (state && predicate(state)) {
        candidate._gdaipaiCreatedTabIds = [...created];
        candidate._gdaipaiPaymentState = state;
        return candidate;
      }
    }
    await sleep(500);
  }
  throw new Error('payment next page did not appear');
}

async function waitForPaymentStateOnTab(tab, predicate, timeoutMs = 15000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => null) : null;
    if (current?.status === 'complete') {
      const state = await getPaymentPageState(current.id).catch(() => null);
      if (state && predicate(state)) {
        current._gdaipaiCreatedTabIds = tab?._gdaipaiCreatedTabIds;
        current._gdaipaiPaymentState = state;
        return current;
      }
    }
    await sleep(500);
  }
  return null;
}

async function waitForStoreStatusPaymentEntryRender(tab, job, state) {
  if (!isStorePaymentStatusPage(job, state) || isPaymentEntryOrTerminalState(state)) return { tab, state };
  const readyTab = await waitForPaymentStateOnTab(tab, nextState =>
    !isStorePaymentStatusPage(job, nextState) || isPaymentEntryOrTerminalState(nextState),
    15000
  );
  if (!readyTab) return { tab, state };
  return {
    tab: readyTab,
    state: readyTab._gdaipaiPaymentState || await getPaymentPageState(readyTab.id)
  };
}

function assertPaymentAmountMatches(job, state) {
  const expected = getExpectedPaymentAmountJpy(job);
  const actual = Number(state?.paymentAmountJpy || 0);
  if (expected === null) {
    const finalPrice = getPaymentJobFinalPriceJpy(job);
    if (canTreatUnknownPaymentShippingAsZero(job) && actual > 0 && finalPrice !== null && actual === finalPrice) return;
    const shippingText = String(job?.effectiveShippingFeeText || job?.shippingFeeText || '').trim();
    throw new Error(`payment expected amount unavailable${shippingText ? `: shipping=${shippingText}` : ''}${actual > 0 ? `; found ${actual}\u5186` : ''}`);
  }
  if (actual <= 0) {
    throw new Error(`payment amount not detected: expected ${expected}\u5186`);
  }
  if (actual > 0 && actual !== expected) {
    const shippingSummary = summarizePaymentShippingState(state);
    const paymentFee = Number(state?.paymentMethodFeeJpy || 0);
    const feeSummary = paymentFee > 0 && actual === expected + paymentFee
      ? `; paymentMethodFee: ${paymentFee}\u5186 (current payment method adds fee)`
      : '';
    const sampleSource = String(state?.textSample || '');
    const relevantIndex = sampleSource.search(/\u304a\u652f\u6255\u3044\u91d1\u984d|\u624b\u6570\u6599|\u914d\u9001\u65b9\u6cd5|\u30b3\u30f3\u30d3\u30cb/);
    const sample = (relevantIndex >= 0 ? sampleSource.slice(relevantIndex, relevantIndex + 240) : sampleSource.slice(0, 240));
    throw new Error(`payment amount mismatch: expected ${expected}\u5186, found ${actual}\u5186${feeSummary}${shippingSummary ? `; shippingState: ${shippingSummary}` : ''}${sample ? `; pageSample: ${sample}` : ''}`);
  }
}

function shouldSelectPaymentShippingOption(job = {}, state = {}) {
  const expectedShipping = getExpectedPaymentShippingFeeJpy(job);
  if (expectedShipping === null || expectedShipping <= 0) return false;
  const selectedShipping = Number(state?.selectedShippingAmountJpy || 0);
  const options = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
  const hasExpectedOption = options.some(option => Number(option?.amountJpy || 0) === expectedShipping && !option.disabled);
  if (!hasExpectedOption) return false;
  return selectedShipping !== expectedShipping;
}

function isStorePaymentShippingChangePage(state = {}, job = {}) {
  const productType = String(job?.productType || job?.product_type || '');
  const url = String(state?.url || '');
  return productType === 'store' && /buy\.auctions\.yahoo\.co\.jp\/order\/change\/pay-method/i.test(url);
}

async function expandPaymentShippingOptions(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const textElements = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')];
      const shippingKeywords = /\u914d\u9001\u65b9\u6cd5|\u304a\u3066\u304c\u308b|\u3086\u3046|\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8|\u30ec\u30bf\u30fc\u30d1\u30c3\u30af|\u9001\u6599/;
      const stopKeywords = /\u843d\u672d\u8005\u60c5\u5831|\u304a\u5c4a\u3051\u5148|\u3054\u8cfc\u5165\u5185\u5bb9|\u304a\u652f\u6255\u3044\u65b9\u6cd5|PayPay\u30dd\u30a4\u30f3\u30c8|\u30af\u30fc\u30dd\u30f3/;
      const isFollowing = (first, second) => Boolean(first?.compareDocumentPosition?.(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      const isChangeButton = el => /^\s*\u5909\u66f4(?:\u3059\u308b)?\s*$/.test(getText(el));
      const clickTargetFor = el => el?.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || el;
      const clickElement = el => {
        const target = clickTargetFor(el);
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        const keyOptions = { bubbles: true, cancelable: true, view: window };
        const fireMouse = node => {
          if (!node) return;
          node.scrollIntoView?.({ block: 'center', inline: 'center' });
          node.focus?.();
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          node.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerup', eventOptions));
          node.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          node.click?.();
          node.dispatchEvent(new MouseEvent('click', eventOptions));
        };
        const fireKeyboard = node => {
          if (!node) return;
          node.focus?.();
          for (const key of ['Enter', ' ']) {
            node.dispatchEvent(new KeyboardEvent('keydown', { ...keyOptions, key, code: key === ' ' ? 'Space' : 'Enter' }));
            node.dispatchEvent(new KeyboardEvent('keyup', { ...keyOptions, key, code: key === ' ' ? 'Space' : 'Enter' }));
          }
        };
        fireMouse(el);
        if (target !== el) fireMouse(target);
        fireKeyboard(target);
        return target;
      };
      const dlvryBlock = document.querySelector?.('#dlvry');
      const dlvryChange = dlvryBlock?.querySelector?.('a[data-cl-params*="_cl_link:dlvry"], a');
      if (dlvryBlock && /\u914d\u9001\u65b9\u6cd5/.test(getText(dlvryBlock)) && dlvryChange && isChangeButton(dlvryChange)) {
        const clicked = clickElement(dlvryChange);
        return { success: true, changed: true, text: getText(dlvryChange), method: 'storeDlvrySelector', clickedText: getText(clicked) };
      }
      const shippingSection = [...document.querySelectorAll('section')]
        .filter(section => typeof section.querySelectorAll === 'function')
        .find(section => [...section.querySelectorAll('h1,h2,h3,h4,span')]
          .some(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el))));
      if (shippingSection) {
        const sectionChange = [...shippingSection.querySelectorAll(controlSelector)].find(isChangeButton);
        if (sectionChange) {
          const clicked = clickElement(sectionChange);
          return { success: true, changed: true, text: getText(sectionChange), method: 'shippingSection', clickedText: getText(clicked) };
        }
      }
      const changeControls = controls.filter(isChangeButton);
      const shippingHeaders = textElements.filter(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el)) || getText(el).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      for (const header of shippingHeaders) {
        const nextStop = textElements.find(el => el !== header && isFollowing(header, el) && stopKeywords.test(getText(el)));
        const target = changeControls.find(el => isFollowing(header, el) && (!nextStop || isFollowing(el, nextStop)));
        if (target) {
          const clicked = clickElement(target);
          return { success: true, changed: true, text: getText(target), method: 'afterShippingHeader', clickedText: getText(clicked) };
        }
      }
      const changeButtons = changeControls
        .map(el => {
          let node = el;
          let containerText = '';
          let depth = 0;
          while (node && node !== document.body && depth < 6) {
            containerText = getText(node);
            if (shippingKeywords.test(containerText)) break;
            node = node.parentElement;
            depth += 1;
          }
          return {
            el,
            text: getText(el),
            containerText
          };
        })
        .filter(item => shippingKeywords.test(item.containerText));
      const target = changeButtons[0];
      if (!target) {
        return { success: true, changed: false, reason: 'shipping change button not found' };
      }
      const clicked = clickElement(target.el);
      return { success: true, changed: true, text: target.text, method: 'ancestorText', clickedText: getText(clicked) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'shipping option expansion returned no result' };
}

async function getPaymentShippingChangeClickPoint(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const isClickable = el => {
        const rect = el?.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0 && !(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
      };
      const isFollowing = (first, second) => Boolean(first?.compareDocumentPosition?.(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const textElements = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')];
      const stopKeywords = /\u843d\u672d\u8005\u60c5\u5831|\u304a\u5c4a\u3051\u5148|\u3054\u8cfc\u5165\u5185\u5bb9|\u304a\u652f\u6255\u3044\u65b9\u6cd5|PayPay\u30dd\u30a4\u30f3\u30c8|\u30af\u30fc\u30dd\u30f3/;
      const clickTargetFor = el => el?.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || el;
      const changeControls = controls.filter(el => /^\s*\u5909\u66f4(?:\u3059\u308b)?\s*$/.test(getText(el)));
      const shippingHeaders = textElements.filter(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el)) || getText(el).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      let button = null;
      const dlvryBlock = document.querySelector?.('#dlvry');
      const dlvryChange = dlvryBlock?.querySelector?.('a[data-cl-params*="_cl_link:dlvry"], a');
      if (dlvryBlock && /\u914d\u9001\u65b9\u6cd5/.test(getText(dlvryBlock)) && dlvryChange && /^\s*\u5909\u66f4(?:\u3059\u308b)?\s*$/.test(getText(dlvryChange))) {
        button = clickTargetFor(dlvryChange);
        if (button && !isClickable(button)) button = dlvryChange;
      }
      const shippingSection = [...document.querySelectorAll('section')]
        .filter(section => typeof section.querySelectorAll === 'function')
        .find(section => [...section.querySelectorAll('h1,h2,h3,h4,span')]
          .some(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el))));
      if (shippingSection) {
        const sectionChange = [...shippingSection.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4(?:\u3059\u308b)?\s*$/.test(getText(el)));
        button = clickTargetFor(sectionChange);
        if (button && !isClickable(button)) button = sectionChange;
      }
      for (const header of shippingHeaders) {
        if (button) break;
        const nextStop = textElements.find(el => el !== header && isFollowing(header, el) && stopKeywords.test(getText(el)));
        const target = changeControls.find(el => isFollowing(header, el) && (!nextStop || isFollowing(el, nextStop)));
        button = clickTargetFor(target);
        if (button && !isClickable(button)) button = target;
        if (button) break;
      }
      if (!button || !isClickable(button)) return { success: false, error: 'shipping change button click point not found' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect?.();
      return {
        success: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        text: getText(button)
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'shipping change button click point not found' };
}

async function clickPaymentShippingChangeButton(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const isFollowing = (first, second) => Boolean(first?.compareDocumentPosition?.(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const textElements = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')];
      const stopKeywords = /\u843d\u672d\u8005\u60c5\u5831|\u304a\u5c4a\u3051\u5148|\u3054\u8cfc\u5165\u5185\u5bb9|\u304a\u652f\u6255\u3044\u65b9\u6cd5|PayPay\u30dd\u30a4\u30f3\u30c8|\u30af\u30fc\u30dd\u30f3/;
      const clickTargetFor = el => el?.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || el;
      const isChangeButton = el => /^\s*\u5909\u66f4(?:\u3059\u308b)?\s*$/.test(getText(el));
      const clickElement = el => {
        const target = clickTargetFor(el);
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        for (const node of [...new Set([el, target].filter(Boolean))]) {
          node.scrollIntoView?.({ block: 'center', inline: 'center' });
          node.focus?.();
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          node.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerup', eventOptions));
          node.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          node.click?.();
          node.dispatchEvent(new KeyboardEvent('keydown', { ...eventOptions, key: 'Enter', code: 'Enter' }));
          node.dispatchEvent(new KeyboardEvent('keyup', { ...eventOptions, key: 'Enter', code: 'Enter' }));
        }
        return target || el;
      };
      let button = null;
      const dlvryBlock = document.querySelector?.('#dlvry');
      const dlvryChange = dlvryBlock?.querySelector?.('a[data-cl-params*="_cl_link:dlvry"], a');
      if (dlvryBlock && /\u914d\u9001\u65b9\u6cd5/.test(getText(dlvryBlock)) && dlvryChange && isChangeButton(dlvryChange)) {
        const clicked = clickElement(dlvryChange);
        return { success: true, method: 'storeDlvrySelector', text: getText(dlvryChange), clickedText: getText(clicked) };
      }
      const shippingSection = [...document.querySelectorAll('section')]
        .filter(section => typeof section.querySelectorAll === 'function')
        .find(section => [...section.querySelectorAll('h1,h2,h3,h4,span')]
          .some(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el))));
      if (shippingSection) {
        button = [...shippingSection.querySelectorAll(controlSelector)].find(isChangeButton);
      }
      const shippingHeaders = textElements.filter(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el)) || getText(el).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      const changeControls = controls.filter(isChangeButton);
      for (const header of shippingHeaders) {
        if (button) break;
        const nextStop = textElements.find(el => el !== header && isFollowing(header, el) && stopKeywords.test(getText(el)));
        button = changeControls.find(el => isFollowing(header, el) && (!nextStop || isFollowing(el, nextStop)));
      }
      if (!button) return { success: false, error: 'shipping change button JS click not found' };
      const clicked = clickElement(button);
      return { success: true, method: 'jsClick', text: getText(button), clickedText: getText(clicked) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'shipping change JS click returned no result' };
}

async function focusPaymentInteractionTab(tab) {
  const tabId = tab?.id || tab;
  if (!tabId) return null;
  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);
  return currentTab || tab;
}

async function dispatchTrustedPaymentShippingChangeClick(tab, options = {}) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for trusted shipping change click' };

  let jsClick = null;
  if (!options.skipJs) {
    await focusPaymentInteractionTab(tab);
    jsClick = await clickPaymentShippingChangeButton(tabId);
    if (jsClick?.success) return jsClick;
    if (!chrome.debugger?.attach) return { ...jsClick, error: jsClick?.error || 'chrome.debugger API unavailable' };
  }
  if (!chrome.debugger?.attach) return { ...jsClick, error: jsClick?.error || 'chrome.debugger API unavailable' };

  await focusPaymentInteractionTab(tab);

  const point = await getPaymentShippingChangeClickPoint(tabId);
  let diagnostics = await getTrustedInputDiagnostics(tabId, 'paymentShippingChange', 'debuggerMouse', point);
  if (!point?.success) return { ...point, diagnostics };

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    diagnostics = await getTrustedInputDiagnostics(tabId, 'paymentShippingChange', 'debuggerMouse', point);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action: 'paymentShippingChange',
      method: 'debuggerMouse',
      message: 'trusted payment shipping change click dispatched',
      diagnostics
    });
    return { success: true, method: 'debuggerMouse', text: point.text, diagnostics };
  } catch (e) {
    diagnostics = await getTrustedInputDiagnostics(tabId, 'paymentShippingChange', 'debuggerMouse', point).catch(() => diagnostics);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action: 'paymentShippingChange',
      method: 'debuggerMouse',
      message: e.message || 'trusted payment shipping change click failed',
      diagnostics
    });
    return { success: false, error: e.message || String(e), point, diagnostics };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

function summarizePaymentShippingState(state = {}) {
  const options = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
  return options
    .map(option => `${option.amountJpy || 0}\u5186${option.checked ? ':checked' : ''}${option.visible === false ? ':hidden' : ''}`)
    .join(', ');
}

function hasExpectedPaymentShippingOption(state = {}, expectedShipping) {
  const options = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
  return expectedShipping !== null && options.some(option =>
    Number(option?.amountJpy || 0) === expectedShipping && !option.disabled
  );
}

function shouldRetryPaymentShippingChangeWithDebugger(state = {}, expandResult = {}) {
  const options = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
  if (options.length > 0) return false;
  if (isStorePaymentShippingChangePage(state, {})) return false;
  const sample = String(state?.textSample || '');
  const stillShowsChange = /\u5909\u66f4(?:\u3059\u308b)?/.test(sample);
  return Boolean(stillShowsChange || expandResult?.success === false || expandResult?.changed === false);
}

async function selectPaymentShippingOption(tabId, expectedShippingJpy) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [expectedShippingJpy],
    func: expectedAmount => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const parseAmount = text => {
        const match = String(text || '').match(/([\d,]+)\s*\u5186/);
        return match ? Number(match[1].replace(/,/g, '')) || 0 : 0;
      };
      const isVisibleElement = el => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!(rect && rect.width > 0 && rect.height > 0);
      };
      const isVisibleRadioOption = radio => {
        if (!radio) return false;
        let node = radio;
        while (node && node !== document.body) {
          const style = window.getComputedStyle?.(node);
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
          node = node.parentElement;
        }
        const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
        const container = radio.closest('label, li, tr, dd, div');
        return isVisibleElement(radio) || isVisibleElement(label) || isVisibleElement(container);
      };
      const optionTextFromRadio = radio => {
        const parts = [];
        const label = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
        if (label) parts.push(getText(label));
        let node = radio.closest('label, li, tr, dd, div');
        let depth = 0;
        while (node && node !== document.body && depth < 5) {
          const text = getText(node);
          if (text) parts.push(text);
          node = node.parentElement;
          depth += 1;
        }
        return normalize(parts.join(' '));
      };
      const shippingHeader = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')]
        .find(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(getText(el)) || getText(el).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      const shippingKeywords = /\u914d\u9001|\u9001\u6599|\u304a\u3066\u304c\u308b|\u3086\u3046|\u30af\u30ea\u30c3\u30af\u30dd\u30b9\u30c8|\u30ec\u30bf\u30fc\u30d1\u30c3\u30af|\u5b9a\u5f62|\u5b85\u6025\u4fbf/;
      const paymentKeywords = /\u30af\u30ec\u30b8\u30c3\u30c8|\u30b3\u30f3\u30d3\u30cb|PayPay|\u9280\u884c\u632f\u8fbc|\u652f\u6255|\u624b\u6570\u6599/;
      const knownShippingSelector = 'input[type="radio"][name="shipMethodPullDown"], input[type="radio"][value^="postage"]';
      const findShippingScope = () => {
        const header = document.querySelector('#shipMethod') || shippingHeader;
        let node = header;
        let depth = 0;
        while (node && node !== document.body && depth < 8) {
          if (node.querySelectorAll?.(knownShippingSelector).length) return node;
          node = node.parentElement;
          depth += 1;
        }
        return null;
      };
      const shippingScope = findShippingScope();
      const radioSource = shippingScope?.querySelectorAll?.(knownShippingSelector).length
        ? [...shippingScope.querySelectorAll(knownShippingSelector)]
        : [...document.querySelectorAll('input[type="radio"]')];
      const candidates = radioSource
        .map((radio, index) => {
          const text = optionTextFromRadio(radio);
          const radioName = String(radio.name || radio.getAttribute?.('name') || '');
          const radioValue = String(radio.value || radio.getAttribute?.('value') || '');
          const isKnownShippingRadio = radioName === 'shipMethodPullDown' || /^postage\d*/i.test(radioValue);
          const afterShippingHeader = shippingHeader
            ? isKnownShippingRadio || shippingHeader.contains?.(radio) || !!(shippingHeader.compareDocumentPosition(radio) & Node.DOCUMENT_POSITION_FOLLOWING)
            : shippingKeywords.test(text);
          const looksLikePaymentMethod = paymentKeywords.test(text) && !shippingKeywords.test(text);
          return {
            index,
            radio,
            amountJpy: parseAmount(text),
            checked: !!radio.checked,
            disabled: !!radio.disabled,
            text,
            visible: isVisibleRadioOption(radio),
            isKnownShippingRadio,
            isShipping: afterShippingHeader && !looksLikePaymentMethod
          };
        });
      const options = candidates.filter(option => option.isShipping && (option.visible || option.isKnownShippingRadio) && option.amountJpy > 0);
      const target = options.find(option => option.amountJpy === expectedAmount && !option.disabled);
      if (!target) {
        return {
          success: false,
          error: 'matching payment shipping option not found',
          expectedShippingJpy: expectedAmount,
          options: options.map(option => ({ amountJpy: option.amountJpy, checked: option.checked, disabled: option.disabled, text: option.text.slice(0, 160) })),
          candidates: candidates.map(option => ({
            amountJpy: option.amountJpy,
            checked: option.checked,
            disabled: option.disabled,
            visible: option.visible,
            isKnownShippingRadio: option.isKnownShippingRadio,
            isShipping: option.isShipping,
            text: option.text.slice(0, 160)
          }))
        };
      }
      if (target.checked) {
        return { success: true, changed: false, selectedShippingJpy: expectedAmount };
      }
      const label = target.radio.id ? document.querySelector(`label[for="${CSS.escape(target.radio.id)}"]`) : null;
      const clickTarget = label || target.radio.closest('label, li, tr, dd, div') || target.radio;
      clickTarget.scrollIntoView?.({ block: 'center', inline: 'center' });
      clickTarget.focus?.();
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      if (typeof PointerEvent !== 'undefined') clickTarget.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      clickTarget.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      if (typeof PointerEvent !== 'undefined') clickTarget.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      clickTarget.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      clickTarget.click?.();
      target.radio.dispatchEvent(new Event('input', { bubbles: true }));
      target.radio.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        success: true,
        changed: true,
        selectedShippingJpy: expectedAmount,
        previousShippingJpy: options.find(option => option.checked && option.index !== target.index)?.amountJpy || null
      };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'shipping option selection returned no result' };
}

async function clickStorePaymentShippingApplyButton(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"]';
      const controls = [...document.querySelectorAll(controlSelector)];
      const button = controls.find(el => /^\s*\u5909\u66f4\u3059\u308b\s*$/.test(getText(el)) && !(el.disabled || el.getAttribute?.('aria-disabled') === 'true'));
      if (!button) return { success: false, error: 'store payment shipping apply button not found' };
      const target = button.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || button;
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      for (const node of [...new Set([button, target].filter(Boolean))]) {
        node.scrollIntoView?.({ block: 'center', inline: 'center' });
        node.focus?.();
        if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        node.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        node.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        node.click?.();
        node.dispatchEvent(new KeyboardEvent('keydown', { ...eventOptions, key: 'Enter', code: 'Enter' }));
        node.dispatchEvent(new KeyboardEvent('keyup', { ...eventOptions, key: 'Enter', code: 'Enter' }));
      }
      return { success: true, method: 'jsClick', text: getText(button), clickedText: getText(target) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store payment shipping apply returned no result' };
}

async function revealStorePaymentShippingOptions(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const shipRadios = [...document.querySelectorAll('input[type="radio"][name="shipMethodPullDown"], input[type="radio"][value^="postage"]')];
      if (shipRadios.length) {
        const target = shipRadios.find(radio => !radio.checked) || shipRadios[0];
        const container = target?.closest?.('label, li, section, div') || target;
        container?.scrollIntoView?.({ block: 'center', inline: 'center' });
        return { success: true, found: shipRadios.length, method: 'shipMethodRadio' };
      }
      const headings = [...document.querySelectorAll('#shipMethod, h1,h2,h3,h4,section,div,p,span')];
      const heading = headings.find(el => /^\s*\u914d\u9001\u65b9\u6cd5\s*$/.test(normalize(el.textContent)) || normalize(el.textContent).startsWith('\u914d\u9001\u65b9\u6cd5 '));
      if (heading) {
        heading.scrollIntoView?.({ block: 'center', inline: 'center' });
        return { success: true, found: 0, method: 'shipMethodHeading', text: normalize(heading.textContent).slice(0, 120) };
      }
      const scrollHeight = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
      const viewport = window.innerHeight || 800;
      const current = window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
      const next = Math.min(scrollHeight, current + Math.floor(viewport * 0.8));
      window.scrollTo?.({ top: next, behavior: 'instant' });
      return { success: true, found: 0, method: 'scrollDown', top: next, scrollHeight };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store payment shipping reveal returned no result' };
}

async function completeStorePaymentShippingChangePage(tab, job) {
  const expectedShipping = getExpectedPaymentShippingFeeJpy(job);
  if (!tab?.id || expectedShipping === null || expectedShipping <= 0) {
    return { success: false, error: 'store payment shipping change page missing expected shipping' };
  }
  let selectResult = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await revealStorePaymentShippingOptions(tab.id).catch(() => null);
    await sleep(200);
    selectResult = await selectPaymentShippingOption(tab.id, expectedShipping);
    if (selectResult?.success) break;
    await sleep(500);
  }
  if (!selectResult?.success) {
    const optionSummary = Array.isArray(selectResult?.options)
      ? selectResult.options.map(option => `${option.amountJpy}\u5186${option.checked ? ':checked' : ''}`).join(', ')
      : '';
    const candidateSummary = !optionSummary && Array.isArray(selectResult?.candidates)
      ? selectResult.candidates.map(option => `${option.amountJpy || 0}\u5186${option.checked ? ':checked' : ''}${option.visible === false ? ':hidden' : ''}${option.isShipping === false ? ':nonShipping' : ''}:${option.text || ''}`).join(' | ').slice(0, 700)
      : '';
    return {
      success: false,
      error: `store payment shipping option ${expectedShipping}\u5186 not selectable${optionSummary ? `; options: ${optionSummary}` : ''}${candidateSummary ? `; candidates: ${candidateSummary}` : ''}`
    };
  }
  if (selectResult.changed) await sleep(500);
  const applyResult = await clickStorePaymentShippingApplyButton(tab.id);
  if (!applyResult?.success) return { success: false, error: applyResult?.error || 'store payment shipping apply click failed' };
  const reviewTab = await waitForPaymentStateOnTab(tab, nextState =>
    nextState.cancelled || nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
    15000
  );
  if (!reviewTab) return { success: false, error: 'store payment shipping review page did not return after JS click' };
  return {
    success: true,
    state: reviewTab._gdaipaiPaymentState || await getPaymentPageState(tab.id),
    tab: reviewTab,
    selectResult,
    applyResult
  };
}

async function refreshPaymentPageState(tab, waitMs = 1500) {
  if (!tab?.id) return null;
  if (chrome.tabs.reload) {
    await chrome.tabs.reload(tab.id).catch(() => {});
  } else {
    const current = await chrome.tabs.get(tab.id).catch(() => tab);
    if (current?.url) await chrome.tabs.update(tab.id, { url: current.url, active: true }).catch(() => {});
  }
  await waitForTabComplete(tab.id, 10000).catch(() => {});
  await sleep(waitMs);
  await injectContentScript(tab.id).catch(() => {});
  return await getPaymentPageState(tab.id).catch(() => null);
}

async function waitForExpandedPaymentShippingOptions(tab, job, options = {}) {
  const expectedShipping = getExpectedPaymentShippingFeeJpy(job);
  const expectedAmount = getExpectedPaymentAmountJpy(job);
  const timeoutMs = Number(options.timeoutMs || 8000);
  const intervalMs = Number(options.intervalMs || 500);
  const startAt = Date.now();
  let latest = null;
  while (Date.now() - startAt < timeoutMs) {
    latest = await getPaymentPageState(tab.id).catch(() => null);
    if (!latest) {
      await sleep(intervalMs);
      continue;
    }
    if (isStorePaymentShippingChangePage(latest, job)) return latest;
    if (expectedAmount !== null && Number(latest.paymentAmountJpy || 0) === expectedAmount) return latest;
    if (hasExpectedPaymentShippingOption(latest, expectedShipping)) return latest;
    await sleep(intervalMs);
  }
  return latest || await getPaymentPageState(tab.id).catch(() => null);
}

async function ensurePaymentShippingOption(tab, job, state, options = {}) {
  const expectedShipping = getExpectedPaymentShippingFeeJpy(job);
  const expectedAmount = getExpectedPaymentAmountJpy(job);
  const currentAmount = Number(state?.paymentAmountJpy || 0);
  const needsAmountCorrection = expectedAmount !== null && currentAmount > 0 && currentAmount !== expectedAmount;
  const hasShippingChoices = (Array.isArray(state?.shippingOptions) && state.shippingOptions.length) ||
    /\u914d\u9001\u65b9\u6cd5/.test(String(state?.textSample || ''));
  if (!tab?.id || !state?.hasReviewButton || expectedShipping === null || expectedShipping <= 0 || (!hasShippingChoices && !needsAmountCorrection)) return state;
  if (expectedAmount !== null && currentAmount === expectedAmount) return state;
  const visibleOptions = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
  const hasExpectedOption = visibleOptions.some(option => Number(option?.amountJpy || 0) === expectedShipping && !option.disabled);
  let expandResult = null;
  let trustedExpandResult = null;
  if (!hasExpectedOption) {
    const expandAttempts = isStorePaymentJob(job) ? 5 : 1;
    for (let attempt = 0; attempt < expandAttempts; attempt += 1) {
      if (!isStorePaymentJob(job)) await focusPaymentInteractionTab(tab);
      expandResult = await expandPaymentShippingOptions(tab.id);
      state = await waitForExpandedPaymentShippingOptions(tab, job);
      if (expandResult?.changed || expandResult?.success === false) break;
    }
    state = state || await getPaymentPageState(tab.id);
    if (isStorePaymentShippingChangePage(state, job)) {
      const storeChangeResult = await completeStorePaymentShippingChangePage(tab, job);
      if (!storeChangeResult?.success) throw new Error(storeChangeResult?.error || 'store payment shipping change flow failed');
      return storeChangeResult.state || state;
    }
    const expandedOptions = Array.isArray(state?.shippingOptions) ? state.shippingOptions : [];
    const expandedHasExpectedOption = expandedOptions.some(option => Number(option?.amountJpy || 0) === expectedShipping && !option.disabled);
    if (!expandedHasExpectedOption) {
      if (!isStorePaymentJob(job) && shouldRetryPaymentShippingChangeWithDebugger(state, expandResult)) {
        trustedExpandResult = await dispatchTrustedPaymentShippingChangeClick(tab, { skipJs: true });
        if (trustedExpandResult?.success) {
          state = await waitForExpandedPaymentShippingOptions(tab, job);
        }
      }
    }
  }
  const result = await selectPaymentShippingOption(tab.id, expectedShipping);
  if (!result?.success) {
    const latestState = await getPaymentPageState(tab.id).catch(() => null);
    if (expectedAmount !== null && Number(latestState?.paymentAmountJpy || 0) === expectedAmount) return latestState;
    const noVisibleShippingControls = !Array.isArray(result?.options) || result.options.length === 0;
    const expansionUnavailable = expandResult?.changed === false;
    if (!options.refreshed && noVisibleShippingControls && expansionUnavailable) {
      const refreshedState = await refreshPaymentPageState(tab);
      if (expectedAmount !== null && Number(refreshedState?.paymentAmountJpy || 0) === expectedAmount) return refreshedState;
      if (refreshedState?.hasReviewButton) {
        return await ensurePaymentShippingOption(tab, job, refreshedState, { ...options, refreshed: true });
      }
    }
    const optionSummary = Array.isArray(result?.options)
      ? result.options.map(option => `${option.amountJpy}\u5186${option.checked ? ':checked' : ''}`).join(', ')
      : '';
    const stateSummary = summarizePaymentShippingState(state);
    const expandSummary = expandResult ? `; expand=${expandResult.method || expandResult.reason || expandResult.error || 'unknown'}:${expandResult.text || ''}:${expandResult.clickedText || ''}` : '';
    const trustedExpandSummary = trustedExpandResult ? `; trustedExpand=${trustedExpandResult.method || trustedExpandResult.error || 'unknown'}:${trustedExpandResult.text || ''}` : '';
    throw new Error(`payment shipping option ${expectedShipping}\u5186 not selectable${optionSummary ? `; options: ${optionSummary}` : ''}${stateSummary ? `; visibleState: ${stateSummary}` : ''}${expandSummary}${trustedExpandSummary}`);
  }
  if (result.changed) await sleep(800);
  return await getPaymentPageState(tab.id);
}

async function waitForExpectedPaymentAmount(tab, job, state) {
  const expected = getExpectedPaymentAmountJpy(job);
  if (!tab?.id || expected === null) return state;
  let latest = state;
  const startAt = Date.now();
  while (Date.now() - startAt < 5000) {
    if (Number(latest?.paymentAmountJpy || 0) === expected) return latest;
    await sleep(500);
    latest = await getPaymentPageState(tab.id);
  }
  return latest;
}

async function waitForStoreConfirmationSectionBeforeReview(tab, job, state, timeoutMs = 8000) {
  if (
    !PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED ||
    !tab?.id ||
    !isStorePaymentJob(job) ||
    state?.hasStoreConfirmationSection ||
    !isStorePaymentReviewPage(state) ||
    !state?.hasReviewButton
  ) {
    return state;
  }

  let latest = state;
  const attempts = Math.max(1, Math.ceil(timeoutMs / 500));
  for (let i = 0; i < attempts; i += 1) {
    await sleep(500);
    const next = await getPaymentPageState(tab.id).catch(() => null);
    if (!next) continue;
    latest = next;
    if (
      latest.hasStoreConfirmationSection ||
      latest.cancelled ||
      latest.alreadyPaid ||
      latest.complete ||
      !isStorePaymentReviewPage(latest) ||
      !latest.hasReviewButton
    ) {
      return latest;
    }
  }
  return latest;
}

async function clickStoreConfirmationChange(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const isFollowing = (first, second) => Boolean(first?.compareDocumentPosition?.(second) & Node.DOCUMENT_POSITION_FOLLOWING);
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const controls = [...document.querySelectorAll(controlSelector)];
      const textElements = [...document.querySelectorAll('h1,h2,h3,h4,th,dt,div,section,p,span')];
      const clickTargetFor = el => el?.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || el;
      const findStoreConfirmationChange = () => {
        const direct = document.querySelector('#cartopt a[data-cl-params*="_cl_link:cartopt"], #cartopt a');
        if (direct) return direct;
        const header = [...document.querySelectorAll('header')].find(item =>
          [...item.querySelectorAll('h1,h2,h3,h4,span')].some(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)))
        );
        const headerChange = header
          ? [...header.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)))
          : null;
        if (headerChange) return headerChange;
        const title = [...document.querySelectorAll('h1,h2,h3,h4,span')].find(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)));
        const container = title?.closest?.('section, li, div');
        return container
          ? [...container.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)))
          : null;
      };
      const clickElement = el => {
        const target = clickTargetFor(el);
        const eventOptions = { bubbles: true, cancelable: true, view: window };
        for (const node of [...new Set([el, target].filter(Boolean))]) {
          node.scrollIntoView?.({ block: 'center', inline: 'center' });
          node.focus?.();
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
          node.dispatchEvent(new MouseEvent('mousedown', eventOptions));
          if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerup', eventOptions));
          node.dispatchEvent(new MouseEvent('mouseup', eventOptions));
          node.click?.();
          node.dispatchEvent(new MouseEvent('click', eventOptions));
        }
        return target || el;
      };
      const directCartoptChange = findStoreConfirmationChange();
      if (directCartoptChange) {
        const clicked = clickElement(directCartoptChange);
        return { success: true, text: getText(directCartoptChange), clickedText: getText(clicked), method: 'storeConfirmationSelector' };
      }
      const headers = textElements.filter(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)));
      const changeControls = controls.filter(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)));
      const stopKeywords = /\u30e1\u30fc\u30eb\u914d\u4fe1\u767b\u9332|\u30b9\u30c8\u30a2\u3078\u306e\u8981\u671b|\u304a\u652f\u6255\u3044\u65b9\u6cd5|\u914d\u9001\u65b9\u6cd5|\u3054\u8acb\u6c42\u5148|\u3054\u8cfc\u5165\u5185\u5bb9/;

      for (const header of headers) {
        const section = header.closest?.('section, li, div');
        const sectionChange = section
          ? [...section.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)))
          : null;
        const target = sectionChange || (() => {
          const nextStop = textElements.find(el => el !== header && isFollowing(header, el) && stopKeywords.test(getText(el)));
          return changeControls.find(el => isFollowing(header, el) && (!nextStop || isFollowing(el, nextStop)));
        })();
        if (target) {
          const clicked = clickElement(target);
          return { success: true, text: getText(target), clickedText: getText(clicked) };
        }
      }
      return { success: false, error: 'store confirmation change button not found' };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store confirmation change click returned no result' };
}

async function checkAllStoreConfirmationItemsAndApply(tabId, clickApply = true) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [clickApply],
    func: shouldClickApply => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter(input => !input.disabled);
      const clickElement = el => {
        if (!el) return;
        el.scrollIntoView?.({ block: 'center', inline: 'center' });
        el.focus?.();
        if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        el.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        if (typeof PointerEvent !== 'undefined') el.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        el.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        el.click?.();
      };
      for (const checkbox of checkboxes) {
        const label = checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) : null;
        const target = label || checkbox.closest('label, li, div, section, p, dd') || checkbox;
        target.scrollIntoView?.({ block: 'center', inline: 'center' });
        if (!checkbox.checked) {
          clickElement(target || checkbox);
          if (!checkbox.checked && target !== checkbox) clickElement(checkbox);
        }
        if (checkbox.checked) {
          checkbox.dispatchEvent(new Event('input', { bubbles: true }));
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span')];
      const button = document.querySelector('#confirm a[data-cl-params*="_cl_link:update"], #confirm button, #confirm input[type="submit"], #confirm [role="button"]') ||
        controls.find(el => /^\s*\u5909\u66f4\u3059\u308b\s*$/.test(getText(el)));
      const checkedCount = checkboxes.filter(checkbox => checkbox.checked).length;
      if (!button) return { success: false, error: 'store confirmation apply button not found', checkedCount, checkboxCount: checkboxes.length };
      if (!shouldClickApply) {
        return {
          success: checkedCount === checkboxes.length,
          error: checkedCount === checkboxes.length ? '' : 'store confirmation checkbox JS click did not check all boxes',
          checkedCount,
          checkboxCount: checkboxes.length,
          text: getText(button),
          applyReady: true
        };
      }
      const target = button.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || button;
      for (const node of [...new Set([button, target].filter(Boolean))]) {
        clickElement(node);
        if (typeof KeyboardEvent !== 'undefined') {
          node.dispatchEvent(new KeyboardEvent('keydown', { ...eventOptions, key: 'Enter', code: 'Enter' }));
          node.dispatchEvent(new KeyboardEvent('keyup', { ...eventOptions, key: 'Enter', code: 'Enter' }));
        }
      }
      return { success: true, checkedCount, checkboxCount: checkboxes.length, text: getText(button) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store confirmation apply returned no result' };
}

async function getStoreConfirmationFormReadiness(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter(input => !input.disabled);
      const button = document.querySelector('#confirm a[data-cl-params*="_cl_link:update"], #confirm button, #confirm input[type="submit"], #confirm [role="button"]') ||
        [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span')]
          .find(el => /^\s*\u5909\u66f4\u3059\u308b\s*$/.test(getText(el)));
      const bodyText = normalize(document.body?.textContent || '');
      return {
        success: true,
        readyState: document.readyState,
        checkboxCount: checkboxes.length,
        checkedCount: checkboxes.filter(input => input.checked).length,
        hasApplyButton: Boolean(button),
        buttonText: getText(button),
        hasStoreOptionText: /\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805/.test(bodyText),
        hasSkeleton: [...document.querySelectorAll('span[width], [class*="skeleton"], [class*="Skeleton"]')].length > 0,
        textLength: bodyText.length
      };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store confirmation readiness returned no result' };
}

async function waitForStoreConfirmationFormReady(tabId, timeoutMs = 15000, stableMs = 1800) {
  const startAt = Date.now();
  let lastResult = null;
  let stableSince = 0;
  let stableHits = 0;
  let lastSignature = '';
  while (Date.now() - startAt < timeoutMs) {
    lastResult = await getStoreConfirmationFormReadiness(tabId);
    const ready = lastResult?.success &&
      lastResult.readyState === 'complete' &&
      Number(lastResult.checkboxCount || 0) > 0 &&
      lastResult.hasApplyButton &&
      lastResult.hasStoreOptionText &&
      !lastResult.hasSkeleton;
    const signature = ready
      ? `${lastResult.checkboxCount}:${lastResult.buttonText}:${lastResult.textLength}`
      : '';
    if (ready && signature === lastSignature) {
      if (!stableSince) stableSince = Date.now();
      stableHits += 1;
      if (Date.now() - stableSince >= stableMs || stableHits >= 4) return lastResult;
    } else {
      stableSince = 0;
      stableHits = ready ? 1 : 0;
      lastSignature = signature;
    }
    await sleep(500);
  }
  return lastResult?.success
    ? { success: false, error: 'store confirmation form not ready', ...lastResult }
    : (lastResult || { success: false, error: 'store confirmation readiness wait failed' });
}

async function getStoreConfirmationCheckboxClickPoints(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const pickRect = (checkbox, label) => {
        checkbox.scrollIntoView?.({ block: 'center', inline: 'center' });
        const checkboxRect = checkbox.getBoundingClientRect?.();
        if (checkboxRect && checkboxRect.width > 0 && checkboxRect.height > 0) return { element: checkbox, rect: checkboxRect };
        const labelRect = label?.getBoundingClientRect?.();
        if (labelRect && labelRect.width > 0 && labelRect.height > 0) return { element: label, rect: labelRect };
        const container = checkbox.closest?.('label, li, div, section, p, dd');
        const containerRect = container?.getBoundingClientRect?.();
        if (containerRect && containerRect.width > 0 && containerRect.height > 0) return { element: container, rect: containerRect };
        return null;
      };
      const points = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter(input => !input.disabled)
        .map((checkbox, index) => {
          const label = checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) : checkbox.closest?.('label');
          const picked = pickRect(checkbox, label);
          if (!picked) return null;
          const { rect } = picked;
          return {
            index,
            checked: Boolean(checkbox.checked),
            x: rect.left + Math.min(Math.max(rect.width / 2, 6), Math.max(rect.width - 6, 6)),
            y: rect.top + rect.height / 2,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            text: getText(label || picked.element || checkbox)
          };
        })
        .filter(Boolean);
      if (!points.length) return { success: false, error: 'store confirmation checkbox click points not found' };
      return { success: true, points };
    }
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'store confirmation checkbox click points not found' };
}

async function dispatchTrustedStoreConfirmationCheckboxes(tab) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for store confirmation checkbox click' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);

  let pointResult = await getStoreConfirmationCheckboxClickPoints(tabId);
  const waitUntil = Date.now() + 8000;
  while (!pointResult?.success && Date.now() < waitUntil) {
    await sleep(500);
    pointResult = await getStoreConfirmationCheckboxClickPoints(tabId);
  }
  if (!pointResult?.success) return pointResult;

  const target = { tabId };
  let attached = false;
  const clickAt = async point => {
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
  };
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    for (const point of pointResult.points) {
      if (point.checked) {
        await clickAt(point);
        await sleep(300);
      }
      await clickAt(point);
      await sleep(500);
    }
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action: 'storeConfirmationCheckboxes',
      method: 'debuggerMouseCheckbox',
      message: 'trusted store confirmation checkbox clicks dispatched',
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouseCheckbox,action=storeConfirmationCheckboxes,tabId=${tabId},clickedCount=${pointResult.points.length}`
    });
    return { success: true, method: 'debuggerMouseCheckbox', clickedCount: pointResult.points.length };
  } catch (e) {
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action: 'storeConfirmationCheckboxes',
      method: 'debuggerMouseCheckbox',
      message: e.message || 'store confirmation checkbox trusted click failed',
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouseCheckbox,action=storeConfirmationCheckboxes,tabId=${tabId},error=${e.message || e}`
    });
    return { success: false, error: e.message || 'store confirmation checkbox trusted click failed' };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function clickStoreConfirmationApplyButton(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], span')];
      const button = document.querySelector('#confirm a[data-cl-params*="_cl_link:update"], #confirm button, #confirm input[type="submit"], #confirm [role="button"]') ||
        controls.find(el => /^\s*\u5909\u66f4\u3059\u308b\s*$/.test(getText(el)));
      if (!button) return { success: false, error: 'store confirmation apply button not found' };
      const target = button.closest?.('[role="button"], button, a, input[type="button"], input[type="submit"]') || button;
      for (const node of [...new Set([button, target].filter(Boolean))]) {
        node.scrollIntoView?.({ block: 'center', inline: 'center' });
        node.focus?.();
        if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
        node.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        if (typeof PointerEvent !== 'undefined') node.dispatchEvent(new PointerEvent('pointerup', eventOptions));
        node.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        node.click?.();
        if (typeof KeyboardEvent !== 'undefined') {
          node.dispatchEvent(new KeyboardEvent('keydown', { ...eventOptions, key: 'Enter', code: 'Enter' }));
          node.dispatchEvent(new KeyboardEvent('keyup', { ...eventOptions, key: 'Enter', code: 'Enter' }));
        }
      }
      return { success: true, text: getText(button) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'store confirmation apply click returned no result' };
}

async function getStoreConfirmationClickPoint(tabId, action) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [action],
    func: actionName => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const selector = actionName === 'apply'
        ? '#confirm a[data-cl-params*="_cl_link:update"], #confirm button, #confirm input[type="submit"], #confirm [role="button"]'
        : '#cartopt a[data-cl-params*="_cl_link:cartopt"], #cartopt a';
      const controlSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], span';
      const findStoreConfirmationChange = () => {
        const direct = document.querySelector(selector);
        if (direct || actionName === 'apply') return direct;
        const header = [...document.querySelectorAll('header')].find(item =>
          [...item.querySelectorAll('h1,h2,h3,h4,span')].some(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)))
        );
        const headerChange = header
          ? [...header.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)))
          : null;
        if (headerChange) return headerChange;
        const title = [...document.querySelectorAll('h1,h2,h3,h4,span')].find(el => /^\s*\u30b9\u30c8\u30a2\u304b\u3089\u306e\u78ba\u8a8d\u4e8b\u9805\s*$/.test(getText(el)));
        const container = title?.closest?.('section, li, div');
        return container
          ? [...container.querySelectorAll(controlSelector)].find(el => /^\s*\u5909\u66f4\s*$/.test(getText(el)))
          : null;
      };
      const target = findStoreConfirmationChange();
      if (!target) return { success: false, error: `store confirmation ${actionName} click point not found` };
      target.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return { success: false, error: `store confirmation ${actionName} has no clickable rect` };
      return {
        success: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        text: getText(target)
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || `store confirmation ${action} click point not found` };
}

async function dispatchTrustedStoreConfirmationClick(tab, action) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for store confirmation trusted click' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);

  let point = await getStoreConfirmationClickPoint(tabId, action);
  const waitUntil = Date.now() + 15000;
  while (!point?.success && Date.now() < waitUntil) {
    await sleep(500);
    point = await getStoreConfirmationClickPoint(tabId, action);
  }
  if (!point?.success) return point;

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await sleep(500);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action: `storeConfirmation:${action}`,
      method: 'debuggerMouse',
      message: 'trusted store confirmation mouse click dispatched',
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouse,action=storeConfirmation:${action},tabId=${tabId},text=${point.text || ''}`
    });
    return { success: true, method: 'debuggerMouse', text: point.text };
  } catch (e) {
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action: `storeConfirmation:${action}`,
      method: 'debuggerMouse',
      message: e.message || `store confirmation ${action} trusted click failed`,
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouse,action=storeConfirmation:${action},tabId=${tabId},error=${e.message || e}`
    });
    return { success: false, error: e.message || `store confirmation ${action} trusted click failed` };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function completeStoreConfirmationItems(tab, state, job = {}) {
  if (!tab?.id || !state?.hasStoreConfirmationSection) return { success: true, tab, state };

  const previousTabIds = await getTabIds();
  let changeResult = await clickStoreConfirmationChange(tab.id);
  if (!changeResult?.success) changeResult = await dispatchTrustedStoreConfirmationClick(tab, 'change');
  if (!changeResult?.success) return { success: false, error: changeResult?.error || 'store confirmation change click failed', tab };
  let editTab = null;
  try {
    editTab = await waitForPaymentStateAcrossTabs(tab, nextState =>
      nextState.hasStoreConfirmationEditPage,
      previousTabIds,
      15000
    );
  } catch (e) {
    const trustedChange = await dispatchTrustedStoreConfirmationClick(tab, 'change');
    if (!trustedChange?.success) {
      return { success: false, error: `store confirmation edit page did not appear after js click; trusted=${trustedChange?.error || 'failed'}: ${e.message || e}`, tab };
    }
    try {
      editTab = await waitForPaymentStateAcrossTabs(tab, nextState =>
        nextState.hasStoreConfirmationEditPage,
        previousTabIds,
        15000
      );
    } catch (afterJsError) {
      return { success: false, error: `store confirmation edit page did not appear after js+trusted click: ${afterJsError.message || afterJsError}`, tab };
    }
  }

  const readyResult = await waitForStoreConfirmationFormReady(editTab.id);
  if (!readyResult?.success) return { success: false, error: readyResult?.error || 'store confirmation form not ready', tab: editTab };
  const checkboxResult = await checkAllStoreConfirmationItemsAndApply(editTab.id, false);
  if (!checkboxResult?.success) return { success: false, error: checkboxResult?.error || 'store confirmation checkbox click failed', tab: editTab };
  await sleep(800);

  const waitForReviewAfterApply = timeoutMs => waitForPaymentStateAcrossTabs(editTab, nextState =>
      nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
      previousTabIds,
      timeoutMs
    );

  const jsApply = await clickStoreConfirmationApplyButton(editTab.id);
  if (!jsApply?.success) return { success: false, error: jsApply?.error || 'store confirmation apply click failed', tab: editTab };
  try {
    const reviewTab = await waitForReviewAfterApply(8000);
    await injectContentScript(reviewTab.id).catch(() => {});
    return { success: true, tab: reviewTab, state: reviewTab._gdaipaiPaymentState || await getPaymentPageState(reviewTab.id) };
  } catch (jsError) {
    return { success: false, error: `store confirmation review page did not return after JS click: ${jsError.message || jsError}`, tab: editTab };
  }
}

function isYahooTransactionCancelledText(text = '') {
  const source = String(text || '');
  return /\u843d\u672d\u8005\u524a\u9664/.test(source) ||
    /\u843d\u672d\u8005\u524a\u9664[\s\S]{0,80}\u53d6\u5f15\u306f\u3067\u304d\u307e\u305b\u3093/.test(source) ||
    /\u53d6\u5f15\u304c\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(source) ||
    /\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(source);
}

function isYahooConfirmReceiptCompleteText(text = '') {
  const source = String(text || '');
  return /\u3059\u3079\u3066\u306e\u53d6\u5f15\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(source) ||
    /\u5168\u3066\u306e\u53d6\u5f15\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(source) ||
    /\u51fa\u54c1\u8005\u306b\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(source) ||
    /\u51fa\u54c1\u8005\u306b\u53d7\u53d6\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(source) ||
    /\u53d7\u3051\u53d6\u308a\u9023\u7d61\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(source) ||
    /\u53d7\u53d6\u9023\u7d61\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(source);
}

function buildConfirmReceiptPageStateFromSnapshot(snapshot = {}) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const text = normalize(snapshot.bodyText || '');
  const transactionStatusText = normalize(snapshot.transactionStatusText || snapshot.primaryStatusText || '');
  const lifecycleText = transactionStatusText || text;
  const controls = Array.isArray(snapshot.controls) ? snapshot.controls.map(item => String(item || '').replace(/\s+/g, ' ').trim()) : [];
  const cancelled = isYahooTransactionCancelledText(lifecycleText);
  const transactionNavRendered = (
    /\u53d6\u5f15\u30ca\u30d3/.test(text) &&
    /\u8cfc\u5165/.test(text) &&
    /\u304a\u652f\u6255\u3044/.test(text) &&
    /\u767a\u9001\u9023\u7d61/.test(text)
  );
  const transactionDetailRendered = /\u53d6\u5f15\u60c5\u5831/.test(text) || /\u53d6\u5f15\u306e\u72b6\u6cc1/.test(text);
  const paidOrShipped = (
    /\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(lifecycleText) &&
    /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(lifecycleText)
  ) || (
    /\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(lifecycleText) &&
    /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(lifecycleText)
  ) || (
    /\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f/.test(lifecycleText) &&
    /\u5230\u7740\u307e\u3067\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(lifecycleText)
  ) || (
    /\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f/.test(lifecycleText) &&
    /\u5230\u7740\u3057\u305f\u3089\u3001\u53d7\u3051\u53d6\u308a\u9023\u7d61\u3092\u3057\u3066\u304f\u3060\u3055\u3044/.test(lifecycleText)
  );
  return {
    url: snapshot.url || '',
    transactionStatusText,
    textSample: text.slice(0, 500),
    cancelled,
    paidOrShipped,
    complete: isYahooConfirmReceiptCompleteText(lifecycleText),
    rendered: transactionNavRendered && transactionDetailRendered,
    hasReceiptCheckbox: /\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f/.test(text) || Boolean(snapshot.hasReceiptCheckbox),
    hasReceiptCheckboxChecked: Boolean(snapshot.hasReceiptCheckboxChecked),
    hasReceiptSubmitButton: controls.some(value => /\u53d7\u3051\u53d6\u308a\u9023\u7d61/.test(value)) || Boolean(snapshot.hasReceiptSubmitButton),
    receiptSubmitButtonDisabled: Boolean(snapshot.receiptSubmitButtonDisabled)
  };
}

async function getConfirmReceiptPageState(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
        .map(el => getText(el))
        .filter(Boolean);
      const isLifecycleStatusText = text => (
        /\u843d\u672d\u304a\u3081\u3067\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(text) ||
        /\u8cfc\u5165\u624b\u7d9a\u304d\u3092\u884c\u3063\u3066\u304f\u3060\u3055\u3044/.test(text) ||
        /\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(text) ||
        /\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(text) ||
        /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(text) ||
        /\u5546\u54c1\u304c\u767a\u9001\u3055\u308c\u307e\u3057\u305f/.test(text) ||
        /\u51fa\u54c1\u8005\u304b\u3089\u5546\u54c1\u767a\u9001\u306e\u9023\u7d61\u304c\u3042\u308a\u307e\u3057\u305f/.test(text) ||
        /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(text) ||
        /\u305f\u3060\u3044\u307e\u6c7a\u6e08\u51e6\u7406\u4e2d\u3067\u3059/.test(text) ||
        /\u843d\u672d\u8005\u524a\u9664/.test(text) ||
        /\u53d6\u5f15\u304c\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(text) ||
        /\u30ad\u30e3\u30f3\u30bb\u30eb\u3055\u308c\u307e\u3057\u305f/.test(text) ||
        /\u3059\u3079\u3066\u306e\u53d6\u5f15\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(text) ||
        /\u5168\u3066\u306e\u53d6\u5f15\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(text)
      );
      const extractPrimaryTransactionStatusText = () => {
        const normalStatus = [...document.querySelectorAll('.acMdStatusCmt .elAdvnc p.fntB')]
          .map(el => getText(el))
          .filter(Boolean);
        if (normalStatus.length) return normalize(normalStatus.join('\n'));

        const storeStatus = [...document.querySelectorAll('main header p.sc-5968173-0 span, main header p.sc-5968173-0')]
          .map(el => getText(el))
          .find(text => text && isLifecycleStatusText(text));
        if (storeStatus) return storeStatus;

        const purchaseAction = document.querySelector('#pap');
        let node = purchaseAction?.previousElementSibling || null;
        let depth = 0;
        while (node && depth < 8) {
          const text = getText(node);
          if (text && text.length < 240 && isLifecycleStatusText(text)) return text;
          node = node.previousElementSibling;
          depth += 1;
        }
        return '';
      };
      const transactionStatusText = extractPrimaryTransactionStatusText();
      const isVisible = el => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!(rect && rect.width > 0 && rect.height > 0);
      };
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')]
        .find(input => {
          const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
          const container = input.closest('label, li, div, section');
          return /\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f/.test(getText(label) || getText(container));
        });
      const receiptButtons = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
        .filter(el => /\u53d7\u3051\u53d6\u308a\u9023\u7d61/.test(getText(el)));
      const isDisabled = el => Boolean(
        el?.disabled ||
        el?.getAttribute?.('disabled') !== null ||
        el?.getAttribute?.('aria-disabled') === 'true' ||
        /\b(jsOffReceiveButton|libBtnDisL)\b/.test(String(el?.className || ''))
      );
      const activeReceiptButton = receiptButtons.find(el =>
        isVisible(el) &&
        !isDisabled(el) &&
        (/\bjsOnReceiveButton\b/.test(String(el.className || '')) || !/\bjsOffReceiveButton\b/.test(String(el.className || '')))
      );
      const visibleReceiptButton = receiptButtons.find(isVisible);
      return {
        success: true,
        snapshot: {
          url: location.href,
          bodyText: normalize(document.body?.textContent || ''),
          transactionStatusText,
          controls,
          hasReceiptCheckbox: Boolean(checkbox),
          hasReceiptCheckboxChecked: Boolean(checkbox?.checked),
          hasReceiptSubmitButton: Boolean(activeReceiptButton),
          receiptSubmitButtonDisabled: Boolean(visibleReceiptButton && !activeReceiptButton)
        }
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  if (!result?.success) return null;
  return buildConfirmReceiptPageStateFromSnapshot(result.snapshot || {});
}

async function waitForConfirmReceiptRenderedState(
  tabId,
  timeoutMs = CONFIRM_RECEIPT_CANCEL_CHECK_RENDER_WAIT_MS,
  pollMs = CONFIRM_RECEIPT_CANCEL_CHECK_POLL_MS
) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / pollMs));
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await getConfirmReceiptPageState(tabId);
    if (
      latest?.rendered ||
      latest?.cancelled ||
      latest?.paidOrShipped ||
      latest?.complete ||
      latest?.hasReceiptCheckbox ||
      latest?.hasReceiptSubmitButton
    ) {
      return latest;
    }
    if (attempt < attempts - 1) await sleep(pollMs);
  }
  return latest;
}

async function waitForConfirmReceiptCancelCheckState(tabId, timeoutMs, pollMs) {
  return waitForConfirmReceiptRenderedState(tabId, timeoutMs, pollMs);
}

async function clickConfirmReceiptCheckbox(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')]
        .find(input => {
          const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
          const container = input.closest('label, li, div, section');
          return /\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f/.test(getText(label) || getText(container));
        });
      if (!checkbox) return { success: false, error: 'receipt checkbox not found' };
      const label = checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) : null;
      const target = label || checkbox.closest('label, li, div') || checkbox;
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      target.scrollIntoView?.({ block: 'center', inline: 'center' });
      target.focus?.();
      if (typeof PointerEvent !== 'undefined') target.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      target.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      if (typeof PointerEvent !== 'undefined') target.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      target.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      target.click?.();
      if (!checkbox.checked) checkbox.click?.();
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'receipt checkbox click returned no result' };
}

async function getConfirmReceiptCheckboxClickPoint(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const isVisible = el => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!(rect && rect.width > 0 && rect.height > 0);
      };
      const checkbox = [...document.querySelectorAll('input[type="checkbox"]')]
        .find(input => {
          const label = input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
          const container = input.closest('label, li, div, section, p');
          return /\u5546\u54c1\u3092\u53d7\u3051\u53d6\u308a\u307e\u3057\u305f/.test(getText(label) || getText(container));
        });
      if (!checkbox) return { success: false, error: 'receipt checkbox not found for trusted click' };
      const label = checkbox.id ? document.querySelector(`label[for="${CSS.escape(checkbox.id)}"]`) : null;
      const target = [checkbox, label, checkbox.closest('label, li, div, section, p')].find(isVisible) || checkbox;
      target.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = target.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { success: false, error: 'receipt checkbox has no clickable rect' };
      }
      return {
        success: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        text: getText(target)
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'receipt checkbox point not found' };
}

async function dispatchTrustedConfirmReceiptCheckboxClick(tab) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for trusted receipt checkbox click' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);

  const point = await getConfirmReceiptCheckboxClickPoint(tabId);
  if (!point?.success) return point;

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await sleep(300);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action: 'confirmReceiptCheckbox',
      method: 'debuggerMouse',
      message: 'trusted confirm receipt checkbox click dispatched',
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouse,action=confirmReceiptCheckbox,tabId=${tabId},text=${point.text || ''}`
    });
    return { success: true, method: 'debuggerMouse', text: point.text };
  } catch (e) {
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action: 'confirmReceiptCheckbox',
      method: 'debuggerMouse',
      message: e.message || 'trusted receipt checkbox mouse click failed',
      url: currentTab?.url || '',
      diagnostics: `method=debuggerMouse,action=confirmReceiptCheckbox,tabId=${tabId},error=${e.message || e}`
    });
    return { success: false, error: e.message || 'trusted receipt checkbox mouse click failed' };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function clickConfirmReceiptSubmit(tabId) {
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => normalize([
        el?.textContent,
        el?.value,
        el?.title,
        el?.getAttribute?.('aria-label')
      ].filter(Boolean).join(' '));
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')];
      const isVisible = el => {
        if (!el) return false;
        const style = window.getComputedStyle?.(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
        const rect = el.getBoundingClientRect?.();
        return !!(rect && rect.width > 0 && rect.height > 0);
      };
      const isDisabled = el => Boolean(
        el?.disabled ||
        el?.getAttribute?.('disabled') !== null ||
        el?.getAttribute?.('aria-disabled') === 'true' ||
        /\b(jsOffReceiveButton|libBtnDisL)\b/.test(String(el?.className || ''))
      );
      const matches = controls.filter(el => /\u53d7\u3051\u53d6\u308a\u9023\u7d61/.test(getText(el)));
      const button = matches.find(el => /\bjsOnReceiveButton\b/.test(String(el.className || '')) && isVisible(el) && !isDisabled(el)) ||
        matches.find(el => isVisible(el) && !isDisabled(el) && !/\bjsOffReceiveButton\b/.test(String(el.className || '')));
      if (!button) return { success: false, error: 'receipt submit button not found' };
      if (isDisabled(button) || !isVisible(button)) {
        return { success: false, error: 'receipt submit button disabled' };
      }
      const type = String(button.type || '').toLowerCase();
      if (button.form && typeof button.form.requestSubmit === 'function' && (type === 'submit' || (!type && button.tagName === 'BUTTON'))) {
        button.form.requestSubmit(button);
        return { success: true, method: 'requestSubmit', text: getText(button) };
      }
      const eventOptions = { bubbles: true, cancelable: true, view: window };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.focus?.();
      if (typeof PointerEvent !== 'undefined') button.dispatchEvent(new PointerEvent('pointerdown', eventOptions));
      button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
      if (typeof PointerEvent !== 'undefined') button.dispatchEvent(new PointerEvent('pointerup', eventOptions));
      button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
      button.click?.();
      button.dispatchEvent(new MouseEvent('click', eventOptions));
      return { success: true, method: 'click', text: getText(button) };
    }
  });
  return injectionResult?.[0]?.result || { success: false, error: 'receipt submit click returned no result' };
}

async function waitForConfirmReceiptState(tab, predicate, timeoutMs = 15000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => null) : null;
    if (current?.status === 'complete') {
      const state = await getConfirmReceiptPageState(current.id).catch(() => null);
      if (state && predicate(state)) {
        current._gdaipaiCreatedTabIds = tab?._gdaipaiCreatedTabIds;
        current._gdaipaiConfirmReceiptState = state;
        return current;
      }
    }
    await sleep(500);
  }
  return null;
}

async function clickPaymentActionAndFollowTab(tab, action, waitFor, options = {}) {
  const allowMissingTrustedPointRetry = options.allowMissingTrustedPointRetry !== false;
  const previousTabIds = await getTabIds();
  const clickResult = await runMainWorldPaymentActionClick(tab.id, action);
  if (!clickResult?.success) {
    return { success: false, error: clickResult?.error || `payment ${action} click failed`, tab };
  }
  try {
    const nextTab = await waitForPaymentStateAcrossTabs(tab, waitFor, previousTabIds, 10000);
    await injectContentScript(nextTab.id).catch(() => {});
    return { success: true, tab: nextTab, state: nextTab._gdaipaiPaymentState };
  } catch (e) {
    console.warn('[Yahoo Bid] Payment synthetic click did not reach next state, trying trusted mouse click:', e.message || e);
    const trustedClick = await dispatchTrustedPaymentActionClick(tab, action);
    console.log('[Yahoo Bid] Trusted payment mouse click result:', trustedClick);
    if (!trustedClick?.success) {
      if (allowMissingTrustedPointRetry && action === 'review' && /payment button not found for trusted click/.test(String(trustedClick?.error || ''))) {
        try {
          const delayedNextTab = await waitForPaymentStateAcrossTabs(tab, waitFor, previousTabIds, 3000);
          await injectContentScript(delayedNextTab.id).catch(() => {});
          return { success: true, tab: delayedNextTab, state: delayedNextTab._gdaipaiPaymentState };
        } catch (_) {
          const currentState = tab?.id ? await getPaymentPageState(tab.id).catch(() => null) : null;
          if (currentState?.hasReviewButton) {
            await sleep(1000);
            return clickPaymentActionAndFollowTab(tab, action, waitFor, { allowMissingTrustedPointRetry: false });
          }
        }
      }
      return { success: false, error: trustedClick?.error || clickResult?.error || `payment ${action} click failed`, tab };
    }
    try {
      const nextTab = await waitForPaymentStateAcrossTabs(tab, waitFor, previousTabIds, 30000);
      await injectContentScript(nextTab.id).catch(() => {});
      return { success: true, tab: nextTab, state: nextTab._gdaipaiPaymentState };
    } catch (afterTrustedError) {
      const currentState = tab?.id ? await getPaymentPageState(tab.id).catch(() => null) : null;
      return {
        success: false,
        error: formatPaymentClickDiagnostics(action, clickResult, trustedClick, currentState, afterTrustedError),
        tab
      };
    }
  }
}

async function completePaymentTransactionInfoInput(tab, initialState = null) {
  let state = initialState || await getPaymentPageState(tab.id);
  if (!state?.hasTransactionInfoInputButton) {
    return { success: true, tab, state };
  }

  let result = await clickPaymentActionAndFollowTab(tab, 'transactionInfoInput', nextState =>
    nextState.alreadyPaid || nextState.complete || nextState.hasPlacementOkButton || nextState.hasTransactionDecideButton
  );
  if (!result?.success) return result;
  tab = result.tab;
  state = result.state;

  if (state?.alreadyPaid || state?.complete) return { success: true, tab, state };
  if (state?.hasPlacementOkButton) {
    result = await clickPaymentActionAndFollowTab(tab, 'placementOk', nextState =>
      nextState.alreadyPaid || nextState.complete || nextState.hasTransactionDecideButton
    );
    if (!result?.success) return result;
    tab = result.tab;
    state = result.state;
  }

  if (state?.alreadyPaid || state?.complete) return { success: true, tab, state };
  if (!state?.hasTransactionDecideButton) {
    return { success: false, error: 'transaction info decide button not found', tab };
  }

  result = await clickPaymentActionAndFollowTab(tab, 'transactionDecide', nextState =>
    nextState.alreadyPaid || nextState.complete || nextState.hasTransactionConfirmButton
  );
  if (!result?.success) return result;
  tab = result.tab;
  state = result.state;

  if (state?.alreadyPaid || state?.complete) return { success: true, tab, state };
  if (!state?.hasTransactionConfirmButton) {
    return { success: false, error: 'transaction info confirm button not found', tab };
  }

  result = await clickPaymentActionAndFollowTab(tab, 'transactionConfirm', nextState =>
    nextState.alreadyPaid ||
    nextState.complete ||
    nextState.hasEasyPaymentButton ||
    nextState.hasPurchaseProcedureButton ||
    nextState.hasReviewButton
  );
  if (!result?.success) return result;
  return { success: true, tab: result.tab, state: result.state };
}

async function reportYahooLoginStatus(loginStatus) {
  if (!loginStatus?.status) return;
  try {
    await apiFetch('/api/plugin/yahoo-login/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: loginStatus.status,
        message: loginStatus.message || ''
      })
    });
  } catch (e) {
    logBackgroundIssue('[Yahoo Bid] Failed to report Yahoo login status:', e);
  }
}

async function refreshPluginConfig() {
  try {
    const res = await apiFetch('/api/plugin/config');
    const config = await res.json();
    pluginConfigFetchFailureCount = 0;
    applyPluginConfig(config);
  } catch (e) {
    pluginConfigFetchFailureCount += 1;
    if (pluginConfigFetchFailureCount === 1 || pluginConfigFetchFailureCount % 6 === 0) {
      logBackgroundIssue('[Yahoo Bid] Failed to refresh plugin config:', e);
    } else {
      console.debug('[Yahoo Bid] Failed to refresh plugin config:', e.message || e);
    }
  }
}

function normalizeWorkerIntervalMs(value) {
  const interval = Math.floor(Number(value));
  return Number.isFinite(interval) && interval >= 1000 ? interval : DEFAULT_POLL_INTERVAL_MS;
}

function schedulePollingInterval() {
  if (pollIntervalTimerId !== null && pollIntervalTimerId !== undefined) {
    clearInterval(pollIntervalTimerId);
  }
  pollIntervalTimerId = setInterval(pollAndExecute, pollIntervalMs);
  return pollIntervalTimerId;
}

function applyPluginConfig(config = {}) {
  const intervalMinutes = Number(config?.idleSyncIntervalMinutes || 5);
  idleSyncIntervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  bidConcurrencyLimit = Math.max(1, Math.min(10, Math.floor(Number(config?.bidConcurrencyLimit || 2))));
  const nextPollIntervalMs = normalizeWorkerIntervalMs(config?.workerIntervalMs);
  if (nextPollIntervalMs !== pollIntervalMs) {
    pollIntervalMs = nextPollIntervalMs;
    if (pollIntervalTimerId !== null && pollIntervalTimerId !== undefined) {
      schedulePollingInterval();
      console.log('[Yahoo Bid] Poll interval updated to', pollIntervalMs / 1000, 's');
    }
  }
}

async function openWonPageForSync(options = {}) {
  const closeAfter = options.closeAfter === true;
  const [existingTab] = closeAfter ? [] : await chrome.tabs.query({ url: '*://auctions.yahoo.co.jp/my/won*' });
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: 'https://auctions.yahoo.co.jp/my/won', active: false })
    : await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/won', active: false });
  try {
    if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
    await sleep(3000);
    const injected = await injectContentScript(tab.id, { ignoreMissingTab: closeAfter });
    if (!injected) return null;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ORDER_HISTORY' }).catch(error => {
      if (closeAfter && (isContentScriptTargetGoneError(error) || isMessageChannelClosed(error))) {
        console.warn('[Yahoo Bid] Skip order history sync because message receiver is gone:', tab.id, error.message || error);
        return null;
      }
      console.error('[Yahoo Bid] Failed to extract order history:', error);
      return null;
    });
    await reportYahooLoginStatus(response?.loginStatus);
    if (response?.success) {
      return await syncOrderHistory(response.orders || []);
    }
    return null;
  } finally {
    if (closeAfter && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function parseYahooWonTimeMs(wonTimeText, nowMs = Date.now()) {
  const match = String(wonTimeText || '').trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const now = new Date(nowMs);
  let date = new Date(now.getFullYear(), Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  if (date.getTime() - nowMs > 24 * 60 * 60 * 1000) {
    date = new Date(now.getFullYear() - 1, Number(match[1]) - 1, Number(match[2]), Number(match[3]), Number(match[4]), 0);
  }
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function getLocalDateStartMs(dateText) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0).getTime();
}

function getLocalDateEndMs(dateText) {
  const match = String(dateText || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999).getTime();
}

async function extractManualImportPage(tabId) {
  await injectContentScript(tabId).catch(() => {});
  return await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_ORDER_IMPORT_PAGE' }).catch(error => ({
    success: false,
    error: error.message || 'manual import page extraction failed'
  }));
}

async function getProductSnapshotForImport(productId, productUrl) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: productUrl || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
      active: false
    });
    if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
    await sleep(1500);
    await injectContentScript(tab.id).catch(() => {});
    const snapshot = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_PRODUCT_SNAPSHOT',
      auctionId: productId
    }).catch(() => null);
    return snapshot?.auctionId ? snapshot : null;
  } finally {
    if (tab?.id) await closeTabIfExists(tab.id);
  }
}

async function executeManualOrderImportJob(job) {
  const batchId = job?.batchId;
  const maxPages = Math.max(1, Math.min(50, Number(job?.maxPages || 10)));
  const startMs = getLocalDateStartMs(job?.startDate);
  const endMs = getLocalDateEndMs(job?.endDate);
  if (!batchId || !startMs || !endMs) {
    throw new Error('manual import job has invalid date range');
  }

  let tab = null;
  const itemsByProduct = new Map();
  let scannedPages = 0;
  let shouldStop = false;
  try {
    tab = await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/won', active: false });
    for (let page = 0; page < maxPages && !shouldStop; page += 1) {
      if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
      await sleep(2500);
      const pageResult = await extractManualImportPage(tab.id);
      await reportYahooLoginStatus(pageResult?.loginStatus);
      if (!pageResult?.success) {
        throw new Error(pageResult?.error || pageResult?.loginStatus?.message || 'manual import page extraction failed');
      }
      scannedPages += 1;
      for (const order of pageResult.orders || []) {
        const productId = normalizeAuctionId(order.productId || order.url);
        if (!productId) continue;
        const wonMs = parseYahooWonTimeMs(order.wonTimeText);
        if (!wonMs) continue;
        if (wonMs < startMs) {
          shouldStop = true;
          continue;
        }
        if (wonMs > endMs) continue;
        if (itemsByProduct.has(productId)) continue;
        itemsByProduct.set(productId, {
          productId,
          productUrl: order.url || `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
          productTitle: order.title || productId,
          finalPrice: order.price || '',
          wonAt: new Date(wonMs).toISOString(),
          wonTimeText: order.wonTimeText || '',
          transactionUrl: order.transactionUrl || '',
          productType: order.productType || order.product_type || ''
        });
      }
      if (shouldStop || !pageResult.nextPageUrl) break;
      await chrome.tabs.update(tab.id, { url: pageResult.nextPageUrl, active: false });
    }

    const items = [];
    for (const item of itemsByProduct.values()) {
      const snapshot = await getProductSnapshotForImport(item.productId, item.productUrl);
      const productType = item.productType === 'store' || snapshot?.productType === 'store' ? 'store' : 'normal';
      items.push({
        ...item,
        productTitle: snapshot?.title || item.productTitle,
        productImageUrl: snapshot?.imageUrl || '',
        shippingFeeText: snapshot?.shippingFeeText || '',
        taxType: snapshot?.taxType || 'tax_zero',
        productType
      });
    }

    await updateManualOrderImportStatus({
      batchId,
      status: 'ready',
      scannedPages,
      items
    });
    return { success: true, scannedPages, count: items.length };
  } catch (error) {
    await updateManualOrderImportStatus({
      batchId,
      status: 'failed',
      scannedPages,
      error: error?.message || String(error || 'manual import failed')
    }).catch(() => {});
    throw error;
  } finally {
    if (tab?.id) await closeTabIfExists(tab.id);
  }
}

async function runManualOrderImportJobs() {
  const job = await fetchManualOrderImportJob();
  if (!job) return false;
  await executeManualOrderImportJob(job);
  return true;
}

async function openBiddingPageForSync(options = {}) {
  const closeAfter = options.closeAfter === true;
  const [existingTab] = closeAfter ? [] : await chrome.tabs.query({ url: '*://auctions.yahoo.co.jp/my/bidding*' });
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: 'https://auctions.yahoo.co.jp/my/bidding', active: false })
    : await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/bidding', active: false });
  try {
    const itemsByProduct = new Map();
    for (let page = 0; page < BIDDING_SYNC_MAX_PAGES; page += 1) {
      if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
      await sleep(3000);
      const injected = await injectContentScript(tab.id, { ignoreMissingTab: closeAfter });
      if (!injected) return null;
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_BIDDING_ITEMS' }).catch(error => {
        if (closeAfter && (isContentScriptTargetGoneError(error) || isMessageChannelClosed(error))) {
          console.warn('[Yahoo Bid] Skip bidding sync because message receiver is gone:', tab.id, error.message || error);
          return null;
        }
        console.error('[Yahoo Bid] Failed to extract bidding items:', error);
        return null;
      });
      await reportYahooLoginStatus(response?.loginStatus);
      if (!response?.success) return null;
      for (const item of response.items || []) {
        const match = String(item?.url || item?.productId || '').match(/[a-zA-Z]?\d{8,10}/);
        if (!match) continue;
        itemsByProduct.set(match[0].toLowerCase(), item);
      }
      if (!response.nextPageUrl) break;
      await chrome.tabs.update(tab.id, { url: response.nextPageUrl, active: false });
    }
    await syncBiddingItems([...itemsByProduct.values()]);
  } finally {
    if (closeAfter && tab?.id) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function isBidderPaysShippingText(value) {
  return /\u843d\u672d\u8005\u8ca0\u62c5/.test(String(value || ''));
}

function isManualCaptchaTab(tab) {
  const url = String(tab?.url || '');
  return /:\/\/login\.yahoo\.co\.jp\/ncaptcha/i.test(url);
}

function isManualVerificationTab(tab) {
  return isManualCaptchaTab(tab) || isLikelyManualPinTab(tab);
}

function isLikelyManualPinTab(tab) {
  const url = String(tab?.url || '');
  if (!url || isManualCaptchaTab(tab)) return false;
  if (!/:\/\/(?:login|account\.edit)\.yahoo\.co\.jp\//i.test(url)) return false;
  if (isYahooAuthLevelPinUrl(url)) return true;
  return /(?:verify|pin|auth|challenge|confirm|security|code)/i.test(url);
}

function isYahooAuthLevelPinUrl(url) {
  return /:\/\/login\.yahoo\.co\.jp\/config\/login/i.test(String(url || '')) &&
    /(?:[?&]auth_lv=1|[?&]src=auc|[?&]done=)/i.test(String(url || ''));
}

function buildManualVerificationId(type, tab, context = {}) {
  const productId = String(context.productId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'unknown';
  const prefix = type === 'pin' ? 'pin' : 'captcha';
  return `${prefix}-${productId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getOpenManualPinTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  return tabs.filter(isLikelyManualPinTab);
}

async function getOpenManualVerificationTabs() {
  const tabs = await chrome.tabs.query({}).catch(() => []);
  return tabs.filter(tab => isManualVerificationTab(tab) && !ignoredManualVerificationTabIds.has(tab.id));
}

async function getManualVerificationLockedTab() {
  if (!manualVerificationTabId) return null;
  const tab = await chrome.tabs.get(manualVerificationTabId).catch(() => null);
  if (tab && isManualVerificationTab(tab)) return tab;
  manualVerificationTabId = null;
  return null;
}

function rememberManualVerificationTab(tab) {
  if (tab?.id && isManualVerificationTab(tab)) {
    manualVerificationTabId = tab.id;
    ignoredManualVerificationTabIds.delete(tab.id);
    manualVerificationFlowActive = true;
  }
}

function ignoreDuplicateManualVerificationTabs(tabs = [], keepTab = null) {
  const keepId = keepTab?.id || null;
  for (const tab of tabs) {
    if (!tab?.id || tab.id === keepId) continue;
    if (isLikelyManualPinTab(tab)) ignoredManualVerificationTabIds.add(tab.id);
  }
}

async function keepSingleManualPinTab(tabs) {
  const pinTabs = Array.isArray(tabs) ? tabs.filter(isLikelyManualPinTab) : [];
  if (!pinTabs.length) return null;
  const keep = pinTabs.find(tab => tab.active) || pinTabs[0];
  for (const tab of pinTabs) {
    if (tab.id && tab.id !== keep.id) {
      await closeTabIfExists(tab.id);
    }
  }
  if (keep?.id) {
    await chrome.tabs.update(keep.id, { active: true }).catch(() => {});
  }
  return keep;
}

async function ensureManualPinChallenge(tab, context = {}) {
  if (!tab?.id || !isLikelyManualPinTab(tab)) return { posted: false };
  const current = await fetchCurrentManualCaptchaChallenge().catch(() => null);
  if (current?.found && current.type === 'pin' && !current.answered) {
    const currentPageUrl = String(current.pageUrl || '');
    if (!currentPageUrl || currentPageUrl === String(tab.url || '')) {
      return { posted: false, existing: true, id: current.id || '' };
    }
  }
  const id = buildManualVerificationId('pin', tab, context);
  await postManualCaptchaChallenge({
    id,
    type: 'pin',
    message: 'Yahoo 需要 PIN 码验证，请输入 PIN 码',
    pageUrl: tab.url || '',
    productId: context.productId || current?.productId || '',
    source: context.source || ''
  });
  return { posted: true, id };
}

async function closeStaleManualChallengeIfVerificationGone(verificationTabs = []) {
  if (Array.isArray(verificationTabs) && verificationTabs.length) return false;
  const current = await fetchCurrentManualCaptchaChallenge().catch(() => null);
  if (!current?.found || !current.id) return false;
  const shouldClose = current.type === 'pin' || current.answered;
  if (!shouldClose) return false;
  await closeManualCaptchaChallenge(current.id);
  console.warn('[Yahoo Bid] Closed stale manual verification challenge because no PIN/captcha page remains:', current.id);
  return true;
}

async function pauseIdleWorkForOpenManualPin() {
  const lockedTab = await getManualVerificationLockedTab();
  if (lockedTab?.id) {
    manualVerificationFlowActive = true;
    await chrome.tabs.update(lockedTab.id, { active: true }).catch(() => {});
    if (isManualCaptchaTab(lockedTab)) {
      console.warn('[Yahoo Bid] Manual captcha tab is active; handling captcha before other idle work:', lockedTab.id);
      await handleManualVerificationIfPresent(lockedTab, {
        source: 'idle_manual_verification'
      }).catch(error => {
        console.warn('[Yahoo Bid] Manual captcha handling failed during idle pause:', error?.message || error);
      });
      return true;
    }
    const resumed = await resumeAnsweredManualPinChallenge(lockedTab, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual PIN resume failed during idle pause:', error?.message || error);
      return null;
    });
    if (resumed?.handled) return true;
    if (isLikelyManualPinTab(lockedTab)) {
      await ensureManualPinChallenge(lockedTab, {
        source: 'idle_manual_verification'
      }).catch(error => {
        console.warn('[Yahoo Bid] Manual PIN challenge sync failed during idle pause:', error?.message || error);
      });
    }
    console.warn('[Yahoo Bid] Manual verification flow is active; idle non-bid work paused:', lockedTab.id);
    return true;
  }

  const verificationTabs = await getOpenManualVerificationTabs();
  const pinTabs = verificationTabs.filter(isLikelyManualPinTab);
  const captchaTabs = verificationTabs.filter(isManualCaptchaTab);
  if (!verificationTabs.length) {
    await closeStaleManualChallengeIfVerificationGone(verificationTabs);
  }
  if (verificationTabs.length) {
    manualVerificationFlowActive = true;
  } else if (manualVerificationFlowActive) {
    manualVerificationFlowActive = false;
  }
  if (!manualVerificationFlowActive) return false;
  const activeVerification = verificationTabs.find(tab => tab.active) || null;
  if (activeVerification?.id && isLikelyManualPinTab(activeVerification)) {
    const keep = await keepSingleManualPinTab(pinTabs);
    rememberManualVerificationTab(keep || activeVerification);
    const pinTab = keep || activeVerification;
    const resumed = await resumeAnsweredManualPinChallenge(pinTab, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual PIN resume failed during idle pause:', error?.message || error);
      return null;
    });
    if (resumed?.handled) return true;
    await ensureManualPinChallenge(pinTab, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual PIN challenge sync failed during idle pause:', error?.message || error);
    });
    console.warn('[Yahoo Bid] Manual PIN tab is active; idle non-bid work paused:', pinTab?.id || '');
    return true;
  }
  const captcha = captchaTabs.find(tab => tab.active) || captchaTabs[0] || null;
  if (captcha?.id) {
    rememberManualVerificationTab(captcha);
    console.warn('[Yahoo Bid] Manual captcha tab is active; handling captcha before other idle work:', captcha.id);
    await chrome.tabs.update(captcha.id, { active: true }).catch(() => {});
    await handleManualVerificationIfPresent(captcha, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual captcha handling failed during idle pause:', error?.message || error);
    });
    return true;
  }
  const keep = pinTabs.length ? await keepSingleManualPinTab(pinTabs) : (captchaTabs.find(tab => tab.active) || captchaTabs[0] || null);
  rememberManualVerificationTab(keep);
  if (keep?.id && isLikelyManualPinTab(keep)) {
    const resumed = await resumeAnsweredManualPinChallenge(keep, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual PIN resume failed during idle pause:', error?.message || error);
      return null;
    });
    if (resumed?.handled) return true;
    await ensureManualPinChallenge(keep, {
      source: 'idle_manual_verification'
    }).catch(error => {
      console.warn('[Yahoo Bid] Manual PIN challenge sync failed during idle pause:', error?.message || error);
    });
  }
  console.warn('[Yahoo Bid] Manual verification flow is active; idle non-bid work paused:', keep?.id || '');
  return true;
}

function buildManualCaptchaId(tab, context = {}) {
  return buildManualVerificationId('captcha', tab, context);
}

async function getManualCaptchaRect(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const isVisible = el => {
        const rect = el.getBoundingClientRect?.();
        const style = window.getComputedStyle(el);
        return rect && rect.width > 40 && rect.height > 20 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const toRect = rect => ({
        left: Math.max(0, rect.left),
        top: Math.max(0, rect.top),
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height)
      });
      const withScale = result => ({
        ...result,
        deviceScaleFactor: Number(window.devicePixelRatio || 1) || 1
      });
      const media = [...document.querySelectorAll('img, canvas, svg')]
        .map(el => ({ el, rect: el.getBoundingClientRect?.(), text: el.alt || el.getAttribute?.('aria-label') || '' }))
        .filter(item => item.rect && item.rect.width >= 120 && item.rect.height >= 40 && isVisible(item.el))
        .filter(item => !/Yahoo/i.test(item.text));
      if (media.length) {
        const target = media.sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height))[0];
        return withScale({ success: true, rect: toRect(target.rect), method: 'media' });
      }
      const panels = [...document.querySelectorAll('div, section, form, table')]
        .map(el => ({ el, rect: el.getBoundingClientRect?.(), text: String(el.textContent || '') }))
        .filter(item => item.rect && item.rect.width >= 180 && item.rect.height >= 80 && isVisible(item.el))
        .filter(item => /\u753b\u50cf\u3067\u8a8d\u8a3c\u3059\u308b|\u753b\u50cf\u3092\u5909\u66f4/.test(item.text));
      if (panels.length) {
        const target = panels.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0];
        return withScale({ success: true, rect: toRect(target.rect), method: 'panel' });
      }
      return { success: false, error: 'captcha image rect not found' };
    }
  }).catch(error => [{ result: { success: false, error: error.message || 'captcha rect script failed' } }]);
  return result?.[0]?.result || { success: false, error: 'captcha rect unavailable' };
}

async function cropDataUrl(dataUrl, rect, deviceScaleFactor = 1) {
  if (!rect || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap !== 'function') {
    return dataUrl;
  }
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const scale = Number(deviceScaleFactor || 1) || 1;
  const sx = Math.max(0, Math.floor(rect.left * scale));
  const sy = Math.max(0, Math.floor(rect.top * scale));
  const sw = Math.min(bitmap.width - sx, Math.ceil(rect.width * scale));
  const sh = Math.min(bitmap.height - sy, Math.ceil(rect.height * scale));
  if (sw <= 0 || sh <= 0) return dataUrl;
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  const out = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

async function extractManualCaptchaImageFromPage(tabId) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async () => {
      const isVisible = el => {
        const rect = el.getBoundingClientRect?.();
        const style = window.getComputedStyle(el);
        return rect && rect.width >= 80 && rect.height >= 30 && style.display !== 'none' && style.visibility !== 'hidden';
      };
      const supportedImageDataUrl = value => /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(String(value || ''));
      const candidates = [...document.querySelectorAll('img, canvas')]
        .map(el => ({
          el,
          rect: el.getBoundingClientRect?.(),
          text: [
            el.alt,
            el.title,
            el.getAttribute?.('aria-label'),
            el.id,
            el.className
          ].filter(Boolean).join(' ')
        }))
        .filter(item => item.rect && isVisible(item.el))
        .filter(item => !/Yahoo/i.test(String(item.text || '')))
        .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
      for (const item of candidates) {
        const el = item.el;
        try {
          if (el.tagName === 'CANVAS') {
            const dataUrl = el.toDataURL('image/png');
            if (/^data:image\/png;base64,/i.test(dataUrl)) return { success: true, imageDataUrl: dataUrl, method: 'canvas' };
          }
          const src = el.currentSrc || el.src || el.getAttribute?.('src') || '';
          if (supportedImageDataUrl(src)) return { success: true, imageDataUrl: src, method: 'img-data-src' };
        } catch (_) {
          // Try the next visible media element.
        }
      }
      return { success: false, error: 'captcha image element not extractable' };
    }
  }).catch(error => [{ result: { success: false, error: error.message || 'captcha image extraction failed' } }]);
  return result?.[0]?.result || { success: false, error: 'captcha image extraction unavailable' };
}

async function captureManualCaptchaImageWithDebugger(tabId, rectResult) {
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Page.enable').catch(() => null);
    const params = {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    };
    if (rectResult?.success && rectResult.rect) {
      params.clip = {
        x: Math.max(0, rectResult.rect.left),
        y: Math.max(0, rectResult.rect.top),
        width: Math.max(1, rectResult.rect.width),
        height: Math.max(1, rectResult.rect.height),
        scale: 1
      };
    }
    const result = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', params);
    const data = String(result?.data || '');
    if (!data) return { success: false, error: 'debugger screenshot data unavailable' };
    return { success: true, imageDataUrl: `data:image/png;base64,${data}`, method: 'debugger-page-screenshot' };
  } catch (error) {
    return { success: false, error: error?.message || 'debugger screenshot failed' };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function captureManualCaptchaImage(tab) {
  const tabId = tab?.id;
  if (!tabId) throw new Error('captcha tab id is required');
  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(500);
  const rectResult = await getManualCaptchaRect(tabId);
  const debuggerImage = await captureManualCaptchaImageWithDebugger(tabId, rectResult);
  if (debuggerImage?.success && debuggerImage.imageDataUrl) return debuggerImage.imageDataUrl;
  let visibleTabError = '';
  try {
    const imageDataUrl = await chrome.tabs.captureVisibleTab(currentTab.windowId, { format: 'png' });
    if (!rectResult?.success) return imageDataUrl;
    return await cropDataUrl(imageDataUrl, rectResult.rect, rectResult.deviceScaleFactor || 1).catch(() => imageDataUrl);
  } catch (error) {
    visibleTabError = error?.message || 'visible tab screenshot failed';
  }
  const pageImage = await extractManualCaptchaImageFromPage(tabId);
  if (pageImage?.success && pageImage.imageDataUrl) return pageImage.imageDataUrl;
  throw new Error([
    debuggerImage?.error || '',
    visibleTabError,
    pageImage?.error || ''
  ].filter(Boolean).join('; ') || 'manual captcha image unavailable');
}

async function waitForManualCaptchaAnswer(id, timeoutMs = MANUAL_CAPTCHA_WAIT_TIMEOUT_MS) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const result = await fetchManualCaptchaAnswer(id).catch(() => null);
    if (result?.answered && result.answer) return result.answer;
    await sleep(2000);
  }
  throw new Error('manual captcha answer timeout');
}

async function fillManualCaptchaAnswer(tabId, answer) {
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (captchaAnswer) => {
      const getText = el => [
        el.textContent,
        el.value,
        el.placeholder,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const input = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')]
        .find(el => /\u8868\u793a\u3055\u308c\u3066\u3044\u308b\u6587\u5b57|\u6587\u5b57/.test(getText(el)) || el.offsetWidth > 100);
      if (!input) return { success: false, error: 'captcha input not found' };
      input.focus();
      input.value = captchaAnswer;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"]')];
      const button = controls.find(el => /^\s*\u7d9a\u3051\u308b\s*$/.test(getText(el)));
      if (!button) return { success: false, error: 'captcha submit button not found' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.click();
      return { success: true };
    },
    args: [answer]
  });
  return result?.[0]?.result || { success: false, error: 'captcha fill script failed' };
}

async function detectManualPinPage(tab) {
  const current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  if (!current?.id || !isLikelyManualPinTab(current)) return false;
  if (isYahooAuthLevelPinUrl(current.url)) return true;
  const result = await chrome.scripting.executeScript({
    target: { tabId: current.id },
    world: 'MAIN',
    func: () => {
      const text = String(document.body?.innerText || document.body?.textContent || '').replace(/\s+/g, ' ');
      const hasInput = !!document.querySelector('input[type="text"], input[type="tel"], input[type="number"], input[type="password"], input:not([type])');
      return hasInput && /(PIN|pin|\u78ba\u8a8d\u30b3\u30fc\u30c9|\u8a8d\u8a3c\u30b3\u30fc\u30c9|\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3\u30b3\u30fc\u30c9|\u30b3\u30fc\u30c9)/.test(text);
    }
  }).catch(() => [{ result: isLikelyManualPinTab(current) }]);
  return !!result?.[0]?.result;
}

function getDigitKeyEventParams(digit) {
  const code = `Digit${digit}`;
  const keyCode = 48 + Number(digit);
  return { key: digit, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
}

async function dispatchTrustedManualPinKeys(tab, answer) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for manual pin keyboard input' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };
  const digits = String(answer || '').replace(/\D/g, '');
  if (!digits) return { success: false, error: 'pin digits are required' };
  return dispatchTrustedManualPinInput(tabId, digits, { preferKeyboard: true });
}

async function dispatchTrustedManualPinInput(tab, digits, options = {}) {
  const tabId = tab?.id || tab;
  const pinDigits = String(digits || '').replace(/\D/g, '');
  if (!tabId) return { success: false, error: 'tabId is required for manual pin keyboard input' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };
  if (!pinDigits) return { success: false, error: 'pin digits are required' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);
  let diagnostics = await getTrustedInputDiagnostics(tabId, 'manualPin', options.preferKeyboard === false ? 'debuggerInsertText' : 'debuggerKeyboard');

  const target = { tabId };
  let attached = false;
  let keyboardError = null;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    if (options.preferKeyboard !== false) {
      try {
        console.log('[Yahoo Bid] Sending manual PIN via debugger real keyboard, digits:', pinDigits.length);
        for (const digit of pinDigits) {
          const keyParams = getDigitKeyEventParams(digit);
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'rawKeyDown',
            ...keyParams
          });
          await sleep(30);
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'char',
            ...keyParams,
            text: digit,
            unmodifiedText: digit
          });
          await sleep(30);
          await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
            type: 'keyUp',
            ...keyParams
          });
          await sleep(100);
        }
        await sleep(300);
        diagnostics = await getTrustedInputDiagnostics(tabId, 'manualPin', 'debuggerKeyboard');
        return { success: true, method: 'debuggerRealKeyboard', digits: pinDigits.length, diagnostics };
      } catch (e) {
        keyboardError = e;
        console.warn('[Yahoo Bid] Manual PIN real keyboard failed, falling back to insertText:', e.message || e);
      }
    }
    console.log('[Yahoo Bid] Sending manual PIN via debugger insertText fallback, digits:', pinDigits.length);
    await chrome.debugger.sendCommand(target, 'Input.insertText', { text: pinDigits });
    await sleep(300);
    diagnostics = await getTrustedInputDiagnostics(tabId, 'manualPin', 'debuggerInsertText');
    return {
      success: true,
      method: 'debuggerInsertText',
      digits: pinDigits.length,
      keyboardError: keyboardError?.message || '',
      diagnostics
    };
  } catch (e) {
    diagnostics = await getTrustedInputDiagnostics(tabId, 'manualPin', options.preferKeyboard === false ? 'debuggerInsertText' : 'debuggerKeyboard').catch(() => diagnostics);
    return { success: false, error: e.message || 'manual pin keyboard input failed', diagnostics };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function focusManualPinTabForSystemInput(tabId) {
  if (!tabId) return null;
  const currentTab = await chrome.tabs.get(tabId).catch(() => null);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true, state: 'normal' }).catch(() => {
      return chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
    });
  }
  await chrome.tabs.update(tabId, { active: true, highlighted: true }).catch(() => {
    return chrome.tabs.update(tabId, { active: true }).catch(() => {});
  });
  await sleep(300);
  const latestTab = await chrome.tabs.get(tabId).catch(() => null);
  if (latestTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(latestTab.windowId, { focused: true, state: 'normal' }).catch(() => {
      return chrome.windows.update(latestTab.windowId, { focused: true }).catch(() => {});
    });
  }
  await sleep(500);
  return latestTab || currentTab;
}

async function fillManualPinAnswer(tabId, answer) {
  const pinTab = await focusManualPinTabForSystemInput(tabId);
  const systemResult = await typeManualPinWithSystemKeyboard(answer, { windowTitle: pinTab?.title || '' });
  console.log('[Yahoo Bid] Manual PIN system keyboard result:', systemResult?.success ? 'success' : 'failed', systemResult?.diagnostics || systemResult?.error || '');
  await postPluginDiagnostic({
    type: 'pin',
    level: systemResult?.success ? 'info' : 'warn',
    action: 'manualPin',
    method: 'systemSendKeys',
    message: systemResult?.success ? 'manual PIN system keyboard input dispatched' : (systemResult?.error || 'manual PIN system keyboard input failed'),
    diagnostics: systemResult?.diagnostics || systemResult?.error || ''
  });
  if (systemResult?.success) return systemResult;
  console.warn('[Yahoo Bid] System keyboard PIN input failed, falling back to debugger:', systemResult?.error || systemResult);

  const trustedResult = await dispatchTrustedManualPinKeys(tabId, answer);
  console.log('[Yahoo Bid] Manual PIN debugger keyboard result:', trustedResult?.success ? 'success' : 'failed', trustedResult?.diagnostics || trustedResult?.error || '');
  await postPluginDiagnostic({
    type: 'pin',
    level: trustedResult?.success ? 'info' : 'error',
    action: 'manualPin',
    method: trustedResult?.method || 'debuggerKeyboard',
    message: trustedResult?.success ? 'manual PIN debugger input dispatched' : (trustedResult?.error || 'manual PIN debugger input failed'),
    diagnostics: trustedResult?.diagnostics || trustedResult?.error || ''
  });
  if (trustedResult?.success) return trustedResult;

  const result = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (pinAnswer) => {
      const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
      const getText = el => [
        el.textContent,
        el.value,
        el.placeholder,
        el.name,
        el.id,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ');
      const inputs = [...document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"], input[type="password"], input:not([type])')]
        .filter(el => !el.disabled && !el.readOnly && el.offsetWidth > 0 && el.offsetHeight > 0);
      const input = inputs.find(el => /(PIN|pin|\u78ba\u8a8d|\u8a8d\u8a3c|\u30b3\u30fc\u30c9|\u30bb\u30ad\u30e5\u30ea\u30c6\u30a3)/.test(getText(el))) || inputs[0];
      if (!input) return { success: false, error: 'pin input not found' };
      input.focus();
      input.value = pinAnswer;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      const controls = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], [role="button"], a')]
        .filter(el => !el.disabled && el.offsetWidth > 0 && el.offsetHeight > 0);
      const button = controls.find(el => /(\u7d9a\u3051\u308b|\u6b21\u3078|\u78ba\u8a8d|\u9001\u4fe1|\u8a8d\u8a3c)/.test(normalize(getText(el)))) || controls.find(el => el.tagName === 'BUTTON' || el.type === 'submit');
      if (!button) return { success: false, error: 'pin submit button not found' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.click();
      return { success: true };
    },
    args: [answer]
  });
  return result?.[0]?.result || { success: false, error: 'pin fill script failed' };
}

async function refreshManualPinPageBeforeAnswer(tab) {
  let current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  if (!current?.id) return tab;
  const pinDetected = await detectManualPinPage(current).catch(() => isLikelyManualPinTab(current));
  if (!pinDetected) return current;
  await chrome.tabs.update(current.id, { active: true }).catch(() => {});
  if (chrome.tabs.reload) {
    await chrome.tabs.reload(current.id).catch(() => {});
  } else if (current.url) {
    await chrome.tabs.update(current.id, { url: current.url, active: true }).catch(() => {});
  }
  await waitForTabComplete(current.id, 10000).catch(() => {});
  await sleep(2000);
  current = await chrome.tabs.get(current.id).catch(() => current);
  await injectContentScript(current.id).catch(() => {});
  return current;
}

async function findManualVerificationTransitionTab(current, previousTabIds = new Set(), options = {}) {
  const currentTab = current?.id ? await chrome.tabs.get(current.id).catch(() => current) : current;
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const previous = previousTabIds instanceof Set ? previousTabIds : new Set(previousTabIds || []);
  const candidates = [];
  if (currentTab?.id && isManualVerificationTab(currentTab)) candidates.push(currentTab);
  for (const tab of tabs) {
    if (!tab?.id || !isManualVerificationTab(tab)) continue;
    if (!candidates.some(candidate => candidate.id === tab.id)) candidates.push(tab);
  }
  if (!candidates.length) return currentTab || current;
  if (options.preferPin) {
    const activePin = candidates.find(tab => tab.active && isLikelyManualPinTab(tab));
    if (activePin) return activePin;
    const newPins = candidates.filter(tab => !previous.has(tab.id) && isLikelyManualPinTab(tab));
    if (newPins.length) return newPins.sort((a, b) => (b.id || 0) - (a.id || 0))[0];
    const anyPin = candidates.find(isLikelyManualPinTab);
    if (anyPin) return anyPin;
  }
  if (currentTab?.id && isManualVerificationTab(currentTab)) {
    ignoreDuplicateManualVerificationTabs(candidates, currentTab);
    return currentTab;
  }
  if (options.preferCaptcha) {
    const activeCaptcha = candidates.find(tab => tab.active && isManualCaptchaTab(tab));
    if (activeCaptcha) return activeCaptcha;
    const newCaptchas = candidates.filter(tab => !previous.has(tab.id) && isManualCaptchaTab(tab));
    if (newCaptchas.length) return newCaptchas.sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  }
  const newPins = candidates.filter(tab => !previous.has(tab.id) && isLikelyManualPinTab(tab));
  if (newPins.length) return newPins.sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  const newVerificationTabs = candidates.filter(tab => !previous.has(tab.id));
  if (newVerificationTabs.length) return newVerificationTabs.sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  if (currentTab?.id && isManualCaptchaTab(currentTab)) return currentTab;
  const activeCaptcha = candidates.find(tab => tab.active && isManualCaptchaTab(tab));
  if (activeCaptcha) return activeCaptcha;
  const activePin = candidates.find(tab => tab.active && isLikelyManualPinTab(tab));
  if (activePin) return activePin;
  const activeVerification = candidates.find(tab => tab.active);
  if (activeVerification) return activeVerification;
  return currentTab || candidates[0];
}

async function waitForManualVerificationPageTransition(tab, timeoutMs = 15000, previousTabIds = null, options = {}) {
  let current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  const previous = previousTabIds instanceof Set ? previousTabIds : await getTabIds().catch(() => new Set());
  const startUrl = String(current?.url || '');
  const startAt = Date.now();
  let attempts = 0;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / 1000) + 2);
  while (Date.now() - startAt < timeoutMs && current?.id && attempts < maxAttempts) {
    attempts += 1;
    await sleep(1000);
    current = await findManualVerificationTransitionTab(current, previous, options);
    const url = String(current?.url || '');
    if (current?.id && current.id !== tab?.id) break;
    if (url && url !== startUrl) break;
    const captchaPage = isManualCaptchaTab(current);
    const pinPage = await detectManualPinPage(current).catch(() => isLikelyManualPinTab(current));
    if (!captchaPage && !pinPage) break;
  }
  return current || tab;
}

async function isStillManualVerificationPage(tab) {
  if (!tab?.id) return false;
  if (isManualCaptchaTab(tab)) return true;
  return await detectManualPinPage(tab).catch(() => isLikelyManualPinTab(tab));
}

async function handleManualVerificationIfPresent(tab, context = {}) {
  let current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  rememberManualVerificationTab(current);
  let handled = false;
  let pinAnswer = String(context.pinAnswer || '').trim();
  let pinAnswerFromContext = Boolean(pinAnswer);
  let canReusePinAfterCaptcha = false;
  let pinAttempted = Boolean(pinAnswer);
  for (let step = 0; step < 6 && current?.id; step += 1) {
    current = await chrome.tabs.get(current.id).catch(() => current);
    if (isManualCaptchaTab(current)) {
      manualVerificationFlowActive = true;
      rememberManualVerificationTab(current);
      handled = true;
      const id = buildManualVerificationId('captcha', current, context);
      let captchaMessage = '';
      const imageDataUrl = await captureManualCaptchaImage(current).catch(error => {
        console.warn('[Yahoo Bid] Manual captcha screenshot failed; posting captcha challenge with fallback image:', error?.message || error);
        captchaMessage = '验证码图片提取和截图都失败，请看服务器 Chrome 验证码页面输入文字';
        return MANUAL_CAPTCHA_FALLBACK_IMAGE_DATA_URL;
      });
      await postManualCaptchaChallenge({
        id,
        type: 'captcha',
        imageDataUrl,
        message: captchaMessage,
        pageUrl: current.url || '',
        productId: context.productId || '',
        source: context.source || ''
      });
      const answer = await waitForManualCaptchaAnswer(id);
      const beforeVerificationTabIds = await getTabIds().catch(() => new Set());
      const fillResult = await fillManualCaptchaAnswer(current.id, answer);
      if (!fillResult?.success) throw new Error(fillResult?.error || 'manual captcha fill failed');
      if (pinAnswer) canReusePinAfterCaptcha = true;
      current = await waitForManualVerificationPageTransition(current, 20000, beforeVerificationTabIds, { preferPin: true });
      rememberManualVerificationTab(current);
      if (!isManualCaptchaTab(current)) await closeManualCaptchaChallenge(id);
      await sleep(500);
      continue;
    }

    const pinDetected = await detectManualPinPage(current).catch(() => isLikelyManualPinTab(current));
    if (!pinDetected) break;
    manualVerificationFlowActive = true;
    rememberManualVerificationTab(current);
    handled = true;
    let pinChallengeId = '';
    if (!pinAnswer || (!canReusePinAfterCaptcha && !pinAnswerFromContext)) {
      pinChallengeId = buildManualVerificationId('pin', current, context);
      await postManualCaptchaChallenge({
        id: pinChallengeId,
        type: 'pin',
        message: pinAttempted ? '上次 PIN 码可能错误，请重新输入 PIN 码' : 'Yahoo 需要 PIN 码验证，请输入 PIN 码',
        pageUrl: current.url || '',
        productId: context.productId || '',
        source: context.source || ''
      });
      pinAnswer = await waitForManualCaptchaAnswer(pinChallengeId);
    }
    current = await refreshManualPinPageBeforeAnswer(current);
    rememberManualVerificationTab(current);
    const beforeVerificationTabIds = await getTabIds().catch(() => new Set());
    const fillResult = await fillManualPinAnswer(current.id, pinAnswer);
    if (!fillResult?.success) throw new Error(fillResult?.error || 'manual pin fill failed');
    pinAttempted = true;
    pinAnswerFromContext = false;
    canReusePinAfterCaptcha = false;
    if (fillResult.method === 'debuggerRealKeyboard') {
      current = await waitForManualVerificationPageTransition(current, 3000, beforeVerificationTabIds, { preferCaptcha: true });
      rememberManualVerificationTab(current);
      const stillPinAfterKeyboard = await detectManualPinPage(current).catch(() => isLikelyManualPinTab(current));
      if (stillPinAfterKeyboard) {
        console.warn('[Yahoo Bid] PIN page still open after real keyboard; retrying with insertText fallback');
        const beforeInsertTextRetryTabIds = await getTabIds().catch(() => new Set());
        const insertTextResult = await dispatchTrustedManualPinInput(current.id, pinAnswer, { preferKeyboard: false });
        if (!insertTextResult?.success) throw new Error(insertTextResult?.error || 'manual pin insertText retry failed');
        current = await waitForManualVerificationPageTransition(current, 15000, beforeInsertTextRetryTabIds, { preferCaptcha: true });
        rememberManualVerificationTab(current);
      }
    } else {
      current = await waitForManualVerificationPageTransition(current, 15000, beforeVerificationTabIds, { preferCaptcha: true });
      rememberManualVerificationTab(current);
    }
    if (pinChallengeId && !await isStillManualVerificationPage(current)) await closeManualCaptchaChallenge(pinChallengeId);
    await sleep(500);
  }
  const allOpenVerificationTabs = await chrome.tabs.query({}).then(tabs => tabs.filter(isManualVerificationTab)).catch(() => []);
  const openVerificationTabs = allOpenVerificationTabs.filter(tab => !ignoredManualVerificationTabIds.has(tab.id));
  if (!openVerificationTabs.length) {
    manualVerificationFlowActive = false;
    manualVerificationTabId = null;
    if (!allOpenVerificationTabs.length) ignoredManualVerificationTabIds.clear();
  }
  if (current?.id) await injectContentScript(current.id).catch(() => {});
  return { handled, tab: current || tab, pinAnswer };
}

async function resumeAnsweredManualPinChallenge(tab, context = {}) {
  const current = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  if (!current?.id || !isLikelyManualPinTab(current)) return { handled: false, tab: current || tab };
  const challenge = await fetchCurrentManualCaptchaChallenge().catch(() => null);
  if (!challenge?.found || challenge.type !== 'pin' || !challenge.answered || !challenge.answer) {
    return { handled: false, tab: current };
  }
  console.log('[Yahoo Bid] Resuming answered manual PIN challenge:', challenge.id);
  const result = await handleManualVerificationIfPresent(current, {
    ...context,
    productId: context.productId || challenge.productId || '',
    pinAnswer: challenge.answer
  });
  if (result?.handled) await closeManualCaptchaChallenge(challenge.id);
  return result;
}

async function handleManualCaptchaIfPresent(tab, context = {}) {
  return handleManualVerificationIfPresent(tab, context);
}

async function openTransactionPage(job, beforeTabIds = new Set()) {
  const createdTabIds = [];
  if (job.transactionUrl) {
    const tab = await chrome.tabs.create({ url: job.transactionUrl, active: false });
    if (tab.id) createdTabIds.push(tab.id);
    if (tab.id) await waitForTransactionPageInteractive(tab.id).catch(() => {});
    await injectContentScript(tab.id).catch(() => {});
    tab._gdaipaiCreatedTabIds = createdTabIds;
    const captchaResult = await handleManualCaptchaIfPresent(tab, { productId: job.productId, source: 'transaction_url' });
    captchaResult.tab._gdaipaiCreatedTabIds = createdTabIds;
    return captchaResult.tab;
  }
  const tab = await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/won', active: false });
  if (tab.id) createdTabIds.push(tab.id);
  if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
  await sleep(3000);
  await injectContentScript(tab.id);
  const clickResult = await chrome.tabs.sendMessage(tab.id, {
    type: 'CLICK_TRANSACTION_CONTACT',
    productId: job.productId
  }).catch(error => ({ success: false, error: error.message || 'transaction contact click failed' }));
  if (!clickResult?.success) {
    throw new Error(clickResult?.error || 'transaction contact button not found');
  }
  if (clickResult.href) {
    await chrome.tabs.update(tab.id, { url: clickResult.href, active: false });
  } else {
    await sleep(1500);
    const knownTabIds = new Set([...(beforeTabIds || []), ...createdTabIds]);
    const nextTab = await switchToNewestNewTab(knownTabIds, tab);
    for (const id of nextTab._gdaipaiCreatedTabIds || []) createdTabIds.push(id);
    nextTab._gdaipaiCreatedTabIds = [...new Set(createdTabIds)];
    const captchaResult = await handleManualCaptchaIfPresent(nextTab, { productId: job.productId, source: 'transaction_contact_new_tab' });
    captchaResult.tab._gdaipaiCreatedTabIds = [...new Set(createdTabIds)];
    return captchaResult.tab;
  }
  await waitForTransactionPageInteractive(tab.id).catch(() => {});
  await injectContentScript(tab.id).catch(() => {});
  tab._gdaipaiCreatedTabIds = createdTabIds;
  const captchaResult = await handleManualCaptchaIfPresent(tab, { productId: job.productId, source: 'transaction_contact' });
  captchaResult.tab._gdaipaiCreatedTabIds = createdTabIds;
  return captchaResult.tab;
}

async function waitForTransactionPageInteractive(tabId, timeoutMs = 8000) {
  if (!tabId) return null;
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('transaction tab closed while waiting for interactive state');
    await injectContentScript(tabId, { ignoreMissingTab: true }).catch(() => false);
    const state = await getBundleActionState(tabId).catch(() => null);
    if (
      state?.canStart ||
      state?.canInputTransaction ||
      state?.canPlacementOk ||
      state?.canDecide ||
      state?.canConfirm ||
      state?.paymentReady ||
      state?.waitingShipping ||
      state?.cancelled ||
      state?.complete
    ) {
      return tab;
    }
    if (tab.status === 'complete') return tab;
    await sleep(250);
  }
  return waitForTabComplete(tabId).catch(() => chrome.tabs.get(tabId).catch(() => null));
}

async function getTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map(tab => tab.id).filter(Boolean));
}

async function switchToNewestNewTab(previousIds, fallbackTab, options = {}) {
  const isCandidate = typeof options.isCandidate === 'function'
    ? options.isCandidate
    : isLikelyYahooTransactionCleanupTab;
  const tabs = await chrome.tabs.query({});
  const newTabs = tabs
    .filter(tab => tab.id && !previousIds.has(tab.id) && isCandidate(tab))
    .sort((a, b) => (b.id || 0) - (a.id || 0));
  if (!newTabs.length) return fallbackTab;
  const nextTab = newTabs[0];
  const created = new Set(fallbackTab?._gdaipaiCreatedTabIds || []);
  if (nextTab.id) created.add(nextTab.id);
  if (fallbackTab?.id && fallbackTab.id !== nextTab.id) {
    await closeTabIfExists(fallbackTab.id);
  }
  if (nextTab.id) await waitForTabComplete(nextTab.id).catch(() => {});
  await sleep(1500);
  await injectContentScript(nextTab.id).catch(() => {});
  nextTab._gdaipaiCreatedTabIds = [...created];
  return nextTab;
}

function getBundleActionPatternSource(action) {
  const patterns = {
    close: '\\u9589\\u3058\\u308b',
    start: '^\\s*\\u307e\\u3068\\u3081\\u3066\\u53d6\\u5f15\\u3092(?:\\u306f\\u3058\\u3081\\u308b|\\u4f9d\\u983c\\u3059\\u308b)\\s*$',
    input: '\\u53d6\\u5f15\\s*\\u60c5\\u5831\\s*\\u3092\\s*\\u5165\\u529b\\s*\\u3059\\u308b',
    placementOk: '^\\s*OK\\s*$',
    decide: '^\\s*(?:\\u6c7a\\u5b9a\\u3059\\u308b|\\u78ba\\u8a8d\\u3059\\u308b)\\s*$',
    confirm: '\\u78ba\\u5b9a\\u3059\\u308b'
  };
  return patterns[action] || '';
}

function isLikelyYahooTransactionTab(tab) {
  const url = String(tab?.url || '');
  return !url ||
    /^about:blank/i.test(url) ||
    /:\/\/(?:[^/]+\.)?auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/buy\.auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/contact\.auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/login\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/account\.edit\.yahoo\.co\.jp\//i.test(url);
}

function isLikelyYahooTransactionCleanupTab(tab) {
  const url = String(tab?.url || '');
  return !url ||
    /^about:blank/i.test(url) ||
    /:\/\/buy\.auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/contact\.auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/login\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/account\.edit\.yahoo\.co\.jp\//i.test(url);
}

function buildBundleActionWaitError(action, error, trustedClick = null) {
  const baseMessage = String(error?.message || error || '').trim();
  const diagnostics = trustedClick?.diagnostics ? `; trusted=${trustedClick.diagnostics}` : '';
  if (/^bundle next page did not appear$/i.test(baseMessage)) {
    return `bundle ${action} next page did not appear${diagnostics}`;
  }
  return baseMessage
    ? `bundle ${action} failed: ${baseMessage}${diagnostics}`
    : `bundle ${action} failed`;
}

async function runMainWorldBundleActionClick(tabId, action, mode = 'click') {
  const pattern = getBundleActionPatternSource(action);
  if (!pattern) return { success: false, error: 'unknown bundle action' };
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (patternStr, clickMode) => {
      const pattern = new RegExp(patternStr);
      const getText = el => [
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]';
      const resolveClickable = el => el.closest?.(clickableSelector) || (el.matches?.(clickableSelector) ? el : null);
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params], body *')];
      const matched = controls.find(el => pattern.test(getText(el)) && resolveClickable(el));
      const button = matched ? resolveClickable(matched) : null;
      if (!button) return { success: false, error: 'button not found in MAIN world' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.focus?.();
      const type = String(button.type || '').toLowerCase();
      if (clickMode === 'requestSubmit') {
        if (button.form && typeof button.form.requestSubmit === 'function' && (type === 'submit' || (!type && button.tagName === 'BUTTON'))) {
          button.form.requestSubmit(button);
          return { success: true, method: 'requestSubmit', text: getText(button) };
        }
        return { success: false, error: 'requestSubmit unavailable for bundle action button', text: getText(button) };
      }
      if (clickMode !== 'click') return { success: false, error: `unknown bundle JS click mode: ${clickMode}` };
      button.click();
      return { success: true, method: 'click', text: getText(button) };
    },
    args: [pattern, mode]
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'MAIN world click failed' };
}

function isBundleStartTradePage(tab = {}) {
  return /contact\.auctions\.yahoo\.co\.jp\/trade\/bundle/i.test(String(tab?.url || ''));
}

async function tryBundleRequestSubmitFallback(tab, action, waitFor, previousTabIds) {
  if (action !== 'start' || !tab?.id) return null;
  const current = await chrome.tabs.get(tab.id).catch(() => tab);
  if (!isBundleStartTradePage(current) && !isBundleStartTradePage(tab)) return null;
  const submitResult = await runMainWorldBundleActionClick(tab.id, action, 'requestSubmit');
  console.log('[Yahoo Bid] requestSubmit bundle click result:', submitResult);
  if (!submitResult?.success) return { success: false, error: submitResult?.error || 'bundle requestSubmit failed' };
  const nextTab = await waitForBundleActionStateAcrossTabs(tab, waitFor, previousTabIds, 5000);
  return { success: true, tab: nextTab, clickResult: submitResult };
}

async function waitForBundleStartRenderReady(tab, action, timeoutMs = 6000) {
  if (action !== 'start' || !tab?.id) return { success: true, skipped: true };
  const current = await chrome.tabs.get(tab.id).catch(() => tab);
  const url = String(current?.url || tab?.url || '');
  if (!/contact\.auctions\.yahoo\.co\.jp\/trade\/bundle/i.test(url)) {
    return { success: true, skipped: true };
  }

  const pattern = getBundleActionPatternSource(action);
  const startAt = Date.now();
  let lastResult = null;
  while (Date.now() - startAt < timeoutMs) {
    const injectionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (patternStr) => {
        const pattern = new RegExp(patternStr);
        const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
        const getText = el => normalize([
          el?.textContent,
          el?.value,
          el?.title,
          el?.getAttribute?.('aria-label')
        ].filter(Boolean).join(' '));
        const isVisible = el => {
          const rect = el?.getBoundingClientRect?.();
          const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          return !!rect && rect.width > 0 && rect.height > 0 &&
            style?.display !== 'none' && style?.visibility !== 'hidden' && Number(style?.opacity ?? 1) !== 0;
        };
        const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]';
        const resolveClickable = el => el?.closest?.(clickableSelector) || (el?.matches?.(clickableSelector) ? el : null);
        const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params], body *')];
        const matched = controls.find(el => pattern.test(getText(el)) && resolveClickable(el));
        const button = matched ? resolveClickable(matched) : null;
        const selects = [...document.querySelectorAll('select')].filter(isVisible);
        const selectReady = selects.every(select => !select.disabled && select.options?.length > 0 && String(select.value || '').trim());
        const buttonReady = !!button && isVisible(button) && !button.disabled && button.getAttribute?.('aria-disabled') !== 'true';
        const documentReady = document.readyState === 'complete';
        return {
          success: documentReady && buttonReady && selectReady,
          ready: documentReady && buttonReady && selectReady,
          documentReady,
          buttonReady,
          selectReady,
          text: button ? getText(button) : '',
          selectCount: selects.length
        };
      },
      args: [pattern, 'renderReady']
    }).catch(error => [{ result: { success: false, error: error.message || 'bundle render readiness check failed' } }]);
    lastResult = injectionResult?.[0]?.result || null;
    if (lastResult?.success) return lastResult;
    await sleep(250);
  }
  console.warn('[Yahoo Bid] Bundle start render readiness wait timed out, continuing with JS click:', lastResult);
  return lastResult || { success: false, error: 'bundle start render readiness wait timed out' };
}

async function activateTabForBundleAction(tab) {
  const tabId = tab?.id || tab;
  if (!tabId) return;
  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);
}

async function getBundleActionClickPoint(tabId, action) {
  const pattern = getBundleActionPatternSource(action);
  if (!pattern) return { success: false, error: 'unknown bundle action' };
  const injectionResult = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (patternStr) => {
      const pattern = new RegExp(patternStr);
      const getText = el => [
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const clickableSelector = 'button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params]';
      const resolveClickable = el => el.closest?.(clickableSelector) || (el.matches?.(clickableSelector) ? el : null);
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"], [onclick], [tabindex], [data-cl-params], body *')];
      const matched = controls.find(el => pattern.test(getText(el)) && resolveClickable(el));
      const button = matched ? resolveClickable(matched) : null;
      if (!button) return { success: false, error: 'button not found for trusted click' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.focus?.();
      const rect = button.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { success: false, error: 'button has no clickable rect' };
      }
      return {
        success: true,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        text: getText(button)
      };
    },
    args: [pattern]
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'button not found for trusted click' };
}

async function dispatchTrustedBundleActionClick(tab, action) {
  const tabId = tab?.id || tab;
  if (!tabId) return { success: false, error: 'tabId is required for trusted click' };
  if (!chrome.debugger?.attach) return { success: false, error: 'chrome.debugger API unavailable' };

  const currentTab = await chrome.tabs.get(tabId).catch(() => tab);
  if (currentTab?.windowId && chrome.windows?.update) {
    await chrome.windows.update(currentTab.windowId, { focused: true }).catch(() => {});
  }
  await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  await sleep(200);

  const point = await getBundleActionClickPoint(tabId, action);
  let diagnostics = await getTrustedInputDiagnostics(tabId, `bundle:${action}`, 'debuggerMouse', point);
  if (!point?.success) return { ...point, diagnostics };

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      button: 'none'
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 1,
      clickCount: 1
    });
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: 0,
      clickCount: 1
    });
    await sleep(300);
    diagnostics = await getTrustedInputDiagnostics(tabId, `bundle:${action}`, 'debuggerMouse', point);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'info',
      action: `bundle:${action}`,
      method: 'debuggerMouse',
      message: 'trusted bundle mouse click dispatched',
      diagnostics
    });
    return { success: true, method: 'debuggerMouse', text: point.text, diagnostics };
  } catch (e) {
    diagnostics = await getTrustedInputDiagnostics(tabId, `bundle:${action}`, 'debuggerMouse', point).catch(() => diagnostics);
    await postPluginDiagnostic({
      type: 'trusted_input',
      level: 'error',
      action: `bundle:${action}`,
      method: 'debuggerMouse',
      message: e.message || 'trusted bundle mouse click failed',
      diagnostics
    });
    return { success: false, error: e.message || 'trusted mouse click failed', diagnostics };
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}

async function waitForCurrentTabNavigation(tabId, previousUrl, timeoutMs = 30000) {
  const startAt = Date.now();
  let sawUrlChange = !previousUrl;
  while (Date.now() - startAt < timeoutMs) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (!current) throw new Error('transaction tab closed during navigation');
    if (current.url && current.url !== previousUrl) sawUrlChange = true;
    if (sawUrlChange && current.status === 'complete') return current;
    await sleep(250);
  }
  throw new Error('transaction page navigation timeout');
}

async function getBundleActionState(tabId) {
  await injectContentScript(tabId).catch(() => {});
  const response = await chrome.tabs.sendMessage(tabId, {
    type: 'GET_BUNDLE_TRANSACTION_ACTION_STATE'
  }).catch(() => null);
  return response?.success ? response.state : null;
}

async function waitForBundleActionState(tabId, predicate, timeoutMs = 30000) {
  console.log(`[Yahoo Bid] waitForBundleActionState: tabId=${tabId}, timeout=${timeoutMs}ms`);
  const startAt = Date.now();
  let iteration = 0;
  while (Date.now() - startAt < timeoutMs) {
    iteration++;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error('transaction tab closed while waiting for bundle state');

    if (tab.status === 'complete') {
      const state = await getBundleActionState(tabId);
      console.log(`[Yahoo Bid] waitForBundleActionState iteration ${iteration}: status=complete, state=`, state);
      if (state && predicate(state)) {
        console.log(`[Yahoo Bid] waitForBundleActionState: predicate matched!`);
        return tab;
      }
    } else {
      console.log(`[Yahoo Bid] waitForBundleActionState iteration ${iteration}: status=${tab.status}`);
    }
    await sleep(500);
  }
  throw new Error('bundle next page did not appear');
}

async function waitForBundleActionStateAcrossTabs(tab, predicate, previousIds, timeoutMs = 30000) {
  const startAt = Date.now();
  const originalTabId = tab?.id;
  const previous = previousIds instanceof Set ? previousIds : new Set(previousIds || []);
  const created = new Set(tab?._gdaipaiCreatedTabIds || []);
  if (originalTabId) created.add(originalTabId);

  while (Date.now() - startAt < timeoutMs) {
    const candidates = new Map();
    const original = originalTabId ? await chrome.tabs.get(originalTabId).catch(() => null) : null;
    if (original?.id) candidates.set(original.id, original);

    const tabs = await chrome.tabs.query({}).catch(() => []);
    for (const candidate of tabs) {
      if (!candidate?.id || !isLikelyYahooTransactionCleanupTab(candidate)) continue;
      if (candidate.id === originalTabId || created.has(candidate.id) || !previous.has(candidate.id)) {
        candidates.set(candidate.id, candidate);
        if (!previous.has(candidate.id)) created.add(candidate.id);
      }
    }

    const ordered = [...candidates.values()].sort((a, b) => {
      const aNew = previous.has(a.id) ? 1 : 0;
      const bNew = previous.has(b.id) ? 1 : 0;
      return aNew - bNew;
    });

    for (const candidate of ordered) {
      if (candidate.status !== 'complete') continue;
      const state = await getBundleActionState(candidate.id);
      if (state && predicate(state)) {
        candidate._gdaipaiCreatedTabIds = [...created];
        return candidate;
      }
    }
    await sleep(500);
  }
  throw new Error('bundle next page did not appear');
}

function getBundleActionWaitTimeoutMs(action) {
  if (action === 'start' || action === 'confirm') return 15000;
  return 5000;
}

async function clickBundleActionAndFollowTab(tab, action, waitForOverride = null) {
  console.log(`[Yahoo Bid] clickBundleActionAndFollowTab: action=${action}, tabId=${tab.id}`);

  try {
    await injectContentScript(tab.id);
  } catch (e) {
    console.error('[Yahoo Bid] Failed to inject content script before click:', e);
    return { success: false, error: `content script injection failed: ${e.message}`, tab };
  }

  await waitForBundleStartRenderReady(tab, action).catch(e => {
    console.warn('[Yahoo Bid] Bundle start render readiness wait failed, continuing with JS click:', e.message || e);
  });
  await activateTabForBundleAction(tab);

  const previousTabIds = await getTabIds();
  let clickResult = null;
  let usedContentScriptClick = false;
  try {
    clickResult = await runMainWorldBundleActionClick(tab.id, action);
    console.log('[Yahoo Bid] MAIN world click result:', clickResult);
    if (!clickResult?.success) {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'CLICK_BUNDLE_TRANSACTION_ACTION',
        action
      }).catch(error => ({ success: false, error: error.message || `bundle ${action} failed` }));
      console.log('[Yahoo Bid] Content script click result:', result);
      if (!result?.success) return { success: false, error: result?.error || `bundle ${action} failed`, tab };
      clickResult = result;
      usedContentScriptClick = true;
    }
  } catch (e) {
    console.error('[Yahoo Bid] MAIN world execution failed:', e);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'CLICK_BUNDLE_TRANSACTION_ACTION',
      action
    }).catch(error => ({ success: false, error: error.message || `bundle ${action} failed` }));
    if (!result?.success) return { success: false, error: `MAIN world click failed: ${e.message}; ${result?.error || ''}`.trim(), tab };
    clickResult = result;
    usedContentScriptClick = true;
  }

  if (action === 'close') {
    await sleep(800);
    await injectContentScript(tab.id).catch(() => {});
    return { success: true, tab };
  }

  const waitFor = waitForOverride || (action === 'start'
    ? state => state.canDecide
    : state => state.complete);

  let nextTab = null;
  const waitTimeoutMs = getBundleActionWaitTimeoutMs(action);
  try {
    nextTab = await waitForBundleActionStateAcrossTabs(tab, waitFor, previousTabIds, waitTimeoutMs);
  } catch (e) {
    if (!nextTab && !usedContentScriptClick) {
      console.warn('[Yahoo Bid] MAIN world click did not reach next bundle state, trying content script click:', e.message || e);
      const contentClickResult = await chrome.tabs.sendMessage(tab.id, {
        type: 'CLICK_BUNDLE_TRANSACTION_ACTION',
        action
      }).catch(error => ({ success: false, error: error.message || `bundle ${action} failed` }));
      console.log('[Yahoo Bid] Content script fallback click result:', contentClickResult);
      if (contentClickResult?.success) {
        try {
          nextTab = await waitForBundleActionStateAcrossTabs(tab, waitFor, previousTabIds, waitTimeoutMs);
        } catch (contentWaitError) {
          e = contentWaitError;
        }
      }
    }
    if (!nextTab) {
      console.warn('[Yahoo Bid] JS click did not reach next bundle state, trying requestSubmit fallback:', e.message || e);
      let requestSubmitResult = null;
      try {
        requestSubmitResult = await tryBundleRequestSubmitFallback(tab, action, waitFor, previousTabIds);
        if (requestSubmitResult?.success) {
          nextTab = requestSubmitResult.tab;
        }
      } catch (submitError) {
        requestSubmitResult = { success: false, error: submitError.message || String(submitError || 'requestSubmit failed') };
      }
      if (!nextTab) {
        throw new Error(buildBundleActionWaitError(action, requestSubmitResult?.error || e));
      }
    } else {
      console.log(`[Yahoo Bid] Bundle action state reached after content script fallback, nextTab.id=${nextTab.id}`);
    }
  }

  console.log(`[Yahoo Bid] Bundle action state reached, nextTab.id=${nextTab.id}`);
  nextTab._gdaipaiCreatedTabIds = nextTab._gdaipaiCreatedTabIds || tab._gdaipaiCreatedTabIds || [];
  await injectContentScript(nextTab.id).catch(() => {});
  return { success: true, tab: nextTab };
}

async function completeNormalBundleRequest(tab) {
  let result = null;
  let state = await getBundleActionState(tab.id);
  if (!state?.canDecide && !state?.canConfirm && !state?.complete) {
    result = await clickBundleActionAndFollowTab(tab, 'close');
    if (!result?.success) return result;
    tab = result.tab;

    result = await clickBundleActionAndFollowTab(tab, 'start', state => state.canStart || state.canInputTransaction || state.canDecide || state.complete);
    if (!result?.success) return result;
    tab = result.tab;

    state = await getBundleActionState(tab.id);
  }

  if (state?.canStart && !state?.canDecide && !state?.canConfirm && !state?.complete) {
    result = await clickBundleActionAndFollowTab(tab, 'start', state => state.canInputTransaction || state.canDecide || state.complete);
    if (!result?.success) return result;
    tab = result.tab;
    state = await getBundleActionState(tab.id);
  }

  if (state?.canInputTransaction && !state?.canDecide && !state?.canConfirm && !state?.complete) {
    result = await clickBundleActionAndFollowTab(tab, 'input', state => state.canPlacementOk || state.canDecide || state.complete);
    if (!result?.success) return result;
    tab = result.tab;
    state = await getBundleActionState(tab.id);
  }

  if (state?.canPlacementOk && !state?.canDecide && !state?.canConfirm && !state?.complete) {
    result = await clickBundleActionAndFollowTab(tab, 'placementOk', state => state.canDecide || state.complete);
    if (!result?.success) return result;
    tab = result.tab;
    state = await getBundleActionState(tab.id);
  }

  if (state?.complete) {
    return { success: true, tab };
  }

  if (state?.canConfirm) {
    result = await clickBundleActionAndFollowTab(tab, 'confirm');
    if (!result?.success) return result;
    return { success: true, tab: result.tab };
  }

  result = await clickBundleActionAndFollowTab(tab, 'decide', state => state.canConfirm || state.complete);
  if (!result?.success) return result;
  tab = result.tab;
  state = await getBundleActionState(tab.id);
  if (state?.canConfirm) {
    result = await clickBundleActionAndFollowTab(tab, 'confirm');
    if (!result?.success) return result;
    return { success: true, tab: result.tab };
  }
  return { success: true, tab };
}

async function completeBidderPaysShippingTransaction(tab) {
  let state = await getBundleActionState(tab.id);
  if (state?.canPlacementOk) {
    const okResult = await clickBundleActionAndFollowTab(tab, 'placementOk', state => state.canDecide || state.waitingShipping);
    if (!okResult?.success) return okResult;
    tab = okResult.tab;
    state = await getBundleActionState(tab.id);
  }
  if (state?.waitingShipping) {
    return { success: true, tab };
  }

  let result = await clickBundleActionAndFollowTab(tab, 'decide', state => state.canConfirm || state.waitingShipping);
  if (!result?.success) return result;
  tab = result.tab;

  state = await getBundleActionState(tab.id);
  if (state?.waitingShipping) {
    return { success: true, tab };
  }

  result = await clickBundleActionAndFollowTab(tab, 'confirm', state => state.waitingShipping);
  if (!result?.success) return result;
  return { success: true, tab: result.tab };
}

function shouldCompleteFixedShippingTransactionInfo(state) {
  return !!(
    state?.canPlacementOk ||
    state?.canDecide ||
    state?.canConfirm
  );
}

async function completeFixedShippingTransactionInfo(tab) {
  let state = await getBundleActionState(tab.id);
  if (!shouldCompleteFixedShippingTransactionInfo(state)) {
    return { success: true, tab, skipped: true };
  }

  let result = null;
  if (state?.canPlacementOk) {
    result = await clickBundleActionAndFollowTab(tab, 'placementOk', state => state.canDecide || state.paymentReady);
    if (!result?.success) return result;
    tab = result.tab;
    state = await getBundleActionState(tab.id);
  }

  if (state?.canDecide) {
    result = await clickBundleActionAndFollowTab(tab, 'decide', state => state.canConfirm || state.paymentReady || state.complete);
    if (!result?.success) return result;
    tab = result.tab;
    state = await getBundleActionState(tab.id);
  }

  if (state?.canConfirm) {
    result = await clickBundleActionAndFollowTab(tab, 'confirm', state => state.paymentReady || state.complete);
    if (!result?.success) return result;
    tab = result.tab;
  }

  return { success: true, tab };
}

async function executeTransactionStartJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TRANSACTION_START_INFO' }).catch(error => {
      console.error('[Yahoo Bid] Failed to extract transaction start info:', error);
      return null;
    });
    await reportYahooLoginStatus(response?.loginStatus);
    if (!response?.success) {
      await updateTransactionStartStatus({ orderId: job.orderId, error: response?.loginStatus?.message || 'transaction page extraction failed' });
      if (response?.loginStatus?.status === 'failed') {
        return { stop: true, processedProductIds: [job.productId] };
      }
      return;
    }
    const info = response.info || {};
    const initialState = await getBundleActionState(tab.id).catch(() => null);
    if (initialState?.cancelled) {
      await updateTransactionStartStatus({ orderId: job.orderId, status: 'cancelled' });
      return { processedProductIds: [job.productId] };
    }
    if (info.available) {
      if (!info.quantityMatched) {
        await updateTransactionStartStatus({ orderId: job.orderId, error: 'bundle quantity mismatch' });
        return;
      }
      const bundleProductIds = info.productIds || [];
      const result = await completeNormalBundleRequest(tab);
      if (!result?.success) {
        await postTransactionStartDiagnostic(job, result?.tab || tab, result?.error || 'normal bundle request failed', 'error', {
          bundleProductIds: bundleProductIds.join('|')
        }).catch(() => {});
        await updateTransactionStartStatus({
          productIds: bundleProductIds.length ? bundleProductIds : [job.productId],
          error: result?.error || 'normal bundle request failed'
        });
        return { processedProductIds: bundleProductIds.length ? bundleProductIds : [job.productId] };
      }
      tab = result.tab;
      const completed = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_TRANSACTION_START_INFO' }).catch(() => null);
      if (!completed?.complete) {
        await updateTransactionStartStatus({
          productIds: bundleProductIds.length ? bundleProductIds : [job.productId],
          error: 'bundle completion text not found'
        });
        return { processedProductIds: bundleProductIds.length ? bundleProductIds : [job.productId] };
      }
      const bundleGroupId = `bundle-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${job.productId}`;
      await updateTransactionStartStatus({
        productIds: bundleProductIds,
        status: 'pending_bundle',
        bundleGroupId
      });
      return { processedProductIds: bundleProductIds };
    }
    if (isBidderPaysShippingText(job.shippingFeeText)) {
      const result = await completeBidderPaysShippingTransaction(tab);
      if (!result?.success) {
        await updateTransactionStartStatus({ orderId: job.orderId, error: result?.error || 'bidder pays shipping confirmation failed' });
        return { processedProductIds: [job.productId] };
      }
      tab = result.tab;
      await updateTransactionStartStatus({ orderId: job.orderId, status: 'waiting_shipping' });
    } else {
      const result = await completeFixedShippingTransactionInfo(tab);
      if (!result?.success) {
        await updateTransactionStartStatus({ orderId: job.orderId, error: result?.error || 'fixed shipping transaction info failed' });
        return { processedProductIds: [job.productId] };
      }
      tab = result.tab;
      await updateTransactionStartStatus({ orderId: job.orderId, status: 'pending_payment' });
    }
    return { processedProductIds: [job.productId] };
  } catch (e) {
    await postTransactionStartDiagnostic(job, tab, e.message || 'transaction start failed', 'error').catch(() => {});
    await updateTransactionStartStatus({ orderId: job.orderId, error: e.message || 'transaction start failed' }).catch(() => {});
    return { processedProductIds: [job.productId] };
  } finally {
    await closeTabsForTransactionFlow(tab, beforeTabIds);
  }
}

async function runTransactionStartJobs(options = {}) {
  const jobs = await fetchTransactionStartJobs(options);
  if (options.processNormalJobs === false) {
    return;
  }
  const processedProducts = new Set();
  for (const job of jobs) {
    if (processedProducts.has(String(job.productId || '').toLowerCase())) continue;
    const result = await executeTransactionStartJob(job);
    for (const productId of result?.processedProductIds || []) {
      processedProducts.add(String(productId || '').toLowerCase());
    }
    if (result?.stop) break;
  }
}

async function closeTabsForTransactionFlow(tab, beforeTabIds = new Set()) {
  const ids = new Set(tab?._gdaipaiCreatedTabIds || []);
  if (tab?.id && !isManualVerificationTab(tab)) ids.add(tab.id);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const candidate of tabs) {
    if (!candidate?.id || beforeTabIds.has(candidate.id)) continue;
    if (isManualVerificationTab(candidate)) continue;
    if (isLikelyYahooTransactionCleanupTab(candidate)) ids.add(candidate.id);
  }
  for (const id of ids) {
    const current = await chrome.tabs.get(id).catch(() => null);
    if (current && isManualVerificationTab(current)) continue;
    if (current && !isLikelyYahooTransactionCleanupTab(current)) continue;
    await closeTabIfExists(id);
  }
}

async function closeTabsForScanFlow(tab, beforeTabIds = new Set()) {
  const ids = new Set(tab?._gdaipaiCreatedTabIds || []);
  if (tab?.id && !isManualVerificationTab(tab)) ids.add(tab.id);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const candidate of tabs) {
    if (!candidate?.id || beforeTabIds.has(candidate.id)) continue;
    if (isManualVerificationTab(candidate)) continue;
    if (isLikelyYahooTransactionCleanupTab(candidate)) ids.add(candidate.id);
  }
  for (const id of ids) {
    const current = await chrome.tabs.get(id).catch(() => null);
    if (current && isManualVerificationTab(current)) continue;
    if (current && !isLikelyYahooTransactionCleanupTab(current)) continue;
    await closeTabIfExists(id);
  }
}

function buildScanStatusPayload(job) {
  const result = job?.result || {};
  if (!job?.orderId) return null;
  if (job.orderStatus === 'pending_shipment') {
    if (result.type === 'cancelled') {
      return {
        orderId: job.orderId,
        cancelled: true
      };
    }
    if (result.type === 'shipped') {
      if (result.shipmentDetailsRendered === false) return null;
      return {
        orderId: job.orderId,
        shipped: true,
        trackingRescanRequested: job.trackingRescanRequested === true,
        shippingCompany: result.shippingCompany || '',
        trackingNumber: result.trackingNumber || ''
      };
    }
    if (result.type === 'pending_shipment') {
      if (job.trackingRescanRequested === true) return null;
      const sinceMs = parseTimeMs(job.pendingShipmentSince);
      const daysOverdue = Number.isFinite(sinceMs)
        ? Math.floor((Date.now() - sinceMs) / (24 * 60 * 60 * 1000))
        : 0;
      return {
        orderId: job.orderId,
        pendingShipment: true,
        productId: job.productId,
        productTitle: job.productTitle,
        daysOverdue
      };
    }
    return null;
  }
  if (job.orderStatus === 'pending_bundle') {
    if (result.type === 'bundle_rejected') {
      return {
        orderId: job.orderId,
        bundleRejected: true
      };
    }
    if (result.type === 'shipping_ready' && result.bundleShippingFeeText) {
      return {
        orderId: job.orderId,
        bundleShippingFeeText: result.bundleShippingFeeText
      };
    }
    if (result.type) {
      return {
        orderId: job.orderId,
        noProgress: true,
        resultType: result.type
      };
    }
    return null;
  }
  if (result.pending) {
    return {
      orderId: job.orderId,
      pending: true
    };
  }
  if (!result.hasShippingFee || !result.shippingFeeText) return null;
  return {
    orderId: job.orderId,
    shippingFeeText: result.shippingFeeText
  };
}

async function executePendingShipmentScanJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    const response = await waitForPendingShipmentScanResult(tab, job);
    if (response?.stop) return { stop: true };
    if (!response?.success) return { stop: false };
    const payload = buildScanStatusPayload({ ...job, result: response.result });
    if (payload) await updateScanStatus(payload);
    return { stop: false };
  } catch (e) {
    console.warn('[Yahoo Bid] Pending shipment scan job failed:', e.message || e);
    return { stop: false };
  } finally {
    await closeTabsForScanFlow(tab, beforeTabIds);
  }
}

async function readPendingShipmentScanResult(tab) {
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PENDING_SHIPMENT_SCAN' }).catch(error => {
    console.error('[Yahoo Bid] Failed to extract pending shipment scan:', error);
    return null;
  });
  await reportYahooLoginStatus(response?.loginStatus);
  if (response?.loginStatus?.status === 'failed') return { stop: true, success: false, loginStatus: response.loginStatus };
  return response;
}

function isRenderedPendingShipmentScanResult(result = {}, job = {}) {
  if (result.type === 'shipped') {
    return !result.trackingFallback || result.shipmentDetailsRendered !== false;
  }
  if (result.type === 'cancelled') return true;
  if (result.type !== 'pending_shipment') return false;
  return job.productType !== 'store';
}

async function waitForPendingShipmentScanResult(tab, job = {}, timeoutMs = PENDING_SHIPMENT_SCAN_RENDER_WAIT_MS) {
  const startAt = Date.now();
  let latestResponse = null;
  let attempt = 0;
  while (Date.now() - startAt <= timeoutMs) {
    attempt += 1;
    const response = await readPendingShipmentScanResult(tab);
    if (response?.stop) return response;
    if (response?.success) {
      latestResponse = response;
      if (isRenderedPendingShipmentScanResult(response.result || {}, job)) {
        return response;
      }
    }
    await sleep(PENDING_SHIPMENT_SCAN_POLL_MS);
  }
  if (latestResponse?.success) {
    await postScanDiagnostic(
      job,
      latestResponse.result,
      `pending shipment scan render wait timed out after ${attempt} reads: ${latestResponse.result?.type || 'unknown'}`
    ).catch(() => {});
  }
  return latestResponse || { success: false };
}

async function executeWaitingShippingScanJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_WAITING_SHIPPING_SCAN' }).catch(error => {
      console.error('[Yahoo Bid] Failed to extract waiting shipping scan:', error);
      return null;
    });
    await reportYahooLoginStatus(response?.loginStatus);
    if (response?.loginStatus?.status === 'failed') return { stop: true };
    if (!response?.success) return { stop: false };
    const payload = buildScanStatusPayload({ ...job, result: response.result });
    if (payload) await updateScanStatus(payload);
    return { stop: false };
  } catch (e) {
    console.warn('[Yahoo Bid] Waiting shipping scan job failed:', e.message || e);
    return { stop: false };
  } finally {
    const ids = new Set(tab?._gdaipaiCreatedTabIds || []);
    if (tab?.id) ids.add(tab.id);
    for (const id of ids) {
      await closeTabIfExists(id);
    }
  }
}

async function extractBundleScanResult(tab) {
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_BUNDLE_SCAN' }).catch(error => {
    console.error('[Yahoo Bid] Failed to extract bundle scan:', error);
    return null;
  });
  await reportYahooLoginStatus(response?.loginStatus);
  if (response?.loginStatus?.status === 'failed') return { stop: true, result: null };
  return { stop: false, result: response?.success ? response.result : null };
}

function shouldAttemptBundleInputAction(result, state) {
  return ['unknown', 'waiting_agreement', 'shipping_pending', 'input_required'].includes(result?.type) && (
    !!state?.canInputTransaction ||
    !!state?.canPlacementOk ||
    !!state?.canDecide ||
    !!state?.canConfirm ||
    !!state?.waitingShipping
  );
}

async function executePendingBundleScanJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  let noProgressReported = false;
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    let extracted = await extractBundleScanResult(tab);
    if (extracted.stop) return { stop: true };
    let result = extracted.result;

    if (result?.type === 'main_agreed') {
      const closeResult = await clickBundleActionAndFollowTab(tab, 'close');
      if (!closeResult?.success) return { stop: false };
      tab = closeResult.tab;
      extracted = await extractBundleScanResult(tab);
      if (extracted.stop) return { stop: true };
      result = extracted.result;
    }

    if (result?.type === 'shipping_ready' || result?.type === 'bundle_rejected') {
      const payload = buildScanStatusPayload({ ...job, result });
      if (payload) await updateScanStatus(payload);
      return { stop: false, processedBundleGroupId: job.bundleGroupId || null };
    }

    if (['unknown', 'waiting_agreement', 'shipping_pending', 'input_required'].includes(result?.type)) {
      let state = await getBundleActionState(tab.id);
      if (shouldAttemptBundleInputAction(result, state)) {
        let clickResult = null;
        if (state?.canInputTransaction) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'input', state => state.canPlacementOk || state.canDecide || state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
          state = await getBundleActionState(tab.id);
        }
        if (state?.canPlacementOk) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'placementOk', state => state.canDecide || state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
          state = await getBundleActionState(tab.id);
        }
        if (!state?.waitingShipping && state?.canDecide) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'decide', state => state.canConfirm || state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
          state = await getBundleActionState(tab.id);
        }
        if (!state?.waitingShipping && state?.canConfirm) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'confirm', state => state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
        }

        extracted = await extractBundleScanResult(tab);
        if (extracted.stop) return { stop: true };
        result = extracted.result;
        const payload = buildScanStatusPayload({ ...job, result });
        if (payload?.noProgress) {
          await postScanDiagnostic(job, result, `bundle scan no progress: ${payload.resultType || 'unknown'}`);
          noProgressReported = true;
        } else if (payload) {
          await updateScanStatus(payload);
        }
        if (payload?.bundleShippingFeeText || payload?.bundleRejected) {
          return { stop: false, processedBundleGroupId: job.bundleGroupId || null };
        }
      }
    }
    if (result?.type && !noProgressReported) {
      await postScanDiagnostic(job, result, `bundle scan no progress: ${result.type}`);
    }
    return { stop: false };
  } catch (e) {
    await postScanDiagnostic(job, null, `pending bundle scan failed: ${e.message || e}`, 'error').catch(() => {});
    console.warn('[Yahoo Bid] Pending bundle scan job failed:', e.message || e);
    return { stop: false };
  } finally {
    await closeTabsForScanFlow(tab, beforeTabIds);
  }
}

async function runScanJobs() {
  const jobs = await fetchScanJobs();
  const processedBundleGroups = new Set();
  for (const job of jobs) {
    if (job.bundleGroupId && processedBundleGroups.has(job.bundleGroupId)) continue;
    const result = job.orderStatus === 'pending_bundle'
      ? await executePendingBundleScanJob(job)
      : (job.orderStatus === 'pending_shipment'
        ? await executePendingShipmentScanJob(job)
        : await executeWaitingShippingScanJob(job));
    if (result?.processedBundleGroupId) {
      processedBundleGroups.add(result.processedBundleGroupId);
    }
    if (result?.stop) break;
  }
}

async function executePaymentJob(job, paymentBatch = {}) {
  let tab = null;
  let state = null;
  const beforeTabIds = await getTabIds();
  const maxPageStaySeconds = Math.max(1, Math.floor(Number(paymentBatch.paymentPageStaySeconds ?? job.paymentPageStaySeconds ?? 3)));
  let storeConfirmationStarted = false;
  let storeConfirmationCompleted = false;
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    state = await getPaymentPageState(tab.id);
    ({ tab, state } = await waitForStoreStatusPaymentEntryRender(tab, job, state));
    let storeConfirmationHandled = false;
    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };

    if (state?.hasTransactionInfoInputButton) {
      const result = await completePaymentTransactionInfoInput(tab, state);
      if (!result?.success) throw new Error(result?.error || 'transaction info input flow failed');
      tab = result.tab;
      state = result.state;
    }

    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };

    if (state?.hasStoreBundlePurchaseNotice && state?.hasPaymentCloseButton) {
      const closeResult = await clickPaymentActionAndFollowTab(tab, 'paymentClose', nextState =>
        nextState.alreadyPaid ||
        nextState.complete ||
        nextState.hasSinglePurchaseProcedureButton ||
        nextState.hasPurchaseProcedureButton ||
        nextState.hasEasyPaymentButton ||
        nextState.hasReviewButton
      );
      if (!closeResult?.success) throw new Error(closeResult?.error || 'store bundle popup close failed');
      tab = closeResult.tab;
      state = closeResult.state;
    }

    let entryClicks = 0;
    while (!state?.alreadyPaid && !state?.complete && !state?.hasReviewButton && entryClicks < 3) {
      let result = null;
      if (state?.hasSinglePurchaseProcedureButton) {
        result = await clickPaymentActionAndFollowTab(tab, 'singlePurchaseProcedure', nextState =>
          nextState.alreadyPaid || nextState.complete || nextState.hasEasyPaymentButton || nextState.hasReviewButton
        );
        if (!result?.success) throw new Error(result?.error || 'single purchase procedure button click failed');
      } else if (state?.hasEasyPaymentButton) {
        result = await clickPaymentActionAndFollowTab(tab, 'easyPayment', nextState =>
          nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton
        );
        if (!result?.success) throw new Error(result?.error || 'easy payment button click failed');
      } else if (state?.hasPurchaseProcedureButton) {
        result = await clickPaymentActionAndFollowTab(tab, 'purchaseProcedure', nextState =>
          nextState.alreadyPaid || nextState.complete || nextState.hasEasyPaymentButton || nextState.hasReviewButton
        );
        if (!result?.success) throw new Error(result?.error || 'purchase procedure button click failed');
      } else {
        break;
      }
      entryClicks += 1;
      tab = result.tab;
      state = result.state;
      if (state?.cancelled) return { cancelled: true };
    }

    if (!state?.alreadyPaid && !state?.complete && !state?.hasReviewButton) {
      const reviewTab = await waitForPaymentStateOnTab(tab, nextState =>
        nextState.cancelled || nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
        15000
      );
      if (reviewTab) {
        tab = reviewTab;
        state = reviewTab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
      }
    }
    if (state?.cancelled) return { cancelled: true };
    state = await waitForStoreConfirmationSectionBeforeReview(tab, job, state);
    if (PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED && state?.hasStoreConfirmationSection && !storeConfirmationHandled) {
      storeConfirmationStarted = true;
      const storeResult = await completeStoreConfirmationItems(tab, state, job);
      if (!storeResult?.success) throw new Error(storeResult?.error || 'store confirmation flow failed');
      tab = storeResult.tab;
      state = storeResult.state;
      storeConfirmationHandled = true;
      storeConfirmationCompleted = true;
    }
    if (!entryClicks && !state?.hasReviewButton && !state?.alreadyPaid && !state?.complete) {
      throw new Error('payment entry button not found');
    }

    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    if (!state?.hasReviewButton) {
      const reviewTab = await waitForPaymentStateOnTab(tab, nextState =>
        nextState.cancelled || nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
        15000
      );
      if (reviewTab) {
        tab = reviewTab;
        state = reviewTab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
      }
    }
    state = await waitForStoreConfirmationSectionBeforeReview(tab, job, state);
    if (PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED && state?.hasStoreConfirmationSection && !storeConfirmationHandled) {
      storeConfirmationStarted = true;
      const storeResult = await completeStoreConfirmationItems(tab, state, job);
      if (!storeResult?.success) throw new Error(storeResult?.error || 'store confirmation flow failed');
      tab = storeResult.tab;
      state = storeResult.state;
      storeConfirmationHandled = true;
      storeConfirmationCompleted = true;
    }
    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    if (!state?.hasReviewButton) {
      throw new Error(storeConfirmationHandled ? 'payment review button not found after store confirmation' : 'payment review button not found');
    }
    state = await waitForExpectedPaymentAmount(tab, job, state);
    if (getExpectedPaymentAmountJpy(job) !== null && Number(state?.paymentAmountJpy || 0) !== getExpectedPaymentAmountJpy(job)) {
      state = await ensurePaymentShippingOption(tab, job, state);
    }
    if (state?.hasAppraisalSection && !state?.hasNoAppraisalSelected) {
      const appraisalResult = await selectPaymentNoAppraisalOption(tab.id);
      if (!appraisalResult?.success) throw new Error(appraisalResult?.error || 'payment no-appraisal selection failed');
      state = await getPaymentPageState(tab.id) || state;
    }
    state = await waitForExpectedPaymentAmount(tab, job, state);
    state = await waitForStoreConfirmationSectionBeforeReview(tab, job, state);
    if (PAYMENT_STORE_CONFIRMATION_FLOW_ENABLED && state?.hasStoreConfirmationSection && !storeConfirmationHandled) {
      storeConfirmationStarted = true;
      const storeResult = await completeStoreConfirmationItems(tab, state, job);
      if (!storeResult?.success) throw new Error(storeResult?.error || 'store confirmation flow failed');
      tab = storeResult.tab;
      state = storeResult.state;
      storeConfirmationHandled = true;
      storeConfirmationCompleted = true;
    }
    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    assertPaymentAmountMatches(job, state);

    let result = await clickPaymentActionAndFollowTab(tab, 'review', nextState =>
      nextState.alreadyPaid || nextState.complete || nextState.hasFinalizeButton
    );
    if (!result?.success) throw new Error(result?.error || 'payment review click failed');
    tab = result.tab;
    state = result.state;

    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    if (!state?.hasFinalizeButton) throw new Error('payment finalize button not found');
    assertPaymentAmountMatches(job, state);

    const pageStaySeconds = getRandomIntInclusive(1, maxPageStaySeconds);
    await sleep(pageStaySeconds * 1000);
    const previousTabIds = await getTabIds();
    const finalClick = await runMainWorldPaymentActionClick(tab.id, 'finalize');
    if (!finalClick?.success) throw new Error(finalClick?.error || 'payment finalize click failed');

    try {
      tab = await waitForPaymentStateAcrossTabs(tab, nextState =>
        nextState.cancelled || nextState.alreadyPaid || nextState.complete,
        previousTabIds,
        PAYMENT_FINALIZE_COMPLETE_TIMEOUT_MS
      );
    } catch (e) {
      throw new Error(`payment completion page did not appear within 15s: ${e.message || e}`);
    }
    state = tab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
    if (state?.cancelled) return { cancelled: true };
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    throw new Error('payment completion text not found');
  } catch (error) {
    if (state && !error.gDaipaiPaymentState && !error.paymentState) {
      error.gDaipaiPaymentState = state;
    }
    throw error;
  } finally {
    if (!storeConfirmationStarted || storeConfirmationCompleted) {
      await closeTabsForTransactionFlow(tab, beforeTabIds);
    } else {
      console.warn('[Yahoo Bid] Payment tab left open for store confirmation diagnosis:', tab?.id, tab?.url);
    }
  }
}

async function runPaymentJobs() {
  const result = await fetchPaymentJobs();
  const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
  if (!jobs.length) {
    await updatePaymentStatus({ empty: true });
    return;
  }
  for (const job of jobs) {
    try {
      const paymentResult = await executePaymentJob(job, result);
      if (paymentResult?.cancelled) {
        await updatePaymentStatus({ orderId: job.orderId, productId: job.productId, status: 'cancelled' });
        continue;
      }
      if (paymentResult?.alreadyPaid || paymentResult?.success) {
        await updatePaymentStatus({ orderId: job.orderId, productId: job.productId, status: 'success' });
        continue;
      }
      throw new Error(paymentResult?.error || 'payment failed');
    } catch (error) {
      await updatePaymentStatus(buildPaymentFailurePayload(job, error));
      break;
    }
  }
}

async function executeConfirmReceiptJob(job) {
  if (job.jobType === 'cancel_check') {
    let tab = null;
    const beforeTabIds = await getTabIds();
    try {
      tab = await openTransactionPage(job, beforeTabIds);
      const state = await waitForConfirmReceiptCancelCheckState(tab.id);
      if (state?.cancelled) {
        await updateConfirmReceiptStatus({
          orderId: job.orderId,
          productId: job.productId,
          status: 'cancelled',
          bundleGroupId: job.bundleGroupId || ''
        });
        return { success: true, cancelled: true };
      }
      if (state?.paidOrShipped) {
        await updateConfirmReceiptStatus({
          orderId: job.orderId,
          productId: job.productId,
          status: 'pending_shipment',
          bundleGroupId: job.bundleGroupId || ''
        });
        return { success: true, pendingShipment: true };
      }
      return { success: true, skippedCancelCheck: true };
    } finally {
      await closeTabsForTransactionFlow(tab, beforeTabIds);
    }
  }
  if (job.productType === 'store') {
    await updateConfirmReceiptStatus({
      orderId: job.orderId,
      productId: job.productId,
      status: 'success',
      bundleGroupId: job.bundleGroupId || ''
    });
    return { success: true, store: true };
  }
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job, beforeTabIds);
    let state = await waitForConfirmReceiptRenderedState(tab.id);
    if (state?.cancelled) {
      await updateConfirmReceiptStatus({
        orderId: job.orderId,
        productId: job.productId,
        status: 'cancelled',
        bundleGroupId: job.bundleGroupId || ''
      });
      return { success: true, cancelled: true };
    }
    if (state?.complete) {
      await updateConfirmReceiptStatus({
        orderId: job.orderId,
        productId: job.productId,
        status: 'already_completed',
        bundleGroupId: job.bundleGroupId || ''
      });
      return { success: true, alreadyCompleted: true };
    }
    if (!state?.hasReceiptCheckbox) {
      throw new Error(`receipt checkbox not found${state?.textSample ? `; pageSample: ${state.textSample}` : ''}`);
    }
    const checkboxResult = await clickConfirmReceiptCheckbox(tab.id);
    if (!checkboxResult?.success) throw new Error(checkboxResult?.error || 'receipt checkbox click failed');
    await sleep(800);
    state = await getConfirmReceiptPageState(tab.id);
    if (!state?.complete && (!state?.hasReceiptCheckboxChecked || state?.receiptSubmitButtonDisabled)) {
      const trustedCheckbox = await dispatchTrustedConfirmReceiptCheckboxClick(tab);
      if (trustedCheckbox?.success) {
        const readyTab = await waitForConfirmReceiptState(tab, nextState =>
          nextState.complete ||
          nextState.hasReceiptCheckboxChecked ||
          (nextState.hasReceiptSubmitButton && !nextState.receiptSubmitButtonDisabled),
          5000
        );
        if (readyTab) {
          tab = readyTab;
          state = readyTab._gdaipaiConfirmReceiptState || await getConfirmReceiptPageState(tab.id);
        } else {
          state = await getConfirmReceiptPageState(tab.id);
        }
      } else {
        console.warn('[Yahoo Bid] Trusted receipt checkbox click failed:', trustedCheckbox?.error || trustedCheckbox);
      }
    }
    if (!state?.hasReceiptSubmitButton || state?.receiptSubmitButtonDisabled) {
      const readyTab = await waitForConfirmReceiptState(tab, nextState =>
        nextState.complete ||
        (nextState.hasReceiptSubmitButton && !nextState.receiptSubmitButtonDisabled),
        5000
      );
      if (readyTab) {
        tab = readyTab;
        state = readyTab._gdaipaiConfirmReceiptState || await getConfirmReceiptPageState(tab.id);
      }
    }
    if (state?.complete) {
      await updateConfirmReceiptStatus({
        orderId: job.orderId,
        productId: job.productId,
        status: 'already_completed',
        bundleGroupId: job.bundleGroupId || ''
      });
      return { success: true, alreadyCompleted: true };
    }
    if (state?.cancelled) {
      await updateConfirmReceiptStatus({
        orderId: job.orderId,
        productId: job.productId,
        status: 'cancelled',
        bundleGroupId: job.bundleGroupId || ''
      });
      return { success: true, cancelled: true };
    }
    if (!state?.hasReceiptSubmitButton) {
      throw new Error(`receipt submit button not found${state?.textSample ? `; pageSample: ${state.textSample}` : ''}`);
    }
    if (state?.receiptSubmitButtonDisabled) {
      throw new Error(`receipt submit button disabled after checkbox click${state?.textSample ? `; pageSample: ${state.textSample}` : ''}`);
    }
    const submitResult = await clickConfirmReceiptSubmit(tab.id);
    if (!submitResult?.success) throw new Error(submitResult?.error || 'receipt submit click failed');
    const completeTab = await waitForConfirmReceiptState(tab, nextState => nextState.complete, 15000);
    if (!completeTab) throw new Error('receipt completion text not found');
    tab = completeTab;
    await updateConfirmReceiptStatus({
      orderId: job.orderId,
      productId: job.productId,
      status: 'success',
      bundleGroupId: job.bundleGroupId || ''
    });
    return { success: true };
  } finally {
    await closeTabsForTransactionFlow(tab, beforeTabIds);
  }
}

async function executeYahooMessageJob(job) {
  const beforeTabIds = await getTabIds();
  let tab = null;
  try {
    const result = await withTimeout((async () => {
      tab = await openTransactionPage(job, beforeTabIds);
      if (job.jobType === 'send') {
        const sendResult = await sendYahooTradeMessage(tab.id, job.sendText || '');
        if (!sendResult?.success) throw new Error(sendResult?.error || 'message send failed');
        await updateYahooMessageStatus({
          orderId: job.orderId,
          productId: job.productId,
          jobType: 'send'
        });
        return { success: true };
      }
      const extractResult = await extractYahooTradeMessages(tab.id);
      if (!extractResult?.success) throw new Error(extractResult?.error || 'message extraction failed');
      await updateYahooMessageStatus({
        orderId: job.orderId,
        productId: job.productId,
        jobType: 'fetch',
        messageHtml: extractResult.messageHtml
      });
      return { success: true };
    })(), MESSAGE_JOB_TIMEOUT_MS, () => new Error('message job timeout after 30s'));
    return result;
  } catch (error) {
    await updateYahooMessageStatus({
      orderId: job.orderId,
      productId: job.productId,
      jobType: job.jobType === 'send' ? 'send' : 'fetch',
      error: error?.message || String(error || 'message job failed')
    }).catch(() => {});
    return { success: false, error: error?.message || String(error || 'message job failed') };
  } finally {
    if (tab?._gdaipaiCreatedTabIds) {
      await closeTabsForTransactionFlow(tab._gdaipaiCreatedTabIds).catch(() => {});
    } else if (tab?.id) {
      await closeTaskTab(tab.id).catch(() => {});
    }
  }
}

async function runYahooMessageJobs() {
  const jobs = await fetchYahooMessageJobs();
  for (const job of jobs) {
    await executeYahooMessageJob(job);
  }
  return jobs.length;
}

async function runConfirmReceiptJobs() {
  const jobs = await fetchConfirmReceiptJobs();
  if (!jobs.length) {
    await updateConfirmReceiptStatus({ empty: true });
    return;
  }
  for (const job of jobs) {
    try {
      await executeConfirmReceiptJob(job);
    } catch (error) {
      await updateConfirmReceiptStatus(buildConfirmReceiptFailurePayload(job, error)).catch(() => {});
      break;
    }
  }
}

async function syncIdleYahooPages() {
  await refreshPluginConfig();
  const now = Date.now();
  if (await pauseIdleWorkForOpenManualPin()) {
    return;
  }
  if (now - lastIdleSyncAt < idleSyncIntervalMs) {
    return;
  }
  lastIdleSyncAt = now;
  await openBiddingPageForSync();
  await openWonPageForSync();
  await executeNextWorkflowAction();
}

async function syncMonitorYahooPages() {
  if (monitorRunning) return;
  await refreshPluginConfig();
  const now = Date.now();
  if (now - lastMonitorSyncAt < idleSyncIntervalMs) return;
  monitorRunning = true;
  lastMonitorSyncAt = now;
  try {
    await openBiddingPageForSync({ closeAfter: true });
    await openWonPageForSync({ closeAfter: true });
  } catch (error) {
    if (isTabsTemporarilyUneditableError(error)) {
      lastMonitorSyncAt = 0;
      console.warn('[Yahoo Bid] Monitor sync postponed because tabs are temporarily unavailable:', error.message || error);
      return;
    }
    throw error;
  } finally {
    monitorRunning = false;
  }
}

async function runWorkflowAction() {
  if (workflowRunning) return;
  await refreshPluginConfig();
  if (await pauseIdleWorkForOpenManualPin()) {
    return;
  }
  const messageJobCount = await runYahooMessageJobs();
  if (messageJobCount > 0) return;
  const now = Date.now();
  if (now - lastWorkflowSyncAt < idleSyncIntervalMs) return;
  workflowRunning = true;
  lastWorkflowSyncAt = now;
  try {
    await executeNextWorkflowAction();
  } finally {
    workflowRunning = false;
  }
}

async function executeNextWorkflowAction() {
  const idleAction = await fetchNextIdleAction();
  if (idleAction?.action === 'transaction_start') {
    await runTransactionStartJobs({
      includeAfterCutoff: idleAction?.config?.transactionStartRequestSource === 'manual',
      processNormalJobs: TRANSACTION_START_ENABLED
    });
  } else if (idleAction?.action === 'manual_order_import') {
    await runManualOrderImportJobs();
  } else if (idleAction?.action === 'yahoo_message') {
    await runYahooMessageJobs();
  } else if (idleAction?.action === 'confirm_receipt') {
    await runConfirmReceiptJobs();
  } else if (idleAction?.action === 'scan') {
    await runScanJobs();
  } else if (idleAction?.action === 'payment') {
    await runPaymentJobs();
  }
  await completeIdleAction(idleAction?.action || 'none');
}

async function executeBidTask(task, options = {}) {
  if (!task?.id) return;
  console.log('[Yahoo Bid] Executing task:', task.product_url);
  let taskTab = null;
  let taskTimedOut = false;
  let bidStage = 'start';
  const taskExecutionTimeoutMs = getTaskExecutionTimeoutMs(task);
  const taskProgressExtensionMs = getTaskProgressExtensionMs(task);
  const taskExecutionMaxTimeoutMs = getTaskExecutionMaxTimeoutMs(task);
  try {
    await withProgressTimeout((async () => {
          if (!options.alreadyClaimed) {
          bidStage = 'claim-processing';
          const markedProcessing = await markTaskStatus(task.id, 'processing');
          if (taskTimedOut) return;
          if (!markedProcessing?.success) {
            console.log('[Yahoo Bid] Task skipped because it is no longer active:', task.id);
            return;
          }
          }
          bidStage = 'open-task-page';
          taskTab = await openTaskPage(task, {
            onTabCreated(tab) {
              taskTab = tab;
            }
          });
          if (taskTimedOut) {
            await closeTaskTab(taskTab.id);
            return;
          }
          const tab = taskTab;
          bidStage = 'inject-content';
          await injectContentScript(tab.id);
          if (taskTimedOut) return;
          bidStage = 'read-product-snapshot';
          const ready = await ensureTaskReadyByCurrentEndTime(tab, task);
          if (taskTimedOut) return;
          if (!ready) {
            await chrome.storage.session.remove(['currentTask']);
            return;
          }
          bidStage = 'execute-bid';
          const result = await executeTaskInTabV2(tab, task);
          if (taskTimedOut) return;
          await chrome.storage.session.remove(['currentTask']);
          bidStage = 'mark-bidding';
          if (result?.noStatus) {
            // direct 任务命中"已是最高价 + 计划出价≤自动入札上限"时，本次跳过出价。
            // 之前直接 touchTaskSchedule 会把 status 写回 task.status（pending），
            // 导致下一轮轮询又取出来执行，陷入死循环。这里直接标 bidding。
            if (isDirectTask(task)) {
              await markTaskStatus(task.id, 'bidding', null, { bid_price: result?.bidPrice, no_bid: true });
            } else {
              await touchTaskSchedule(task.id, task.status);
            }
          } else {
            await markTaskStatus(task.id, 'bidding', null, { bid_price: result?.bidPrice, no_bid: result?.noBid, not_highest: result?.notHighest });
          }
          if (!shouldKeepTaskTabOpen(task, result)) {
            bidStage = 'close-success-tab';
            await closeTaskTab(tab.id);
          }
          console.log('[Yahoo Bid] Task completed:', task.id, result);
    })(), taskExecutionTimeoutMs, {
      extensionMs: taskProgressExtensionMs,
      maxTimeoutMs: taskExecutionMaxTimeoutMs,
      registerProgressHandler: taskProgressExtensionMs
        ? extend => registerBidProgressExtender(task.id, msg => {
          const remainingMs = extend();
          heartbeatProcessingTask(task.id).catch(() => {});
          console.debug('[Yahoo Bid] Extended multi-bid task timeout:', task.id, msg?.stage || '', Math.round(remainingMs / 1000) + 's remaining');
        })
        : null,
      errorFactory: elapsedMs => {
          taskTimedOut = true;
          return buildTaskTimeoutError(elapsedMs);
      }
    });
  } catch (e) {
    await chrome.storage.session.remove(['currentTask']);
    if (isTransientServerTabError(e) && !options.tabRetryAttempted && !taskTimedOut) {
      console.warn('[Yahoo Bid] Retrying task after transient server tab error:', task.id, e.message || e);
      if (taskTab?.id) await closeTaskTab(taskTab.id).catch(() => {});
      await sleep(1000);
      return await executeBidTask(task, {
        ...options,
        alreadyClaimed: true,
        tabRetryAttempted: true,
        preserveActiveRun: true
      });
    }
    const finalError = isTransientServerTabError(e) ? buildServerTabError(e) : e;
    const tabSnapshot = taskTab?.id ? await getTabPageDiagnosticSnapshot(taskTab.id).catch(error => ({
      tabId: taskTab.id,
      pageError: error?.message || String(error || '')
    })) : {};
    const diagnostics = formatDiagnosticParts({
      stage: bidStage,
      timedOut: taskTimedOut ? 'true' : '',
      taskId: task.id,
      strategy: task.strategy || '',
      bidMode: task.bid_mode || '',
      maxPrice: task.max_price || '',
      currentPrice: task.current_price || '',
      endTime: task.end_time || '',
      tabId: tabSnapshot.tabId || '',
      windowId: tabSnapshot.windowId || '',
      tabStatus: tabSnapshot.tabStatus || '',
      tabActive: tabSnapshot.tabActive === true ? 'true' : '',
      url: tabSnapshot.url || '',
      title: tabSnapshot.title || '',
      body: tabSnapshot.bodyText || '',
      pageError: tabSnapshot.pageError || tabSnapshot.error || ''
    });
    await postBidFailureDiagnostic(task, finalError, {
      diagnostics,
      url: tabSnapshot.url || '',
      timedOut: taskTimedOut
    });
    if (taskTab?.id && e.closeTab) {
      await closeTaskTab(taskTab.id);
    }
    await markTaskStatus(task.id, 'failed', finalError.message);
  } finally {
    if (!options.preserveActiveRun) activeBidRuns.delete(task.id);
  }
}

async function pollBidPool() {
  if (!AUTO_BID_ENABLED) {
    console.log('[Yahoo Bid] Auto bid disabled. Pending tasks remain queued.');
    return;
  }
  await refreshPluginConfig();
  const slots = Math.max(0, bidConcurrencyLimit - activeBidRuns.size);
  if (slots <= 0) return;
  const tasks = await fetchPendingTasks(slots);
  if (!tasks.length) return;
  for (const task of tasks) {
    if (!task?.id || activeBidRuns.has(task.id)) continue;
    const run = executeBidTask(task, { alreadyClaimed: true });
    activeBidRuns.set(task.id, run);
    run.catch(error => console.error('[Yahoo Bid] Bid run failed:', task.id, error?.message || error));
  }
}

async function pollAndExecute() {
  pollBidPool().catch(error => console.error('[Yahoo Bid] Bid pool failed:', error?.message || error));
  syncMonitorYahooPages().catch(error => console.error('[Yahoo Bid] Monitor sync failed:', error?.message || error));
  runWorkflowAction().catch(error => console.error('[Yahoo Bid] Workflow action failed:', error?.message || error));
}

async function startPolling() {
  if (pollingStarted) return;
  pollingStarted = true;
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
  schedulePollingInterval();
  refreshPluginConfig().catch(() => {});
  console.log('[Yahoo Bid] Extension started, polling every', pollIntervalMs / 1000, 's');
}

chrome.runtime.onInstalled.addListener(startPolling);
chrome.runtime.onStartup.addListener(startPolling);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM_NAME) pollAndExecute();
});

globalThis.__G_DAIPAI_BACKGROUND_TEST__ = {
  shouldKeepTaskTabOpen,
  buildTaskTimeoutError,
  getTaskExecutionTimeoutMs,
  getTaskProgressExtensionMs,
  getTaskExecutionMaxTimeoutMs,
  getPendingFinalRetryDelayMs,
  withTimeout,
  withProgressTimeout,
  registerBidProgressExtender,
  handleBidProgressMessage,
  waitForCurrentTabNavigation,
  switchToNewestNewTab,
  openTransactionPage,
  waitForTransactionPageInteractive,
  clickBundleActionAndFollowTab,
  completeNormalBundleRequest,
  completeBidderPaysShippingTransaction,
  waitForBundleActionStateAcrossTabs,
  dispatchTrustedBundleActionClick,
  dispatchTrustedPaymentActionClick,
  selectPaymentNoAppraisalOption,
  dispatchTrustedManualPinKeys,
  dispatchTrustedManualPinInput,
  fillManualPinAnswer,
  findManualVerificationTransitionTab,
  getPaymentActionClickPoint,
  getPaymentShippingChangeClickPoint,
  clickPaymentShippingChangeButton,
  selectPaymentShippingOption,
  revealStorePaymentShippingOptions,
  isLikelyYahooTransactionTab,
  closeTabsForTransactionFlow,
  buildScanStatusPayload,
  executePendingShipmentScanJob,
  shouldAttemptBundleInputAction,
  buildPaymentPageStateFromSnapshot,
  parsePaymentAmountJpyFromText,
  clickStoreConfirmationChange,
  checkAllStoreConfirmationItemsAndApply,
  getStoreConfirmationFormReadiness,
  waitForStoreConfirmationFormReady,
  getStoreConfirmationCheckboxClickPoints,
  dispatchTrustedStoreConfirmationCheckboxes,
  clickStoreConfirmationApplyButton,
  getStoreConfirmationClickPoint,
  dispatchTrustedStoreConfirmationClick,
  completeStoreConfirmationItems,
  waitForStoreConfirmationSectionBeforeReview,
  getRandomIntInclusive,
  assertPaymentAmountMatches,
  syncIdleYahooPages,
  syncMonitorYahooPages,
  executeManualOrderImportJob,
  injectContentScript,
  runWorkflowAction,
  executeBidTask,
  pollBidPool,
  startPolling,
  getActiveBidRunCount: () => activeBidRuns.size,
  pollAndExecute,
  runTransactionStartJobs,
  runPaymentJobs,
  fetchYahooMessageJobs,
  updateYahooMessageStatus,
  getYahooTradeMessageExtractScript,
  getYahooTradeMessageSendScript,
  extractYahooTradeMessages,
  sendYahooTradeMessage,
  executeYahooMessageJob,
  runYahooMessageJobs,
  runConfirmReceiptJobs,
  extractAuctionIdFromText,
  normalizeWorkerIntervalMs,
  applyPluginConfig,
  getPollIntervalMs: () => pollIntervalMs,
  buildConfirmReceiptPageStateFromSnapshot,
  buildPaymentFailurePayload,
  isManualCaptchaTab,
  isTabsTemporarilyUneditableError,
  isNoServiceWorkerLifecycleError,
  isLikelyManualPinTab,
  pauseIdleWorkForOpenManualPin,
  handleManualVerificationIfPresent,
  buildManualCaptchaId,
  pollAndExecute,
  getExpectedPaymentAmountJpy,
  getExpectedPaymentShippingFeeJpy,
  shouldSelectPaymentShippingOption,
  parseYenAmount
};
chrome.tabs.onRemoved.addListener(tabId => {
  managedTaskTabs.delete(tabId);
  for (const [taskId, mappedTabId] of managedTaskTabsByTaskId.entries()) {
    if (mappedTabId === tabId) managedTaskTabsByTaskId.delete(taskId);
  }
});
startPolling();

// Listen for messages from content script or client page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'BID_PROGRESS') {
    const extended = handleBidProgressMessage(msg);
    if (sendResponse) sendResponse({ success: extended });
    return true;
  }
  if (msg.type === 'BID_RESULT') {
    const { taskId, result } = msg;
    if (result?.pendingFinal) {
      console.log('[Yahoo Bid] Waiting for final confirmation page:', taskId, result.stage);
      return;
    }
    chrome.storage.session.remove(['currentTask']);
    if (result.success) {
      if (result.noStatus) {
        // 已是最高价且新出价≤自动入札上限，跳过出价。直接标 bidding，避免任务一直停留 processing/pending。
        markTaskStatus(taskId, 'bidding', null, { bid_price: result.bidPrice, no_bid: true });
      } else {
        markTaskStatus(taskId, 'bidding', null, { bid_price: result.bidPrice, no_bid: result.noBid, not_highest: result.notHighest });
      }
    } else {
      markTaskStatus(taskId, 'failed', result.error || 'bid failed');
    }
    pollAndExecute();
  } else if (msg.type === 'PRODUCT_DATA_REMOVED') {
    // Forward product data to server to cache it
    const { data } = msg;
    if (data && data.auctionId) {
      console.log('[Yahoo Bid] Product data cached:', data.title, 'JPY ' + data.currentPrice);
    }
  } else if (msg.type === 'ORDER_HISTORY') {
    reportYahooLoginStatus(msg.loginStatus);
    syncOrderHistory(msg.orders);
  } else if (msg.type === 'BIDDING_ITEMS') {
    reportYahooLoginStatus(msg.loginStatus);
    syncBiddingItems(msg.items);
  } else if (msg.type === 'GET_PRODUCT') {
    // Client page asking for cached product data
    const { auctionId } = msg;
    chrome.storage.session.get(['cachedProduct']).then(result => {
      const cached = result.cachedProduct;
      if (cached && cached.auctionId === auctionId) {
        sendResponse({ success: true, data: cached });
      } else {
        sendResponse({ success: false });
      }
    });
    return true; // Keep channel open for async sendResponse
  } else if (msg.type === 'FETCH_PRODUCT_REMOVED') {
    fetchProductInfo(msg.url || msg.auctionId)
      .then(async data => {
        await chrome.storage.session.set({ cachedProduct: data });
        sendResponse({ success: true, data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
