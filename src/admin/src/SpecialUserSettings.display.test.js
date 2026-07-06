const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'SpecialUserSettings.tsx'), 'utf8');

assert.equal(source.includes('Tabs'), true, 'Special user settings page must use tabs');
assert.equal(source.includes("label: '特殊用户设置'"), true, 'Special user settings tab must exist');
assert.equal(source.includes("label: '用户端汇率设置'"), true, 'Client rate settings tab must exist');
assert.equal(source.includes('<ClientRateSettingsPage />'), true, 'Client rate settings must render inside special user settings page');
