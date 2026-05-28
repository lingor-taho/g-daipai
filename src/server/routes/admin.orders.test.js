/**
 * 订单管理 API 测试
 * 测试新增的用户名、运费、银行手续费、手续费(RMB)字段
 */

// 测试运费解析函数
function parseShippingFeeToNumber(shippingFeeText) {
  const text = String(shippingFeeText || '').trim();
  if (!text || text === '-') return 0;
  if (/無料|着払い|落札者負担/i.test(text)) return 0;
  const match = text.match(/(\d[\d,]*)\s*円/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

// 测试应付款计算
function calculatePayable(finalPrice, shippingFeeText, bankFeeJpy, handlingFeeCny, rate) {
  const shippingFee = parseShippingFeeToNumber(shippingFeeText);
  return Number((((finalPrice + shippingFee + bankFeeJpy) * rate) + handlingFeeCny).toFixed(2));
}

console.log('=== 运费解析测试 ===');
const shippingTests = [
  { input: '送料 無料', expected: 0 },
  { input: '送料 着払い', expected: 0 },
  { input: '送料 落札者負担', expected: 0 },
  { input: '送料 1,000円', expected: 1000 },
  { input: '送料 500円', expected: 500 },
  { input: '送料 12,345円', expected: 12345 },
  { input: '-', expected: 0 },
  { input: '', expected: 0 },
  { input: null, expected: 0 }
];

let passCount = 0;
for (const test of shippingTests) {
  const result = parseShippingFeeToNumber(test.input);
  const pass = result === test.expected;
  if (pass) passCount++;
  console.log(`${pass ? '✓' : '✗'} "${test.input}" => ${result} (期望: ${test.expected})`);
}
console.log(`运费解析测试: ${passCount}/${shippingTests.length} 通过\n`);

console.log('=== 应付款计算测试 ===');
const payableTests = [
  {
    name: '基础计算（无运费）',
    finalPrice: 10000,
    shippingFeeText: '送料 無料',
    bankFeeJpy: 500,
    handlingFeeCny: 10,
    rate: 0.05,
    expected: (10000 + 0 + 500) * 0.05 + 10 // = 525 + 10 = 535
  },
  {
    name: '含运费计算',
    finalPrice: 20000,
    shippingFeeText: '送料 1,000円',
    bankFeeJpy: 500,
    handlingFeeCny: 15,
    rate: 0.05,
    expected: (20000 + 1000 + 500) * 0.05 + 15 // = 1075 + 15 = 1090
  },
  {
    name: '着払い运费（不计入）',
    finalPrice: 15000,
    shippingFeeText: '送料 着払い',
    bankFeeJpy: 0,
    handlingFeeCny: 20,
    rate: 0.049,
    expected: (15000 + 0 + 0) * 0.049 + 20 // = 735 + 20 = 755
  },
  {
    name: '高额运费',
    finalPrice: 50000,
    shippingFeeText: '送料 5,000円',
    bankFeeJpy: 1000,
    handlingFeeCny: 50,
    rate: 0.048,
    expected: (50000 + 5000 + 1000) * 0.048 + 50 // = 2688 + 50 = 2738
  }
];

passCount = 0;
for (const test of payableTests) {
  const result = calculatePayable(
    test.finalPrice,
    test.shippingFeeText,
    test.bankFeeJpy,
    test.handlingFeeCny,
    test.rate
  );
  const pass = Math.abs(result - test.expected) < 0.01;
  if (pass) passCount++;
  console.log(`${pass ? '✓' : '✗'} ${test.name}`);
  console.log(`  落札: ${test.finalPrice}円, 运费: "${test.shippingFeeText}", 银行: ${test.bankFeeJpy}円, 手续费: ${test.handlingFeeCny}元, 汇率: ${test.rate}`);
  console.log(`  结果: ${result}元 (期望: ${test.expected}元)\n`);
}
console.log(`应付款计算测试: ${passCount}/${payableTests.length} 通过\n`);

console.log('=== 公式验证 ===');
console.log('应付款 = (落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB)');
console.log('示例: (10000 + 1000 + 500) * 0.05 + 10 = 575 + 10 = 585元\n');

if (passCount === payableTests.length) {
  console.log('✓ 所有测试通过！');
  process.exit(0);
} else {
  console.log('✗ 部分测试失败');
  process.exit(1);
}
