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
  /item\?\.order_status === 'pending_settlement'[\s\S]*return Boolean\(item\?\.can_settle\)/.test(source),
  true,
  'Admin Orders should allow pending_settlement orders to be settled again'
);

assert.equal(
  source.includes('\u5f85\u652f\u4ed8\u3001\u5f85\u53d1\u8d27\u3001\u540c\u6346\u5b8c\u4e86\u6216\u5f85\u7ed3\u7b97'),
  true,
  'Admin Orders settlement validation message should mention \u5f85\u7ed3\u7b97'
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
