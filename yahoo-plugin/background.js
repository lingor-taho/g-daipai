const API_BASES = ['http://127.0.0.1:3034', 'http://localhost:3034'];
const POLL_INTERVAL_MS = 10000;
const POLL_ALARM_NAME = 'poll-pending-tasks';
const AUTO_BID_ENABLED = true;

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
    return data.task || null;
  } catch (e) {
    fetchFailureCount += 1;
    const log = fetchFailureCount === 1 || fetchFailureCount % 6 === 0 ? console.warn : console.debug;
    log('[Yahoo Bid] API unavailable, polling will retry:', e.message || e);
    return null;
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

  await waitForTabComplete(tab.id);
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
    throw new Error(result?.error || '����ִ��ʧ��');
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
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
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
    throw new Error('��Ʒ�Ѿ�����');
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
    throw new Error(result?.error || '����ִ��ʧ��');
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

  return {
    auctionId,
    url: standardUrl,
    title: title || ('��Ʒ ' + auctionId),
    imageUrl: imageUrl || '',
    currentPrice: priceText ? parseInt(priceText.replace(/,/g, ''), 10) || 0 : 0,
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

async function cacheProductOnServer(product) {
  if (!product?.auctionId) return;
  try {
    await apiFetch('/api/proxy/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(product)
    });
  } catch (e) {
    console.error('[Yahoo Bid] Failed to cache product:', e);
  }
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
  if (response?.success) {
    await syncBiddingItems(response.items || []);
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
}

async function pollAndExecute() {
  if (!AUTO_BID_ENABLED) {
    console.log('[Yahoo Bid] Auto bid disabled. Pending tasks remain queued.');
    return;
  }

  if (isRunning) return;
  isRunning = true;
  try {
    const task = await fetchPendingTask();
    if (task) {
      console.log('[Yahoo Bid] ִ������:', task.product_url);
      let taskTab = null;
      try {
        const markedProcessing = await markTaskStatus(task.id, 'processing');
        if (!markedProcessing?.success) {
          console.log('[Yahoo Bid] Task skipped because it is no longer active:', task.id);
          return;
        }
        taskTab = await openTaskPage(task);
        const tab = taskTab;
        await injectContentScript(tab.id);
        const ready = await ensureTaskReadyByCurrentEndTime(tab, task);
        if (!ready) {
          await chrome.storage.session.remove(['currentTask']);
          return;
        }
        const result = await executeTaskInTabV2(tab, task);
        await chrome.storage.session.remove(['currentTask']);
        if (result?.noStatus) {
          await touchTaskSchedule(task.id, task.status);
        } else {
          await markTaskStatus(task.id, 'bidding', null, { bid_price: result?.bidPrice, no_bid: result?.noBid, not_highest: result?.notHighest });
        }
        if (!shouldKeepTaskTabOpen(task, result)) {
          await closeTaskTab(tab.id);
        }
        console.log('[Yahoo Bid] ������ִ��:', task.id, result);
      } catch (e) {
        await chrome.storage.session.remove(['currentTask']);
        if (taskTab?.id) {
          await closeTaskTab(taskTab.id);
        }
        await markTaskStatus(task.id, 'failed', e.message);
      }
    } else {
      await chrome.storage.session.remove(['currentTask']);
      await syncIdleYahooPages();
      console.log('[Yahoo Bid] No pending tasks, polling again in', POLL_INTERVAL_MS / 1000, 's');
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
  shouldKeepTaskTabOpen
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
        touchTaskSchedule(taskId);
      } else {
        markTaskStatus(taskId, 'bidding', null, { bid_price: result.bidPrice, no_bid: result.noBid, not_highest: result.notHighest });
      }
    } else {
      markTaskStatus(taskId, 'failed', result.error || '����ʧ��');
    }
    pollAndExecute();
  } else if (msg.type === 'PRODUCT_DATA') {
    // Forward product data to server to cache it
    const { data } = msg;
    if (data && data.auctionId) {
      apiFetch('/api/proxy/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(e => console.error('[Yahoo Bid] Failed to cache product:', e));
      console.log('[Yahoo Bid] Product data cached:', data.title, '��' + data.currentPrice);
    }
  } else if (msg.type === 'ORDER_HISTORY') {
    syncOrderHistory(msg.orders);
  } else if (msg.type === 'BIDDING_ITEMS') {
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
  } else if (msg.type === 'FETCH_PRODUCT') {
    fetchProductInfo(msg.url || msg.auctionId)
      .then(async data => {
        await chrome.storage.session.set({ cachedProduct: data });
        await cacheProductOnServer(data);
        sendResponse({ success: true, data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});

