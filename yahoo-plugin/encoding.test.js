const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const files = ['content.js', 'background.js'];
const badPatterns = [
  { name: 'UTF-8 BOM', pattern: /^\uFEFF/ },
  { name: 'replacement character', pattern: /\uFFFD/ },
  { name: 'gbk replacement mojibake', pattern: /\u95bf\u7194\u67bb\u93b7/ },
  { name: 'common UTF-8 decoded as GBK mojibake', pattern: /[\u95c1\u95c2\u95bb\u6fe0\u7f02\u5a75\u9227\u951f\u7e1e\u9518]/ },
  { name: 'BOM mojibake', pattern: /\u9518|\u7e1e/ },
  { name: 'copied truncation marker', pattern: /<[^>\r\n]*(?:\u672a\u663e\u793a|\u672a\u986f\u793a|not shown)[^>\r\n]*>/i }
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
