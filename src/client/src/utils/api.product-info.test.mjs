import assert from 'node:assert/strict';
import {
  api,
  createGetProductInfo,
  getApiErrorMessage,
  isRecoverableNetworkError,
  REQUEST_TIMEOUT_MS,
  shouldRetryRequest
} from './api.js';

async function testAlwaysUsesServerProxy() {
  const calls = [];
  const getProductInfo = createGetProductInfo({
    apiClient: {
      get: async (path, config) => {
        calls.push({ path, config });
        return {
          data: {
            success: true,
            data: {
              auctionId: 'x1234567890',
              standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
              title: 'server title',
              imageUrl: 'https://img.example/a.jpg',
              currentPrice: 1200
            },
            source: 'http'
          }
        };
      }
    }
  });

  const result = await getProductInfo('https://page.auctions.yahoo.co.jp/jp/auction/x1234567890?foo=1');

  assert.equal(result.data.data.title, 'server title');
  assert.equal(result.data.data.imageUrl, 'https://img.example/a.jpg');
  assert.equal(result.data.data.currentPrice, 1200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/proxy/fetch');
  assert.equal(calls[0].config.params.url, 'https://page.auctions.yahoo.co.jp/jp/auction/x1234567890?foo=1');
}

async function testAcceptsThirdPartyAndNumericAuctionUrls() {
  const calls = [];
  const getProductInfo = createGetProductInfo({
    apiClient: {
      get: async (path, config) => {
        calls.push({ path, config });
        return { data: { success: true, data: { title: 'ok' } } };
      }
    }
  });

  await getProductInfo('https://m.gougoujp.com/aucitem/p1229273606');
  await getProductInfo('https://www.fromjapan.co.jp/japan/cn/auction/yahoo/input/g1225234655/');
  await getProductInfo('https://auctions.yahoo.co.jp/jp/auction/1229405242');
  await getProductInfo('https://paypayfleamarket.yahoo.co.jp/item/z562177666');
  await getProductInfo('https://example.com/item/562177666');
  await getProductInfo('https://example.com/item/a12345678');
  await getProductInfo('https://example.com/item/12345678');

  assert.equal(calls.length, 7);
}

async function testUsesKeywordWhenInputDoesNotContainAuctionId() {
  const calls = [];
  const getProductInfo = createGetProductInfo({
    apiClient: {
      get: async (path, config) => {
        calls.push({ path, config });
        return { data: { success: true, data: { auctionId: 'x1230699905', title: 'keyword product' } } };
      }
    }
  });

  const result = await getProductInfo('商品名称');

  assert.equal(result.data.data.auctionId, 'x1230699905');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/proxy/fetch');
  assert.deepEqual(calls[0].config.params, { keyword: '商品名称' });
}

async function testServerProductFetchFailureRejectsToCaller() {
  const getProductInfo = createGetProductInfo({
    apiClient: {
      get: async () => {
        const error = new Error('服务器网络问题，请稍后重试！');
        error.response = { status: 502, data: { error: '服务器网络问题，请稍后重试！' } };
        throw error;
      }
    }
  });

  await assert.rejects(
    () => getProductInfo('https://auctions.yahoo.co.jp/jp/auction/x1234567890'),
    /服务器网络问题/
  );
}

function testApiHasTimeoutForIdleConnections() {
  assert.equal(api.defaults.timeout, REQUEST_TIMEOUT_MS);
  assert.ok(api.defaults.timeout >= 10000);
}

function testTimeoutErrorHasReadableMessage() {
  assert.equal(
    getApiErrorMessage({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }, '提交失败'),
    '网络请求超时，请稍后重试'
  );
}

function testIdleNetworkErrorsAreRetryable() {
  assert.equal(isRecoverableNetworkError({ code: 'ECONNABORTED', message: 'timeout of 15000ms exceeded' }), true);
  assert.equal(isRecoverableNetworkError({ code: 'ERR_NETWORK', request: {} }), true);
  assert.equal(isRecoverableNetworkError({ response: { status: 500 } }), false);
}

function testRetriesSafeRequestsAndExplicitSubmitRetryOnlyOnce() {
  assert.equal(shouldRetryRequest({ method: 'get' }, { code: 'ERR_NETWORK', request: {} }), true);
  assert.equal(shouldRetryRequest({ method: 'post' }, { code: 'ERR_NETWORK', request: {} }), false);
  assert.equal(shouldRetryRequest({ method: 'post', __allowRetry: true }, { code: 'ERR_NETWORK', request: {} }), true);
  assert.equal(shouldRetryRequest({ method: 'get', __retryCount: 1 }, { code: 'ERR_NETWORK', request: {} }), false);
}

await testAlwaysUsesServerProxy();
await testAcceptsThirdPartyAndNumericAuctionUrls();
await testUsesKeywordWhenInputDoesNotContainAuctionId();
await testServerProductFetchFailureRejectsToCaller();
testApiHasTimeoutForIdleConnections();
testTimeoutErrorHasReadableMessage();
testIdleNetworkErrorsAreRetryable();
testRetriesSafeRequestsAndExplicitSubmitRetryOnlyOnce();
