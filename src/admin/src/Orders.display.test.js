const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');

const source = readFileSync(join(__dirname, 'Orders.tsx'), 'utf8');

assert.equal(
  source.includes('\u4eca\u65e5\u7ed3\u7b97\u6c47\u7387'),
  true,
  'Admin Orders settlement rate label should read \u4eca\u65e5\u7ed3\u7b97\u6c47\u7387'
);

assert.equal(
  source.includes('>\u7ed3\u7b97\u6c47\u7387<'),
  false,
  'Admin Orders should not keep the old bare \u7ed3\u7b97\u6c47\u7387 label'
);

assert.equal(
  /function canAutoSettle\(item: any\) \{[\s\S]*item\?\.can_settle[\s\S]*item\?\.order_status === 'pending_settlement'[\s\S]*\}/.test(source),
  true,
  'Admin Orders should allow pending_settlement orders to be settled again'
);

assert.equal(
  /function canAutoSettle\(item: any\) \{[\s\S]*item\?\.order_status === 'pending_payment'[\s\S]*item\?\.order_status === 'bundle_completed'[\s\S]*item\?\.order_status === 'pending_shipment'[\s\S]*\}/.test(source),
  true,
  'Admin Orders should allow eligible unchanged statuses to be settled again'
);

assert.equal(
  /function canAutoSettle\(item: any\) \{[\s\S]*!item\?\.settled_at[\s\S]*\}/.test(source),
  false,
  'Admin Orders settlement should not block recalculation after status remains unchanged'
);

assert.equal(
  source.includes('\u5f85\u652f\u4ed8\u3001\u5f85\u53d1\u8d27\u3001\u540c\u6346\u5b8c\u4e86\u6216\u5f85\u7ed3\u7b97'),
  true,
  'Admin Orders settlement validation message should mention \u5f85\u7ed3\u7b97'
);

assert.equal(
  /function canRequestPayment\(item: any\) \{[\s\S]*item\?\.settled_at[\s\S]*item\?\.order_status === 'pending_payment'[\s\S]*item\?\.order_status === 'bundle_completed'[\s\S]*item\?\.order_status === 'pending_settlement'[\s\S]*\}/.test(source),
  true,
  'Admin Orders payment request should allow selected settled payable orders before they enter pending_settlement'
);

assert.equal(
  /function canRequestPayment\(item: any\) \{[\s\S]*pending_shipment[\s\S]*\}/.test(source),
  false,
  'Admin Orders payment request should not submit pending_shipment orders back to payment'
);

assert.equal(
  source.includes('\u53ea\u80fd\u9009\u62e9\u5df2\u7ed3\u7b97\u4e14\u5e94\u4ed8\u6b3e\u4e0d\u4e3a\u7a7a\u7684\u5f85\u652f\u4ed8\u3001\u540c\u6346\u5b8c\u4e86\u6216\u5f85\u7ed3\u7b97\u8ba2\u5355'),
  true,
  'Admin Orders payment validation message should explain the new eligible statuses'
);

assert.equal(
  /function markSelectedRowsSettled[\s\S]*payable_cny: result\.payableCny[\s\S]*settled_at: prevRow\?\.settled_at \|\| new Date\(\)\.toISOString\(\)/.test(source),
  true,
  'Admin Orders should refresh selected row cache after settlement so immediate payment uses settled data'
);

assert.equal(
  source.includes('openRemarkEditor'),
  true,
  'Admin Orders should open a remark editor from the product title'
);

assert.equal(
  source.includes('/api/admin/orders/${remarkEditorOrder.id}/remark'),
  true,
  'Admin Orders should save remarks through the order remark API'
);

assert.equal(
  source.includes('>\u5907<'),
  true,
  'Admin Orders should show \u5907 marker for orders with remarks'
);
