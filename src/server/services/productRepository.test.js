const assert = require('assert/strict');
const {
  normalizeProductSnapshot,
  backfillProductsFromExistingData,
  backfillOrderProductIds,
  upsertProductSnapshot
} = require('./productRepository');

function testNormalizeProductSnapshotKeepsKnownFieldsOnly() {
  assert.deepEqual(normalizeProductSnapshot({
    product_id: 'A123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Title',
    product_image_url: 'https://example.com/image.jpg',
    current_price: '1200',
    buyout_price: '5000',
    bid_count: '2',
    tax_type: 'tax_included',
    product_type: 'store',
    shipping_fee_text: '送料 500円',
    end_time: '2026-06-20T12:00:00+09:00',
    ignored: 'x'
  }), {
    product_id: 'a123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Title',
    product_image_url: 'https://example.com/image.jpg',
    current_price: 1200,
    buyout_price: 5000,
    bid_count: 2,
    tax_type: 'tax_included',
    product_type: 'store',
    shipping_fee_text: '送料 500円',
    end_time: '2026-06-20T12:00:00+09:00'
  });
}

async function testBackfillProductsReadsTasksAndBiddingItemsOnly() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 3 };
    }
  };

  const result = await backfillProductsFromExistingData(fakeDb);

  assert.equal(result.rowCount, 3);
  assert.match(calls[0].sql, /INSERT INTO products/);
  assert.match(calls[0].sql, /FROM tasks/);
  assert.match(calls[0].sql, /LEFT JOIN bidding_items/);
}

async function testBackfillOrderProductIdsUsesTaskRelationOnly() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 2 };
    }
  };

  const result = await backfillOrderProductIds(fakeDb);

  assert.equal(result.rowCount, 2);
  assert.match(calls[0].sql, /UPDATE orders/);
  assert.match(calls[0].sql, /SELECT product_id FROM tasks/);
  assert.doesNotMatch(calls[0].sql, /order_status/);
}

async function testUpsertProductSnapshotPreservesExistingShippingAndMarksFetchSource() {
  const calls = [];
  const fakeDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rowCount: 1 };
    }
  };

  const result = await upsertProductSnapshot(fakeDb, {
    product_id: 'A123456789',
    product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
    product_title: 'Title',
    shipping_fee_text: '',
    current_price: 1200
  }, { source: 'fetch' });

  assert.equal(result.rowCount, 1);
  assert.match(calls[0].sql, /INSERT INTO products/);
  assert.match(calls[0].sql, /ON CONFLICT\(product_id\) DO UPDATE/);
  assert.match(calls[0].sql, /shipping_fee_text = COALESCE\(excluded\.shipping_fee_text, products\.shipping_fee_text\)/);
  assert.match(calls[0].sql, /last_fetched_at = COALESCE\(excluded\.last_fetched_at, products\.last_fetched_at\)/);
  assert.equal(calls[0].params[0], 'a123456789');
  assert.equal(calls[0].params.includes('fetch'), true);
}

testNormalizeProductSnapshotKeepsKnownFieldsOnly();
Promise.all([
  testBackfillProductsReadsTasksAndBiddingItemsOnly(),
  testBackfillOrderProductIdsUsesTaskRelationOnly(),
  testUpsertProductSnapshotPreservesExistingShippingAndMarksFetchSource()
]).then(() => {
  console.log('product repository tests passed');
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
