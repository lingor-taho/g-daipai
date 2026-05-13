import assert from 'node:assert/strict';
import { createGetProductInfo } from './api.js';

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

async function testRejectsInvalidUrlBeforeServerCall() {
  let called = false;
  const getProductInfo = createGetProductInfo({
    apiClient: {
      get: async () => {
        called = true;
      }
    }
  });

  await assert.rejects(() => getProductInfo('https://example.com/no-auction'), /invalid product url/);
  assert.equal(called, false);
}

await testAlwaysUsesServerProxy();
await testAcceptsThirdPartyAndNumericAuctionUrls();
await testRejectsInvalidUrlBeforeServerCall();
