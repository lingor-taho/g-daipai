const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const files = ['content.js', 'background.js'];
const badPatterns = [
  { name: 'replacement character', pattern: /\uFFFD/ },
  { name: 'gbk replacement mojibake', pattern: /锟斤拷/ }
];

for (const file of files) {
  const fullPath = path.join(__dirname, file);
  const text = fs.readFileSync(fullPath, 'utf8');
  for (const item of badPatterns) {
    assert.equal(
      item.pattern.test(text),
      false,
      `${file} contains ${item.name}`
    );
  }
}

