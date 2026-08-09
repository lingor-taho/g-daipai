const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const componentSource = fs.readFileSync(path.join(__dirname, 'SettlementRollback.tsx'), 'utf8');
const dataBatchSource = fs.readFileSync(path.join(__dirname, 'DataBatch.tsx'), 'utf8');

assert.match(dataBatchSource, /key: 'settlementRollback'/);
assert.match(dataBatchSource, /label: labels\.settlementRollback/);
assert.match(dataBatchSource, /<SettlementRollbackPage \/>/);
assert.match(componentSource, /\/api\/admin\/settlement-rollback\/run/);
assert.match(componentSource, /确认撤销这些订单的结算吗/);
assert.match(componentSource, /清空汇率、应付款、结算时间及相关费用/);
assert.match(componentSource, /订单恢复为“待支付”/);
