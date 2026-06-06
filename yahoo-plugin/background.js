const API_BASES = ['http://127.0.0.1:3034', 'http://localhost:3034'];
const POLL_INTERVAL_MS = 10000;
const POLL_ALARM_NAME = 'poll-pending-tasks';
const AUTO_BID_ENABLED = true;
const TRANSACTION_START_ENABLED = globalThis.__G_DAIPAI_TRANSACTION_START_ENABLED__ !== false;
const TASK_EXECUTION_TIMEOUT_MS = 30000;

let isRunning = false;
let fetchFailureCount = 0;
let idleSyncIntervalMs = 5 * 60 * 1000;
let lastIdleSyncAt = 0;
const managedTaskTabs = new Set();
const managedTaskTabsByTaskId = new Map();

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
      canIdleSync: data.canIdleSync === true,
      idleBidGuardMinutes: Number(data.idleBidGuardMinutes || 10)
    };
  } catch (e) {
    fetchFailureCount += 1;
    const log = fetchFailureCount === 1 || fetchFailureCount % 6 === 0 ? console.warn : console.debug;
    log('[Yahoo Bid] API unavailable, polling will retry:', e.message || e);
    return { task: null, canIdleSync: false, idleBidGuardMinutes: 10 };
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

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const tid = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('��Ʒҳ����س�ʱ'));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId !== tabId || info.status !== 'complete') return;
      clearTimeout(tid);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
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

function withTimeout(promise, timeoutMs, errorFactory = () => buildTaskTimeoutError(timeoutMs)) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(errorFactory()), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function isMessageChannelClosed(error) {
  return /message channel closed|Receiving end does not exist|Could not establish connection/i.test(error?.message || '');
}

async function openTaskPage(task) {
  const auctionId = normalizeAuctionId(task.product_url);
  if (!auctionId) throw new Error('������Ʒ ID ��Ч');

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

  try {
    await waitForTabComplete(tab.id);
  } catch (e) {
    await closeTaskTab(tab.id);
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
    strategy: task.strategy || 'direct'
  });

  if (!result?.success && shouldCloseTaskTab(result)) {
    await closeTaskTab(tab.id);
  }

  if (!result?.success) {
    throw buildBidError(result, 'bid execution failed');
  }

  return result;
}

async function sendBidMessageV2(tabId, task) {
  const auctionId = normalizeAuctionId(task.product_url);
  return chrome.tabs.sendMessage(tabId, {
    type: 'EXECUTE_BID',
    auctionId,
    maxPrice: task.max_price,
    userMaxPrice: task.user_max_price || task.max_price,
      currentPrice: task.current_price || 0,
      taxType: task.tax_type || 'tax_zero',
      multiBidIncrement: task.multi_bid_increment || 0,
      bidMode: task.bid_mode || 'bid',
    strategy: task.strategy || 'direct'
  });
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    console.error('[Yahoo Bid] Failed to inject content script:', e);
    throw e;
  }
}

async function closeTaskTab(tabId) {
  if (!managedTaskTabs.has(tabId)) {
    console.warn('[Yahoo Bid] Skip closing unmanaged tab:', tabId);
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
    throw new Error('�޷���ȡ��Ʒ��ǰ��ֹʱ��');
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
  return error;
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
    await sleep(3000);
    await injectContentScript(tab.id);
    result = await sendBidMessageV2(tab.id, task);
  }

  if (!result?.success && shouldCloseTaskTab(result)) {
    await closeTaskTab(tab.id);
  }

  if (!result?.success) {
    throw buildBidError(result, 'bid execution failed');
  }

  if (result.pendingFinal) {
    await sleep(3000);
    await injectContentScript(tab.id);
    let finalResult;
    try {
      finalResult = await sendBidMessageV2(tab.id, task);
    } catch (e) {
      if (!isMessageChannelClosed(e)) {
        throw e;
      }
      await sleep(3000);
      await injectContentScript(tab.id);
      finalResult = await sendBidMessageV2(tab.id, task);
    }
    if ((!finalResult?.success || finalResult.pendingFinal) && shouldCloseTaskTab(finalResult)) {
      await closeTaskTab(tab.id);
    }

    if (!finalResult?.success || finalResult.pendingFinal) {
      throw new Error(finalResult?.error || 'final bid confirmation failed');
    }
    return finalResult;
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
    extractMeta(html, /class="[^"]*price[^"]*"[^>]*>[\s\S]*?([\d,]+)\s*(?:��|JPY)?/);
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
    title: title || ('��Ʒ ' + auctionId),
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
  if (!Array.isArray(orders)) return;
  try {
    await apiFetch('/api/plugin/orders/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders })
    });
  } catch (e) {
    console.error('[Yahoo Bid] Failed to sync order history:', e);
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
    console.error('[Yahoo Bid] Failed to sync bidding items:', e);
  }
}

async function fetchNextIdleAction() {
  try {
    const res = await apiFetch('/api/plugin/idle-action/next');
    return await res.json();
  } catch (e) {
    console.error('[Yahoo Bid] Failed to fetch idle action:', e);
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
    console.error('[Yahoo Bid] Failed to complete idle action:', e);
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

function buildPaymentFailurePayload(job, error) {
  return {
    orderId: job?.orderId,
    productId: job?.productId,
    error: error?.message || String(error || 'payment failed')
  };
}

function parseYenAmount(value) {
  const text = String(value || '').replace(/\s+/g, '');
  if (!text || /\u7121\u6599/.test(text)) return 0;
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
  const finalPrice = Number(job.finalPrice ?? job.final_price ?? 0);
  const shipping = parseYenAmount(job.effectiveShippingFeeText || job.shippingFeeText || '');
  if (!Number.isFinite(finalPrice) || finalPrice <= 0 || shipping === null) return null;
  return finalPrice + shipping;
}

function getPaymentActionPatternSource(action) {
  const patterns = {
    easyPayment: '\\u0059\\u0061\\u0068\\u006f\\u006f\\u0021\\u304b\\u3093\\u305f\\u3093\\u6c7a\\u6e08\\u3067\\u652f\\u6255\\u3046',
    purchaseProcedure: '\\u8cfc\\u5165\\u624b\\u7d9a\\u304d\\u3059\\u308b',
    transactionInfoInput: '\\u53d6\\u5f15\\u60c5\\u5831\\u3092\\u5165\\u529b\\u3059\\u308b',
    transactionDecide: '^\\s*\\u6c7a\\u5b9a\\u3059\\u308b\\s*$',
    transactionConfirm: '^\\s*\\u78ba\\u5b9a\\u3059\\u308b\\s*$',
    review: '^\\s*\\u78ba\\u8a8d\\u3059\\u308b\\s*$',
    finalize: '\\u8cfc\\u5165\\u3092\\u78ba\\u5b9a\\u3059\\u308b'
  };
  return patterns[action] || '';
}

function buildPaymentPageStateFromSnapshot(snapshot = {}) {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const bodyText = normalize(snapshot.bodyText || '');
  const controls = Array.isArray(snapshot.controls) ? snapshot.controls.map(normalize).filter(Boolean) : [];
  const hasControl = pattern => controls.some(text => pattern.test(text));
  const yenMatches = [...bodyText.matchAll(/([\d,]+)\s*\u5186/g)]
    .map(match => Number(match[1].replace(/,/g, '')) || 0)
    .filter(amount => amount > 0);
  const paymentAmountMatch = bodyText.match(/\u304a\u652f\u6255\u3044\u91d1\u984d[^\d]{0,40}([\d,]+)\s*\u5186/);
  const paymentAmountJpy = paymentAmountMatch
    ? Number(paymentAmountMatch[1].replace(/,/g, '')) || 0
    : (yenMatches.length ? Math.max(...yenMatches) : 0);
  const waitingShipmentText = /\u5546\u54c1\u306e\u767a\u9001\u9023\u7d61\u3092\u304a\u5f85\u3061\u304f\u3060\u3055\u3044/.test(bodyText);
  const alreadyPaid = (/\u51fa\u54c1\u8005\u306b\u652f\u6255\u3044\u5b8c\u4e86\u306e\u9023\u7d61\u3092\u3057\u307e\u3057\u305f/.test(bodyText) && waitingShipmentText)
    || (/\u3054\u8cfc\u5165\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059/.test(bodyText) && waitingShipmentText);
  return {
    url: snapshot.url || '',
    title: snapshot.title || '',
    textSample: bodyText.slice(0, 500),
    controlsSample: controls.slice(0, 20),
    paymentAmountJpy,
    alreadyPaid,
    complete: /\u8cfc\u5165\u304c\u5b8c\u4e86\u3057\u307e\u3057\u305f/.test(bodyText),
    processing: /\u305f\u3060\u3044\u307e\u6c7a\u6e08\u51e6\u7406\u4e2d\u3067\u3059/.test(bodyText),
    hasEasyPaymentButton: hasControl(/Yahoo!\u304b\u3093\u305f\u3093\u6c7a\u6e08\u3067\u652f\u6255\u3046/),
    hasPurchaseProcedureButton: hasControl(/\u8cfc\u5165\u624b\u7d9a\u304d\u3059\u308b/),
    hasTransactionInfoInputButton: hasControl(/\u53d6\u5f15\u60c5\u5831\u3092\u5165\u529b\u3059\u308b/),
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
      const bodyText = normalize(document.body?.textContent || '');
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')]
        .map(el => getText(el))
        .filter(Boolean);
      return {
        success: true,
        snapshot: {
          url: location.href,
          title: document.title || '',
          bodyText,
          controls
        }
      };
    }
  });
  const result = injectionResult?.[0]?.result;
  if (!result?.success) return null;
  if (result.state) return result.state;
  return buildPaymentPageStateFromSnapshot(result.snapshot || {});
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
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')];
      const isClickable = el => {
        const rect = el.getBoundingClientRect?.();
        return rect && rect.width > 0 && rect.height > 0 && !(el.disabled || el.getAttribute?.('aria-disabled') === 'true');
      };
      const isPreferredConfirm = el => actionName === 'review' && /_cl_link:confirm/.test(String(el.getAttribute?.('data-cl-params') || ''));
      const matches = controls.filter(el => pattern.test(getText(el)));
      const button = matches.find(el => isPreferredConfirm(el) && isClickable(el)) ||
        matches.find(el => isClickable(el)) ||
        matches[0];
      if (!button) return { success: false, error: 'payment button not found' };
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
    func: (patternStr) => {
      const pattern = new RegExp(patternStr);
      const getText = el => [
        el.textContent,
        el.value,
        el.title,
        el.getAttribute?.('aria-label')
      ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"], [role="button"]')];
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
      const matches = controls.filter(el => pattern.test(getText(el)));
      const button = matches.find(el => isPreferredConfirm(el) && isClickable(el)) ||
        matches.find(el => isClickable(el)) ||
        matches[0];
      if (!button) return { success: false, error: 'payment button not found for trusted click', candidates: candidates.slice(0, 20) };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      const rect = button.getBoundingClientRect?.();
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
    args: [pattern]
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
    return { success: true, method: 'debuggerMouse', text: point.text, candidates: point.candidates };
  } catch (e) {
    return { success: false, error: e.message || 'trusted payment mouse click failed' };
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
      if (!candidate?.id || !isLikelyYahooTransactionTab(candidate)) continue;
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

function assertPaymentAmountMatches(job, state) {
  const expected = getExpectedPaymentAmountJpy(job);
  const actual = Number(state?.paymentAmountJpy || 0);
  if (expected === null) {
    throw new Error('payment expected amount unavailable');
  }
  if (actual > 0 && actual !== expected) {
    throw new Error(`payment amount mismatch: expected ${expected}\u5186, found ${actual}\u5186`);
  }
}

async function clickPaymentActionAndFollowTab(tab, action, waitFor) {
  const previousTabIds = await getTabIds();
  const clickResult = await runMainWorldPaymentActionClick(tab.id, action);
  if (!clickResult?.success) {
    return { success: false, error: clickResult?.error || `payment ${action} click failed`, tab };
  }
  try {
    const nextTab = await waitForPaymentStateAcrossTabs(tab, waitFor, previousTabIds, 5000);
    await injectContentScript(nextTab.id).catch(() => {});
    return { success: true, tab: nextTab, state: nextTab._gdaipaiPaymentState };
  } catch (e) {
    console.warn('[Yahoo Bid] Payment synthetic click did not reach next state, trying trusted mouse click:', e.message || e);
    const trustedClick = await dispatchTrustedPaymentActionClick(tab, action);
    console.log('[Yahoo Bid] Trusted payment mouse click result:', trustedClick);
    if (!trustedClick?.success) {
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
    nextState.alreadyPaid || nextState.complete || nextState.hasTransactionDecideButton
  );
  if (!result?.success) return result;
  tab = result.tab;
  state = result.state;

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
    console.error('[Yahoo Bid] Failed to report Yahoo login status:', e);
  }
}

async function refreshPluginConfig() {
  try {
    const res = await apiFetch('/api/plugin/config');
    const config = await res.json();
    const intervalMinutes = Number(config?.idleSyncIntervalMinutes || 5);
    idleSyncIntervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
  } catch (e) {
    console.warn('[Yahoo Bid] Failed to refresh plugin config:', e.message || e);
  }
}

async function openWonPageForSync() {
  const [existingTab] = await chrome.tabs.query({ url: '*://auctions.yahoo.co.jp/my/won*' });
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: 'https://auctions.yahoo.co.jp/my/won', active: false })
    : await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/won', active: false });
  if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
  await sleep(3000);
  await injectContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ORDER_HISTORY' }).catch(error => {
    console.error('[Yahoo Bid] Failed to extract order history:', error);
    return null;
  });
  await reportYahooLoginStatus(response?.loginStatus);
  if (response?.success) {
    await syncOrderHistory(response.orders || []);
  }
}

async function openBiddingPageForSync() {
  const [existingTab] = await chrome.tabs.query({ url: '*://auctions.yahoo.co.jp/my/bidding*' });
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: 'https://auctions.yahoo.co.jp/my/bidding', active: false })
    : await chrome.tabs.create({ url: 'https://auctions.yahoo.co.jp/my/bidding', active: false });
  if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
  await sleep(3000);
  await injectContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_BIDDING_ITEMS' }).catch(error => {
    console.error('[Yahoo Bid] Failed to extract bidding items:', error);
    return null;
  });
  await reportYahooLoginStatus(response?.loginStatus);
  if (response?.success) {
    await syncBiddingItems(response.items || []);
  }
}

function isBidderPaysShippingText(value) {
  return /\u843d\u672d\u8005\u8ca0\u62c5/.test(String(value || ''));
}

async function openTransactionPage(job) {
  const createdTabIds = [];
  if (job.transactionUrl) {
    const tab = await chrome.tabs.create({ url: job.transactionUrl, active: false });
    if (tab.id) createdTabIds.push(tab.id);
    if (tab.id) await waitForTabComplete(tab.id).catch(() => {});
    await sleep(3000);
    await injectContentScript(tab.id);
    tab._gdaipaiCreatedTabIds = createdTabIds;
    return tab;
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
    const nextTab = await switchToNewestNewTab(new Set(createdTabIds), tab);
    for (const id of nextTab._gdaipaiCreatedTabIds || []) createdTabIds.push(id);
    nextTab._gdaipaiCreatedTabIds = [...new Set(createdTabIds)];
    return nextTab;
  }
  await waitForTabComplete(tab.id).catch(() => {});
  await sleep(3000);
  await injectContentScript(tab.id);
  tab._gdaipaiCreatedTabIds = createdTabIds;
  return tab;
}

async function getTabIds() {
  const tabs = await chrome.tabs.query({});
  return new Set(tabs.map(tab => tab.id).filter(Boolean));
}

async function switchToNewestNewTab(previousIds, fallbackTab) {
  const tabs = await chrome.tabs.query({});
  const newTabs = tabs
    .filter(tab => tab.id && !previousIds.has(tab.id))
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
  await injectContentScript(nextTab.id);
  nextTab._gdaipaiCreatedTabIds = [...created];
  return nextTab;
}

function getBundleActionPatternSource(action) {
  const patterns = {
    close: '\\u9589\\u3058\\u308b',
    start: '^\\s*\\u307e\\u3068\\u3081\\u3066\\u53d6\\u5f15\\u3092(?:\\u306f\\u3058\\u3081\\u308b|\\u4f9d\\u983c\\u3059\\u308b)\\s*$',
    input: '\\u53d6\\u5f15\\u60c5\\u5831\\u3092\\u5165\\u529b\\u3059\\u308b',
    decide: '\\u6c7a\\u5b9a\\u3059\\u308b',
    confirm: '\\u78ba\\u5b9a\\u3059\\u308b'
  };
  return patterns[action] || '';
}

function isLikelyYahooTransactionTab(tab) {
  const url = String(tab?.url || '');
  return !url ||
    /^about:blank/i.test(url) ||
    /:\/\/(?:[^/]+\.)?auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/contact\.auctions\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/login\.yahoo\.co\.jp\//i.test(url) ||
    /:\/\/account\.edit\.yahoo\.co\.jp\//i.test(url);
}

async function runMainWorldBundleActionClick(tabId, action) {
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
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const button = controls.find(el => pattern.test(getText(el)));
      if (!button) return { success: false, error: 'button not found in MAIN world' };
      button.scrollIntoView?.({ block: 'center', inline: 'center' });
      button.focus?.();
      const type = String(button.type || '').toLowerCase();
      if (button.form && typeof button.form.requestSubmit === 'function' && (type === 'submit' || (!type && button.tagName === 'BUTTON'))) {
        button.form.requestSubmit(button);
        return { success: true, method: 'requestSubmit', text: getText(button) };
      }
      button.click();
      return { success: true, method: 'click', text: getText(button) };
    },
    args: [pattern]
  });
  const result = injectionResult?.[0]?.result;
  return result?.success ? result : { success: false, error: result?.error || 'MAIN world click failed' };
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
      const controls = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
      const button = controls.find(el => pattern.test(getText(el)));
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
    return { success: true, method: 'debuggerMouse', text: point.text };
  } catch (e) {
    return { success: false, error: e.message || 'trusted mouse click failed' };
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
      if (!candidate?.id || !isLikelyYahooTransactionTab(candidate)) continue;
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

async function clickBundleActionAndFollowTab(tab, action, waitForOverride = null) {
  console.log(`[Yahoo Bid] clickBundleActionAndFollowTab: action=${action}, tabId=${tab.id}`);

  try {
    await injectContentScript(tab.id);
  } catch (e) {
    console.error('[Yahoo Bid] Failed to inject content script before click:', e);
    return { success: false, error: `content script injection failed: ${e.message}`, tab };
  }

  const previousTabIds = await getTabIds();
  let clickResult = null;
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
    }
  } catch (e) {
    console.error('[Yahoo Bid] MAIN world execution failed:', e);
    const result = await chrome.tabs.sendMessage(tab.id, {
      type: 'CLICK_BUNDLE_TRANSACTION_ACTION',
      action
    }).catch(error => ({ success: false, error: error.message || `bundle ${action} failed` }));
    if (!result?.success) return { success: false, error: `MAIN world click failed: ${e.message}; ${result?.error || ''}`.trim(), tab };
    clickResult = result;
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
  try {
    nextTab = await waitForBundleActionStateAcrossTabs(tab, waitFor, previousTabIds, 5000);
  } catch (e) {
    console.warn('[Yahoo Bid] Synthetic click did not reach next bundle state, trying trusted mouse click:', e.message || e);
    const trustedClick = await dispatchTrustedBundleActionClick(tab, action);
    console.log('[Yahoo Bid] Trusted mouse click result:', trustedClick);
    if (!trustedClick?.success) {
      return { success: false, error: trustedClick?.error || clickResult?.error || `bundle ${action} failed`, tab };
    }
    nextTab = await waitForBundleActionStateAcrossTabs(tab, waitFor, previousTabIds, 30000);
  }

  console.log(`[Yahoo Bid] Bundle action state reached, nextTab.id=${nextTab.id}`);
  nextTab._gdaipaiCreatedTabIds = nextTab._gdaipaiCreatedTabIds || tab._gdaipaiCreatedTabIds || [];
  await injectContentScript(nextTab.id).catch(() => {});
  return { success: true, tab: nextTab };
}

async function completeBidderPaysShippingTransaction(tab) {
  let state = await getBundleActionState(tab.id);
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

async function executeTransactionStartJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job);
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
    if (info.available) {
      if (!info.quantityMatched) {
        await updateTransactionStartStatus({ orderId: job.orderId, error: 'bundle quantity mismatch' });
        return;
      }
      const bundleProductIds = info.productIds || [];
      for (const action of ['close', 'start', 'decide']) {
        const result = await clickBundleActionAndFollowTab(tab, action);
        if (!result?.success) {
          await updateTransactionStartStatus({
            productIds: bundleProductIds.length ? bundleProductIds : [job.productId],
            error: result?.error || `bundle ${action} failed`
          });
          return { processedProductIds: bundleProductIds.length ? bundleProductIds : [job.productId] };
        }
        tab = result.tab;
      }
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
      await updateTransactionStartStatus({ orderId: job.orderId, status: 'pending_payment' });
    }
    return { processedProductIds: [job.productId] };
  } catch (e) {
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
  if (tab?.id) ids.add(tab.id);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const candidate of tabs) {
    if (!candidate?.id || beforeTabIds.has(candidate.id)) continue;
    if (isLikelyYahooTransactionTab(candidate)) ids.add(candidate.id);
  }
  for (const id of ids) {
    await closeTabIfExists(id);
  }
}

async function closeTabsForScanFlow(tab, beforeTabIds = new Set()) {
  const ids = new Set(tab?._gdaipaiCreatedTabIds || []);
  if (tab?.id) ids.add(tab.id);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  for (const candidate of tabs) {
    if (!candidate?.id || beforeTabIds.has(candidate.id)) continue;
    if (isLikelyYahooTransactionTab(candidate)) ids.add(candidate.id);
  }
  for (const id of ids) {
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
      return {
        orderId: job.orderId,
        shipped: true,
        shippingCompany: result.shippingCompany || '',
        trackingNumber: result.trackingNumber || ''
      };
    }
    if (result.type === 'pending_shipment') {
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
    tab = await openTransactionPage(job);
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_PENDING_SHIPMENT_SCAN' }).catch(error => {
      console.error('[Yahoo Bid] Failed to extract pending shipment scan:', error);
      return null;
    });
    await reportYahooLoginStatus(response?.loginStatus);
    if (response?.loginStatus?.status === 'failed') return { stop: true };
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

async function executeWaitingShippingScanJob(job) {
  let tab = null;
  try {
    tab = await openTransactionPage(job);
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

async function executePendingBundleScanJob(job) {
  let tab = null;
  const beforeTabIds = await getTabIds();
  try {
    tab = await openTransactionPage(job);
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

    if (result?.type === 'unknown') {
      let state = await getBundleActionState(tab.id);
      if (state?.canInputTransaction) {
        let clickResult = await clickBundleActionAndFollowTab(tab, 'input', state => state.canDecide || state.waitingShipping);
        if (!clickResult?.success) return { stop: false };
        tab = clickResult.tab;
        state = await getBundleActionState(tab.id);
        if (!state?.waitingShipping) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'decide', state => state.canConfirm || state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
          state = await getBundleActionState(tab.id);
        }
        if (!state?.waitingShipping) {
          clickResult = await clickBundleActionAndFollowTab(tab, 'confirm', state => state.waitingShipping);
          if (!clickResult?.success) return { stop: false };
          tab = clickResult.tab;
        }

        extracted = await extractBundleScanResult(tab);
        if (extracted.stop) return { stop: true };
        result = extracted.result;
        const payload = buildScanStatusPayload({ ...job, result });
        if (payload) await updateScanStatus(payload);
        if (payload?.bundleShippingFeeText || payload?.bundleRejected) {
          return { stop: false, processedBundleGroupId: job.bundleGroupId || null };
        }
      }
    }
    return { stop: false };
  } catch (e) {
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
  const beforeTabIds = await getTabIds();
  const maxPageStaySeconds = Math.max(1, Math.floor(Number(paymentBatch.paymentPageStaySeconds ?? job.paymentPageStaySeconds ?? 3)));
  try {
    tab = await openTransactionPage(job);
    let state = await getPaymentPageState(tab.id);
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };

    if (state?.hasTransactionInfoInputButton) {
      const result = await completePaymentTransactionInfoInput(tab, state);
      if (!result?.success) throw new Error(result?.error || 'transaction info input flow failed');
      tab = result.tab;
      state = result.state;
    }

    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };

    let entryClicks = 0;
    while (!state?.alreadyPaid && !state?.complete && !state?.hasReviewButton && entryClicks < 3) {
      let result = null;
      if (state?.hasEasyPaymentButton) {
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
    }

    if (!state?.alreadyPaid && !state?.complete && !state?.hasReviewButton) {
      const reviewTab = await waitForPaymentStateOnTab(tab, nextState =>
        nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
        15000
      );
      if (reviewTab) {
        tab = reviewTab;
        state = reviewTab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
      }
    }
    if (!entryClicks && !state?.hasReviewButton && !state?.alreadyPaid && !state?.complete) {
      throw new Error('payment entry button not found');
    }

    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    if (!state?.hasReviewButton) {
      const reviewTab = await waitForPaymentStateOnTab(tab, nextState =>
        nextState.alreadyPaid || nextState.complete || nextState.hasReviewButton,
        15000
      );
      if (reviewTab) {
        tab = reviewTab;
        state = reviewTab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
      }
    }
    if (!state?.hasReviewButton) throw new Error('payment review button not found');
    assertPaymentAmountMatches(job, state);

    let result = await clickPaymentActionAndFollowTab(tab, 'review', nextState =>
      nextState.alreadyPaid || nextState.complete || nextState.hasFinalizeButton
    );
    if (!result?.success) throw new Error(result?.error || 'payment review click failed');
    tab = result.tab;
    state = result.state;

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
        nextState.alreadyPaid || nextState.complete,
        previousTabIds,
        5000
      );
    } catch (e) {
      console.warn('[Yahoo Bid] Payment finalize synthetic click did not complete, trying trusted mouse click:', e.message || e);
      const trustedClick = await dispatchTrustedPaymentActionClick(tab, 'finalize');
      console.log('[Yahoo Bid] Trusted payment finalize mouse click result:', trustedClick);
      if (!trustedClick?.success) throw new Error(trustedClick?.error || finalClick?.error || 'payment finalize click failed');
      tab = await waitForPaymentStateAcrossTabs(tab, nextState =>
        nextState.alreadyPaid || nextState.complete,
        previousTabIds,
        30000
      );
    }
    state = tab._gdaipaiPaymentState || await getPaymentPageState(tab.id);
    if (state?.alreadyPaid) return { alreadyPaid: true };
    if (state?.complete) return { success: true };
    throw new Error('payment completion text not found');
  } finally {
    await closeTabsForTransactionFlow(tab, beforeTabIds);
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

async function syncIdleYahooPages() {
  await refreshPluginConfig();
  const now = Date.now();
  if (now - lastIdleSyncAt < idleSyncIntervalMs) {
    return;
  }
  lastIdleSyncAt = now;
  await openBiddingPageForSync();
  await openWonPageForSync();
  const idleAction = await fetchNextIdleAction();
  if (idleAction?.action === 'transaction_start') {
    await runTransactionStartJobs({
      includeAfterCutoff: idleAction?.config?.transactionStartRequestSource === 'manual',
      processNormalJobs: TRANSACTION_START_ENABLED
    });
  } else if (idleAction?.action === 'scan') {
    await runScanJobs();
  } else if (idleAction?.action === 'payment') {
    await runPaymentJobs();
  }
  await completeIdleAction(idleAction?.action || 'none');
}

async function pollAndExecute() {
  if (!AUTO_BID_ENABLED) {
    console.log('[Yahoo Bid] Auto bid disabled. Pending tasks remain queued.');
    return;
  }

  if (isRunning) return;
  isRunning = true;
  try {
    const taskResponse = await fetchPendingTask();
    const task = taskResponse.task;
    if (task) {
      console.log('[Yahoo Bid] ִ������:', task.product_url);
      let taskTab = null;
      let taskTimedOut = false;
      try {
        await withTimeout((async () => {
          const markedProcessing = await markTaskStatus(task.id, 'processing');
          if (taskTimedOut) return;
          if (!markedProcessing?.success) {
            console.log('[Yahoo Bid] Task skipped because it is no longer active:', task.id);
            return;
          }
          taskTab = await openTaskPage(task);
          if (taskTimedOut) {
            await closeTaskTab(taskTab.id);
            return;
          }
          const tab = taskTab;
          await injectContentScript(tab.id);
          if (taskTimedOut) return;
          const ready = await ensureTaskReadyByCurrentEndTime(tab, task);
          if (taskTimedOut) return;
          if (!ready) {
            await chrome.storage.session.remove(['currentTask']);
            return;
          }
          const result = await executeTaskInTabV2(tab, task);
          if (taskTimedOut) return;
          await chrome.storage.session.remove(['currentTask']);
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
            await closeTaskTab(tab.id);
          }
          console.log('[Yahoo Bid] ������ִ��:', task.id, result);
        })(), TASK_EXECUTION_TIMEOUT_MS, () => {
          taskTimedOut = true;
          return buildTaskTimeoutError(TASK_EXECUTION_TIMEOUT_MS);
        });
      } catch (e) {
        await chrome.storage.session.remove(['currentTask']);
        if (taskTab?.id && e.closeTab) {
          await closeTaskTab(taskTab.id);
        }
        await markTaskStatus(task.id, 'failed', e.message);
      }
    } else if (taskResponse.canIdleSync) {
      await chrome.storage.session.remove(['currentTask']);
      await syncIdleYahooPages();
      console.log('[Yahoo Bid] No pending tasks, polling again in', POLL_INTERVAL_MS / 1000, 's');
    } else {
      await chrome.storage.session.remove(['currentTask']);
      console.log('[Yahoo Bid] Idle sync skipped because a bid task is within guard window:', taskResponse.idleBidGuardMinutes, 'minutes');
    }
  } finally {
    isRunning = false;
  }
}

async function startPolling() {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: 1 });
  setInterval(pollAndExecute, POLL_INTERVAL_MS);
  pollAndExecute();
  console.log('[Yahoo Bid] Extension started, polling every', POLL_INTERVAL_MS / 1000, 's');
}

chrome.runtime.onInstalled.addListener(startPolling);
chrome.runtime.onStartup.addListener(startPolling);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === POLL_ALARM_NAME) pollAndExecute();
});

globalThis.__G_DAIPAI_BACKGROUND_TEST__ = {
  shouldKeepTaskTabOpen,
  buildTaskTimeoutError,
  withTimeout,
  waitForCurrentTabNavigation,
  clickBundleActionAndFollowTab,
  completeBidderPaysShippingTransaction,
  waitForBundleActionStateAcrossTabs,
  dispatchTrustedBundleActionClick,
  dispatchTrustedPaymentActionClick,
  getPaymentActionClickPoint,
  isLikelyYahooTransactionTab,
  closeTabsForTransactionFlow,
  buildScanStatusPayload,
  buildPaymentPageStateFromSnapshot,
  getRandomIntInclusive,
  syncIdleYahooPages,
  runTransactionStartJobs,
  runPaymentJobs,
  buildPaymentFailurePayload,
  getExpectedPaymentAmountJpy,
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
  if (msg.type === 'BID_RESULT') {
    const { taskId, result } = msg;
    if (result?.pendingFinal) {
      console.log('[Yahoo Bid] Waiting for final confirmation page:', taskId, result.stage);
      return;
    }
    if (!result?.success && shouldCloseTaskTab(result) && sender.tab?.id) {
      closeTaskTab(sender.tab.id);
    }
    chrome.storage.session.remove(['currentTask']);
    if (result.success) {
      if (sender.tab?.id) {
        closeTaskTab(sender.tab.id);
      }
      if (result.noStatus) {
        // 已是最高价且新出价≤自动入札上限，跳过出价。直接标 bidding，避免任务一直停留 processing/pending。
        markTaskStatus(taskId, 'bidding', null, { bid_price: result.bidPrice, no_bid: true });
      } else {
        markTaskStatus(taskId, 'bidding', null, { bid_price: result.bidPrice, no_bid: result.noBid, not_highest: result.notHighest });
      }
    } else {
      markTaskStatus(taskId, 'failed', result.error || '����ʧ��');
    }
    pollAndExecute();
  } else if (msg.type === 'PRODUCT_DATA_REMOVED') {
    // Forward product data to server to cache it
    const { data } = msg;
    if (data && data.auctionId) {
      console.log('[Yahoo Bid] Product data cached:', data.title, '��' + data.currentPrice);
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

