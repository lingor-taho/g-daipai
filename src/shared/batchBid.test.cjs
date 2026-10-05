const assert = require('node:assert/strict');
const { normalizeBatchProduct, normalizeBatchPrice, parseBatchBidText } = require('./batchBid.cjs');

const rows = parseBatchBidText('\nd1246248584 11800\nd1246180991,5800\ne1246602869；21,980\ns1246477286\t18800\nr1246380884，4980\np1246403282 | 21800');
assert.equal(rows.length, 6);
assert.equal(rows[0].line, 2);
assert.deepEqual(rows.map(row => row.maxPrice), [11800, 5800, 21980, 18800, 4980, 21800]);
assert.ok(rows.every(row => !row.error));
assert.equal(normalizeBatchProduct('https://page.auctions.yahoo.co.jp/jp/auction/D1246248584?foo=1').productId, 'd1246248584');
assert.equal(normalizeBatchProduct('1229405242').productId, '1229405242');
assert.equal(normalizeBatchProduct('https://m.gougoujp.com/aucitem/p1229273606').productId, 'p1229273606');
assert.equal(normalizeBatchProduct('https://www.fromjapan.co.jp/japan/cn/auction/yahoo/input/g1225234655/').productId, 'g1225234655');
for (const input of ['d12462485840', 'xxd1246248584', 'd1246248584oops', 'https://evil.example/d1246248584', 'https://auctions.yahoo.co.jp/jp/auction/d1246248584extra', 'https://paypayfleamarket.yahoo.co.jp/item/z562177666']) {
  assert.throws(() => normalizeBatchProduct(input));
}
for (const price of [0, '-1', '1.5', '5e3', 'NaN', '11,80', '1 1800', '9007199254740991']) assert.throws(() => normalizeBatchPrice(price));
assert.equal(normalizeBatchPrice('11,800'), 11800);
const duplicates = parseBatchBidText('D1246248584 11800\nhttps://auctions.yahoo.co.jp/jp/auction/d1246248584 12000');
assert.ok(duplicates.every(row => /重复/.test(row.error)));
assert.ok(parseBatchBidText('d1246248584 0\nd1246248584 12000').every(row => /重复/.test(row.error)));
assert.ok(parseBatchBidText('wrong 100\nd1246248584 11800')[0].error);
assert.equal(parseBatchBidText('wrong 100\nd1246248584 11800')[1].error, undefined);
assert.throws(() => parseBatchBidText(' \n'));
assert.throws(() => parseBatchBidText(Array(51).fill('d1246248584 11800').join('\n')), /50/);
console.log('Batch bid parser tests passed.');
