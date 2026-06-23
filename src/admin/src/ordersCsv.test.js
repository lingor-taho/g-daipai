const assert = require('assert/strict');
const { buildOrdersCsv } = require('./ordersCsv');

function testBuildOrdersCsvAppendsTotalSummaryRow() {
  const csv = buildOrdersCsv([
    {
      id: 1,
      won_at: '2026-06-22 00:00:00',
      username: '小毛',
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/a123456789',
      product_title: '商品A',
      final_price: 700,
      shipping_fee_text: '0円',
      payable_cny: 35.5
    },
    {
      id: 2,
      won_at: '2026-06-22 00:00:00',
      username: '小毛',
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/b123456789',
      product_title: '商品B',
      final_price: 33333,
      shipping_fee_text: '750円',
      payable_cny: null
    }
  ], {});

  const rows = csv.split('\r\n');
  assert.equal(rows[0], '落札日期,用户名,商品链接,商品标题,落札价,运费,总价,应付款(RMB)');
  assert.equal(rows[1], '2026-06-22,小毛,https://auctions.yahoo.co.jp/jp/auction/a123456789,商品A,700,0,700,35.5');
  assert.equal(rows[2], '2026-06-22,小毛,https://auctions.yahoo.co.jp/jp/auction/b123456789,商品B,33333,750,34083,');
  assert.equal(rows.at(-1), '金额汇总,,,,,,34783,35.5');
}

function testBuildOrdersCsvUsesShippingOverridesInSummary() {
  const csv = buildOrdersCsv([
    {
      id: 9,
      won_at: '2026-06-21 00:00:00',
      username: '将新元',
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/c123456789',
      product_title: '商品C',
      final_price: 6550,
      shipping_fee_text: '落札者負担',
      payable_cny: 341
    }
  ], { 9: 270 });

  const rows = csv.split('\r\n');
  assert.equal(rows[1], '2026-06-21,将新元,https://auctions.yahoo.co.jp/jp/auction/c123456789,商品C,6550,270,6820,341');
  assert.equal(rows.at(-1), '金额汇总,,,,,,6820,341');
}

testBuildOrdersCsvAppendsTotalSummaryRow();
testBuildOrdersCsvUsesShippingOverridesInSummary();
