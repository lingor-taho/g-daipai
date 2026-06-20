const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  scanEncodingIssues,
  hasSuspiciousText
} = require('./encoding-guard');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gdaipai-encoding-'));
}

function writeFile(root, rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function runTests() {
  assert.equal(hasSuspiciousText('正常中文和日本語 円'), false);
  assert.equal(hasSuspiciousText('\\u5186 escape is stable'), false);
  assert.equal(hasSuspiciousText('\u935f\u55d7\u6437'), true);
  assert.equal(hasSuspiciousText('\ufffd'), true);

  const root = makeTempDir();
  writeFile(root, 'src/good.js', "const text = '正常中文';\n");
  writeFile(root, 'src/bad.js', "const text = '\u935f\u55d7\u6437';\n");
  writeFile(root, 'agents.md', '历史记录里允许出现 \u935f\u55d7\u6437\n');
  writeFile(root, 'src/admin/src/.umi/appData.json', 'generated \u935f\u55d7\u6437\n');
  writeFile(root, '.env', 'GOOGLE_SHEETS_SHEET_NAME=-Ygao-\n');

  const findings = scanEncodingIssues({
    rootDir: root,
    files: ['src/good.js', 'src/bad.js', 'agents.md', 'src/admin/src/.umi/appData.json', '.env']
  });

  assert.equal(findings.decodeErrors.length, 0);
  assert.deepEqual(findings.issues.map(issue => `${issue.file}:${issue.line}:${issue.kind}`), [
    'src/bad.js:1:mojibake'
  ]);

  writeFile(root, 'src/server/services/googleSheets.js', 'function looksLikeMojibake(text) { return /\ufffd|\u6d60\uff46\u5abf/.test(text); }\n');
  const allowed = scanEncodingIssues({
    rootDir: root,
    files: ['src/server/services/googleSheets.js']
  });
  assert.equal(allowed.issues.length, 0);
}

runTests();
