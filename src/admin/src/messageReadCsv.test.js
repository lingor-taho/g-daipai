const assert = require('assert/strict');
const { buildMessageReadCsv } = require('./messageReadCsv');

function testBuildMessageReadCsvUsesRequestedColumnsAndEscapesValues() {
  const csv = buildMessageReadCsv([
    {
      username: 'stone',
      product_id: 'm1234567890',
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/m1234567890',
      product_title: '商品 "A", 未使用',
      won_at: '2026-08-18 14:35:00',
      tracking_number: '646715100662'
    }
  ], value => `上海时间:${value}`);

  assert.equal(
    csv,
    '用户名,商品url,商品名称,落札时间,追踪号\r\n' +
      'stone,https://auctions.yahoo.co.jp/jp/auction/m1234567890,"商品 ""A"", 未使用",上海时间:2026-08-18 14:35:00,646715100662'
  );
}

function testBuildMessageReadCsvFallsBackToYahooProductUrl() {
  const csv = buildMessageReadCsv([
    {
      username: '小陈',
      product_id: 'u1234567890',
      product_title: '换行\n商品',
      won_at: null,
      tracking_number: null
    }
  ]);

  assert.equal(
    csv,
    '用户名,商品url,商品名称,落札时间,追踪号\r\n' +
      '小陈,https://auctions.yahoo.co.jp/jp/auction/u1234567890,"换行\n商品",,'
  );
}

testBuildMessageReadCsvUsesRequestedColumnsAndEscapesValues();
testBuildMessageReadCsvFallsBackToYahooProductUrl();
