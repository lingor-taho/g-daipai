/**
 * 提交价格校验测试
 * 测试修改后的逻辑：最高价的税前价 >= 商品目前的税前价即可提交（支持起拍价出价）
 */

// 把含税值折回税前（Yahoo 内部口径）。普通商品税前=原值。
function toTaxExcludedYen(value, taxType) {
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (taxType !== 'tax_included' || v < 10) return Math.floor(v);
  return Math.floor(((v / 1.1) + 1e-6) / 10) * 10;
}

// 校验：最高价的税前价 >= 商品目前的税前价
function validateSubmitPrice(submitMaxPrice, currentPrice, submitTaxType) {
  const submitTaxExcludedPrice = toTaxExcludedYen(submitMaxPrice, submitTaxType);
  const currentTaxExcludedPrice = Number(currentPrice || 0);
  return submitTaxExcludedPrice >= currentTaxExcludedPrice;
}

console.log('=== 起拍价出价测试（修改后：支持等于当前价） ===\n');

const tests = [
  {
    name: '普通商品 - 起拍价出价（等于当前价）',
    submitMaxPrice: 5000,
    currentPrice: 5000,
    submitTaxType: 'tax_zero',
    expectedValid: true,
    reason: '税前价 5000 = 当前价 5000，允许提交'
  },
  {
    name: '普通商品 - 高于起拍价',
    submitMaxPrice: 6000,
    currentPrice: 5000,
    submitTaxType: 'tax_zero',
    expectedValid: true,
    reason: '税前价 6000 > 当前价 5000，允许提交'
  },
  {
    name: '普通商品 - 低于当前价（不允许）',
    submitMaxPrice: 4000,
    currentPrice: 5000,
    submitTaxType: 'tax_zero',
    expectedValid: false,
    reason: '税前价 4000 < 当前价 5000，不允许提交'
  },
  {
    name: '商城商品 - 起拍价出价（税后等于当前价）',
    submitMaxPrice: 5500, // 税后 5500，税前 5000
    currentPrice: 5000,
    submitTaxType: 'tax_included',
    expectedValid: true,
    reason: '税前价 5000 = 当前价 5000，允许提交'
  },
  {
    name: '商城商品 - 税后高于起拍价',
    submitMaxPrice: 6600, // 税后 6600，税前 6000
    currentPrice: 5000,
    submitTaxType: 'tax_included',
    expectedValid: true,
    reason: '税前价 6000 > 当前价 5000，允许提交'
  },
  {
    name: '商城商品 - 税后低于当前价（不允许）',
    submitMaxPrice: 4400, // 税后 4400，税前 4000
    currentPrice: 5000,
    submitTaxType: 'tax_included',
    expectedValid: false,
    reason: '税前价 4000 < 当前价 5000，不允许提交'
  },
  {
    name: '商城商品 - 边界情况（税后刚好等于）',
    submitMaxPrice: 1100, // 税后 1100，税前 1000
    currentPrice: 1000,
    submitTaxType: 'tax_included',
    expectedValid: true,
    reason: '税前价 1000 = 当前价 1000，允许提交'
  },
  {
    name: '商城商品 - 边界情况（税后略低）',
    submitMaxPrice: 1090, // 税后 1090，税前 990
    currentPrice: 1000,
    submitTaxType: 'tax_included',
    expectedValid: false,
    reason: '税前价 990 < 当前价 1000，不允许提交'
  }
];

let passCount = 0;
for (const test of tests) {
  const isValid = validateSubmitPrice(test.submitMaxPrice, test.currentPrice, test.submitTaxType);
  const pass = isValid === test.expectedValid;
  if (pass) passCount++;
  
  const submitTaxExcluded = toTaxExcludedYen(test.submitMaxPrice, test.submitTaxType);
  
  console.log(`${pass ? '✓' : '✗'} ${test.name}`);
  console.log(`  提交最高价: ${test.submitMaxPrice}円 (税前: ${submitTaxExcluded}円)`);
  console.log(`  商品当前价: ${test.currentPrice}円 (税前)`);
  console.log(`  税类型: ${test.submitTaxType}`);
  console.log(`  校验结果: ${isValid ? '允许' : '拒绝'} (期望: ${test.expectedValid ? '允许' : '拒绝'})`);
  console.log(`  原因: ${test.reason}\n`);
}

console.log(`=== 测试结果 ===`);
console.log(`通过: ${passCount}/${tests.length}`);

console.log('\n=== 修改说明 ===');
console.log('修改前: 最高价必须 > 当前价（不支持起拍价出价）');
console.log('修改后: 最高价 >= 当前价（支持起拍价出价）');
console.log('口径: 所有比较都基于税前价');

if (passCount === tests.length) {
  console.log('\n✓ 所有测试通过！');
  process.exit(0);
} else {
  console.log('\n✗ 部分测试失败');
  process.exit(1);
}
