const assert = require('node:assert/strict');
const { getProductItemUrl } = require('./productUrl.cjs');
const { buildProductUrl } = require('../admin/src/messageReadCsv.js');
const { buildOrdersCsv } = require('../admin/src/ordersCsv.js');

async function main() {
  const { getAuctionProductUrl, getRebidSubmitPath } = await import('../client/src/utils/rebid.js');
  const expected = 'https://paypayfleamarket.yahoo.co.jp/item/z705858626';
  for (const product_url of [undefined, '', 'https://auctions.yahoo.co.jp/jp/auction/z705858626', expected]) {
    const row = { product_id: 'Z705858626', product_type: 'fleamarket', product_url, final_price: 300 };
    assert.equal(getProductItemUrl(row), expected);
    assert.equal(buildProductUrl(row), expected);
    assert.equal(getAuctionProductUrl(row), expected);
    assert.equal(getRebidSubmitPath(row), `/submit?url=${encodeURIComponent(expected)}`);
    assert.ok(buildOrdersCsv([row]).includes(expected));
    assert.ok(!buildOrdersCsv([row]).includes('jp/auction/z'));
  }
  assert.equal(getProductItemUrl('Z705858626'), expected);
  assert.equal(getProductItemUrl({ product_url: expected }), expected);
  for (const id of ['p123456789', 's123456789', 'a123456789']) {
    const expectedAuction = `https://auctions.yahoo.co.jp/jp/auction/${id}`;
    assert.equal(getProductItemUrl(id), expectedAuction);
    assert.equal(buildProductUrl({ product_id: id }), expectedAuction);
    assert.equal(getProductItemUrl({ product_id: id, product_url: 'https://example.com/keep' }), 'https://example.com/keep');
  }
  assert.equal(getProductItemUrl(''), '');
  assert.equal(getProductItemUrl(null), '');
  console.log('P URLs, legacy/missing URLs, both CSV exports and rebid links passed; ordinary p IDs preserved');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
