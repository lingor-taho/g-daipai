const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'layouts', 'AdminLayout.tsx'), 'utf8');

assert.equal(source.includes("key: '/special-user-settings'"), true, 'Admin layout must show special user settings as a top-level menu');
assert.equal(source.includes("key: '/client-rate-settings'"), false, 'Client rate settings must not be a side-menu item');
assert.equal(source.includes('/special-user-settings-group'), false, 'Special user settings must not be rendered as a side-menu group');
assert.equal(source.includes('defaultOpenKeys={openMenuKeys}'), false, 'Admin layout must not render a special-user submenu');
