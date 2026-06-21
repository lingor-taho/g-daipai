#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  path.join(root, 'src', 'server', 'routes'),
  path.join(root, 'src', 'server', 'services')
];

const productSnapshotFields = [
  'product_url',
  'product_title',
  'product_image_url',
  'current_price',
  'buyout_price',
  'bid_count',
  'tax_type',
  'product_type',
  'shipping_fee_text',
  'end_time'
];

function listFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectReadPathViolations(files) {
  const violations = [];
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const field of productSnapshotFields) {
        const directReadPattern = new RegExp(`\\b(?:t|tasks)\\.${field}\\b`);
        const statementPrefix = lines.slice(Math.max(0, index - 5), index + 1).join(' ');
        const isTaskWriteStatement = /\b(?:UPDATE\s+tasks|INSERT\s+INTO\s+tasks)\b/i.test(statementPrefix);
        const bareTaskWritePattern = isTaskWriteStatement
          ? new RegExp(`\\b${field}\\b`, 'i')
          : null;
        if (!directReadPattern.test(line) && !(bareTaskWritePattern && bareTaskWritePattern.test(line))) continue;
        violations.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          line: index + 1,
          field,
          text: line.trim()
        });
      }
    });
  }
  return violations;
}

function main() {
  const files = scanRoots.flatMap(listFiles);
  const violations = collectReadPathViolations(files);
  if (violations.length) {
    console.error('Product read-path fallback violations:');
    for (const item of violations) {
      console.error(`${item.file}:${item.line} ${item.field} ${item.text}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log('Product read-path closure check passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReadPathViolations,
  productSnapshotFields
};
