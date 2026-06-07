import assert from 'assert/strict';
import { buildManualVerificationAlert } from './manualVerificationAlert.js';

function testClientAdminSeesPinAlertOnly() {
  assert.deepEqual(
    buildManualVerificationAlert(3, { type: 'pin', id: 'pin-1' }),
    { show: true, message: '后端有事情要处理！' }
  );
  assert.deepEqual(
    buildManualVerificationAlert(3, { type: 'captcha', id: 'captcha-1' }),
    { show: false, message: '' }
  );
  assert.deepEqual(
    buildManualVerificationAlert(1, { type: 'pin', id: 'pin-1' }),
    { show: false, message: '' }
  );
}

testClientAdminSeesPinAlertOnly();
