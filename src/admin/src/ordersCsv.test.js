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
  assert.equal(rows.at(-2), '用户汇总,小毛,,,,,34783,35.5');
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
      payable_cny: 341,
      jpy_to_cny_rate: 0.05
    }
  ], { 9: 270 });

  const rows = csv.split('\r\n');
  assert.equal(rows[1], '2026-06-21,将新元,https://auctions.yahoo.co.jp/jp/auction/c123456789,商品C,6550,270,6820,354.5');
  assert.equal(rows.at(-2), '用户汇总,将新元,,,,,6820,354.5');
  assert.equal(rows.at(-1), '金额汇总,,,,,,6820,354.5');
}

function testBuildOrdersCsvSortsAndSummarizesByUsernameWithoutMutatingInput() {
  const input = [
    {
      id: 21,
      won_at: '2026-06-23 00:00:00',
      username: 'bob2',
      product_title: '商品B2',
      final_price: 200,
      shipping_fee_text: '100円',
      payable_cny: null
    },
    {
      id: 11,
      won_at: '2026-06-22 00:00:00',
      username: 'alice',
      product_title: '商品A',
      final_price: 100,
      shipping_fee_text: '落札者負担',
      payable_cny: 6.5
    },
    {
      id: 22,
      won_at: '2026-06-24 00:00:00',
      username: 'bob2',
      product_title: '商品B1',
      final_price: 300,
      shipping_fee_text: '0円',
      payable_cny: 15
    }
  ];

  const csv = buildOrdersCsv(input, { 11: 30 });
  const rows = csv.split('\r\n');

  assert.equal(rows[1], '2026-06-22,alice,,商品A,100,30,130,6.5');
  assert.equal(rows[2], '用户汇总,alice,,,,,130,6.5');
  assert.equal(rows[3], '2026-06-23,bob2,,商品B2,200,100,300,');
  assert.equal(rows[4], '2026-06-24,bob2,,商品B1,300,0,300,15');
  assert.equal(rows[5], '用户汇总,bob2,,,,,600,15');
  assert.equal(rows[6], '金额汇总,,,,,,730,21.5');
  assert.deepEqual(input.map(item => item.username), ['bob2', 'alice', 'bob2']);
}

testBuildOrdersCsvAppendsTotalSummaryRow();
testBuildOrdersCsvUsesShippingOverridesInSummary();
testBuildOrdersCsvSortsAndSummarizesByUsernameWithoutMutatingInput();

function testTemporaryShippingPreservesSettledFeesAndInput() {
  const order = Object.freeze({
    id: 1, username: '小陈', final_price: 40000, shipping_fee_text: '着払い',
    payable_cny: '1790', jpy_to_cny_rate: '0.0445', handling_fee_cny: 10
  });
  const input = Object.freeze([order]);
  const overrides = Object.freeze({ 1: 2000 });
  const csv = buildOrdersCsv(input, overrides);
  assert.equal(csv.split('\r\n')[1], '-,小陈,,,40000,2000,42000,1879');
  assert.equal(csv.split('\r\n')[2], '用户汇总,小陈,,,,,42000,1879');
  assert.equal(csv.split('\r\n')[3], '金额汇总,,,,,,42000,1879');
  assert.equal(buildOrdersCsv(input, overrides), csv, 'repeated exports must not accumulate shipping');
  assert.equal(order.payable_cny, '1790');
}

function testShippingPayableBoundaries() {
  const base = { id: 1, username: 'alice', final_price: 100, shipping_fee_text: '着払い', payable_cny: 14.45, jpy_to_cny_rate: 0.0445 };
  const cases = [
    { changes: {}, shipping: 0, expected: '14.45' },
    { changes: {}, shipping: 333, expected: '29.27' },
    { changes: { payable_cny: null }, shipping: 2000, expected: '' },
    { changes: { payable_cny: '' }, shipping: 2000, expected: '' },
    { changes: { shipping_fee_text: '200円' }, shipping: 2000, expected: '14.45' },
    ...[undefined, null, '', 0, -1, 'invalid'].map(rate => ({ changes: { jpy_to_cny_rate: rate }, shipping: 2000, expected: '14.45' }))
  ];
  for (const { changes, shipping, expected } of cases) {
    const lines = buildOrdersCsv([{ ...base, ...changes }], { 1: shipping }).split('\r\n');
    for (const line of lines.slice(1)) assert.equal(line.split(',').at(-1), expected);
  }
}

function testEachOrderUsesItsOwnRateAndSummariesRoundToCents() {
  const csv = buildOrdersCsv([
    { id: 1, username: 'alice', final_price: 1, shipping_fee_text: '着払い', payable_cny: 0.1, jpy_to_cny_rate: 0.05 },
    { id: 2, username: 'alice', final_price: 1, shipping_fee_text: '落札者負担', payable_cny: 0.1, jpy_to_cny_rate: 0.1 },
    { id: 3, username: 'bob', final_price: 1, shipping_fee_text: '着払い', payable_cny: 0.1, jpy_to_cny_rate: 0.05 }
  ], { 1: 2, 2: 2, 3: 2 });
  const lines = csv.split('\r\n');
  assert.equal(lines[1].split(',').at(-1), '0.2');
  assert.equal(lines[2].split(',').at(-1), '0.3');
  assert.equal(lines[3], '用户汇总,alice,,,,,6,0.5');
  assert.equal(lines[5], '用户汇总,bob,,,,,3,0.2');
  assert.equal(lines[6], '金额汇总,,,,,,9,0.7');
}

testTemporaryShippingPreservesSettledFeesAndInput();
testShippingPayableBoundaries();
testEachOrderUsesItsOwnRateAndSummariesRoundToCents();
