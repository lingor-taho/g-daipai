const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');

const source = readFileSync(join(__dirname, 'Users.tsx'), 'utf8');

assert.equal(
  source.includes("{ value: 'bid_blocked', label: '出价限制', color: 'red' }"),
  true,
  'Admin Users should expose the bid-blocked strategy option'
);

assert.equal(
  source.includes("search={{ labelWidth: 'auto' }}") &&
    source.includes('valueEnum: BID_STRATEGY_SCOPE_VALUE_ENUM'),
  true,
  'Admin Users should support combined username and bid-strategy search'
);

assert.equal(
  source.includes('search={false}'),
  false,
  'Admin Users should not disable the ProTable search form'
);
