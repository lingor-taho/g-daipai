const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'ClientRateSettings.tsx'), 'utf8');

assert.equal(source.includes('/api/admin/client-rate-settings'), true, 'Client rate page must use the client-rate settings API');
assert.equal(source.includes('/api/admin/user-client-rate-overrides'), true, 'Client rate page must use separate user client rate overrides');
assert.equal(source.includes('/api/admin/user-finance-overrides'), false, 'Client rate page must not reuse settlement finance overrides');
assert.equal(source.includes('/api/admin/finance-config'), false, 'Client rate page must not use settlement finance config');
assert.equal(source.includes('基准汇率 = BOC/100 + 全局调节'), true, 'Client rate page must explain the base rate formula');
