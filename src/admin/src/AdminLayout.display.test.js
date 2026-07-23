const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'layouts', 'AdminLayout.tsx'), 'utf8');
const dataBatchSource = fs.readFileSync(path.join(__dirname, 'DataBatch.tsx'), 'utf8');

assert.equal(source.includes("key: '/special-user-settings'"), true, 'Admin layout must show special user settings as a top-level menu');
assert.equal(source.includes("key: '/client-rate-settings'"), false, 'Client rate settings must not be a side-menu item');
assert.equal(source.includes('/special-user-settings-group'), false, 'Special user settings must not be rendered as a side-menu group');
assert.equal(source.includes('defaultOpenKeys={openMenuKeys}'), false, 'Admin layout must not render a special-user submenu');

assert.equal(
  source.includes('googleSheetAlerts.map') &&
    source.includes('Google表格写入失败：商品ID') &&
    source.includes('跳转批处理') &&
    source.includes("navigate('/data-batch?tab=receiptSheetBackfill')"),
  true,
  'Admin layout must show Google Sheet failures and link to the receipt sheet backfill tab'
);

assert.equal(
  source.includes("method: 'DELETE'") &&
    source.includes('/api/admin/google-sheet-alerts/') &&
    source.includes('aria-label="删除Google表格写入提醒"') &&
    source.includes('CloseOutlined'),
  true,
  'Admin layout must let the operator delete a Google Sheet failure alert'
);

assert.equal(
  dataBatchSource.includes("new URLSearchParams(location.search).get('tab')") &&
    dataBatchSource.includes("dataBatchTabKeys.has(requestedTab)") &&
    dataBatchSource.includes('activeKey={activeKey}') &&
    dataBatchSource.includes('receiptSheetBackfill'),
  true,
  'Data batch must select the requested tab from the URL'
);
