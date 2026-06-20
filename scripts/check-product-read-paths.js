#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const scanRoots = [
  path.join(root, 'src', 'server', 'routes'),
  path.join(root, 'src', 'server', 'services')
];

const ignoredFiles = new Set([
  path.join(root, 'src', 'server', 'services', 'productRepository.js')
]);

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

function hasProductsFallback(line, field) {
  const normalized = line.replace(/\s+/g, ' ');
  return new RegExp(`COALESCE\\([^\\n]*\\bp\\.${field}\\b[^\\n]*\\bt\\.${field}\\b`, 'i').test(normalized);
}

function isWritePath(line) {
  return /\b(INSERT INTO|UPDATE|SET|VALUES)\b/i.test(line);
}

function isExplicitlyAllowed(line) {
  return /LEFT JOIN products|JOIN products|FROM products|ON p\.product_id|ON products\.product_id/i.test(line);
}

function isDebugComparisonRead(line, field) {
  const normalized = line.replace(/\s+/g, ' ');
  return new RegExp(`\\b(?:t|tasks)\\.${field}\\b\\s+AS\\s+task_${field}\\b`, 'i').test(normalized);
}

function isTaskBidAmountDisplayRead(line, field) {
  if (field !== 'buyout_price') return false;
  return /COALESCE\(t\.user_max_price,\s*t\.buyout_price,\s*t\.max_price\)/i.test(line.replace(/\s+/g, ' '));
}

function collectReadPathViolations(files) {
  const violations = [];
  for (const file of files) {
    if (ignoredFiles.has(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const field of productSnapshotFields) {
        const directReadPattern = new RegExp(`\\b(?:t|tasks)\\.${field}\\b`);
        if (!directReadPattern.test(line)) continue;
        if (hasProductsFallback(line, field)) continue;
        if (isWritePath(line)) continue;
        if (isExplicitlyAllowed(line)) continue;
        if (isDebugComparisonRead(line, field)) continue;
        if (isTaskBidAmountDisplayRead(line, field)) continue;
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
  console.log('Product read-path fallback check passed');
}

if (require.main === module) {
  main();
}

module.exports = {
  collectReadPathViolations,
  productSnapshotFields
};
