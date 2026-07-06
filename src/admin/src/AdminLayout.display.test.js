const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'layouts', 'AdminLayout.tsx'), 'utf8');

const specialGroupIndex = source.indexOf("key: '/special-user-settings-group'");
const clientRateIndex = source.indexOf("key: '/client-rate-settings'");
const accountsIndex = source.indexOf("key: '/accounts'");

assert.ok(specialGroupIndex >= 0, 'Special user settings must be a parent menu group');
assert.ok(clientRateIndex > specialGroupIndex, 'Client rate settings must be nested under special user settings');
assert.ok(clientRateIndex < accountsIndex, 'Client rate settings must not be a separate top-level item after accounts');
assert.equal(source.includes('buildAdminMenuItems(item.children'), true, 'Admin layout must render nested menu children');
assert.equal(source.includes('defaultOpenKeys={openMenuKeys}'), true, 'Admin layout must open the selected parent menu');
