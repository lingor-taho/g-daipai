const assert = require('assert');
const {
  CONFIG_DEFINITIONS,
  normalizeConfigValue,
  readConfigMap
} = require('./configService');

assert.equal(CONFIG_DEFINITIONS.multi_bid_min_price.defaultValue, 5000);
assert.equal(normalizeConfigValue('multi_bid_min_price', '6000'), 6000);
assert.equal(normalizeConfigValue('multi_bid_min_price', '-1'), 5000);
assert.equal(normalizeConfigValue('idle_bid_guard_minutes', '15'), 15);
assert.equal(normalizeConfigValue('idle_bid_guard_minutes', '0'), 10);

const fakeDb = {
  async getAll(sql, params) {
    assert.match(sql, /SELECT key, value FROM config/);
    assert.deepEqual(params, ['multi_bid_min_price', 'idle_bid_guard_minutes']);
    return [
      { key: 'multi_bid_min_price', value: '7000' },
      { key: 'idle_bid_guard_minutes', value: '20' }
    ];
  }
};

readConfigMap(fakeDb, ['multi_bid_min_price', 'idle_bid_guard_minutes']).then(result => {
  assert.equal(result.multi_bid_min_price, 7000);
  assert.equal(result.idle_bid_guard_minutes, 20);
  console.log('config service tests passed');
}).catch(err => {
  console.error(err);
  process.exitCode = 1;
});
