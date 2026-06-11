const assert = require('assert');
const {
  ORDER_STATUS_PENDING_PAYMENT,
  ORDER_STATUS_WAITING_SHIPPING,
  ORDER_STATUS_PENDING_BUNDLE,
  ORDER_STATUS_BUNDLE_COMPLETED,
  ORDER_STATUS_PENDING_SETTLEMENT,
  ORDER_STATUS_PENDING_SHIPMENT,
  ORDER_STATUS_PENDING_RECEIPT,
  ORDER_STATUS_CANCELLED,
  ORDER_STATUS_COMPLETED,
  ORDER_STATUS_LABELS,
  isTerminalOrderStatus
} = require('./domainConstants.cjs');

assert.equal(ORDER_STATUS_PENDING_PAYMENT, 'pending_payment');
assert.equal(ORDER_STATUS_WAITING_SHIPPING, 'waiting_shipping');
assert.equal(ORDER_STATUS_PENDING_BUNDLE, 'pending_bundle');
assert.equal(ORDER_STATUS_BUNDLE_COMPLETED, 'bundle_completed');
assert.equal(ORDER_STATUS_PENDING_SETTLEMENT, 'pending_settlement');
assert.equal(ORDER_STATUS_PENDING_SHIPMENT, 'pending_shipment');
assert.equal(ORDER_STATUS_PENDING_RECEIPT, 'pending_receipt');
assert.equal(ORDER_STATUS_CANCELLED, 'cancelled');
assert.equal(ORDER_STATUS_COMPLETED, 'completed');
assert.equal(ORDER_STATUS_LABELS[ORDER_STATUS_PENDING_SETTLEMENT], '待结算');
assert.equal(isTerminalOrderStatus(ORDER_STATUS_COMPLETED), true);
assert.equal(isTerminalOrderStatus(ORDER_STATUS_CANCELLED), true);
assert.equal(isTerminalOrderStatus(ORDER_STATUS_PENDING_PAYMENT), false);

console.log('domain constants tests passed');
