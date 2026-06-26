const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');

const source = readFileSync(join(__dirname, 'Orders.tsx'), 'utf8');

assert.equal(
  source.includes('\u4eca\u65e5\u7ed3\u7b97\u6c47\u7387'),
  true,
  'Admin Orders settlement rate label should read 今日结算汇率'
);

assert.equal(
  source.includes('>\u7ed3\u7b97\u6c47\u7387<'),
  false,
  'Admin Orders should not keep the old bare 结算汇率 label'
);
