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

function collectTaskAliases(text) {
  const aliases = new Set(['tasks']);
  const aliasPattern = /\b(?:FROM|JOIN)\s+tasks\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/gi;
  let match;
  while ((match = aliasPattern.exec(text)) !== null) {
    const alias = match[1];
    if (!['WHERE', 'ON', 'LEFT', 'INNER', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'ORDER', 'GROUP', 'LIMIT'].includes(alias.toUpperCase())) {
      aliases.add(alias);
    }
  }
  return [...aliases];
}

function hasUnaliasedTaskStatementContext(lines, index) {
  const statementPrefix = lines.slice(Math.max(0, index - 8), index + 1).join(' ');
  if (/\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+tasks\b/i.test(statementPrefix)) return true;
  return /\bFROM\s+tasks\b(?:\s+(?:WHERE|ORDER|GROUP|LIMIT|HAVING|$))/i.test(statementPrefix);
}

function hasBareTaskSnapshotField(line, field) {
  const qualifiedAllowedPattern = new RegExp(`\\b(?:p|products|excluded|bi|o|item)\\.${field}\\b`, 'i');
  if (qualifiedAllowedPattern.test(line)) return false;
  const aliasPattern = new RegExp(`\\bAS\\s+${field}\\b`, 'i');
  const sanitized = line.replace(aliasPattern, '');
  if (!/\b(?:SELECT|WHERE|AND|OR|SET|INSERT|UPDATE|DELETE|COALESCE|VALUES|FROM)\b/i.test(sanitized)) return false;
  return new RegExp(`(?<![\\w.])${field}(?!\\w)`, 'i').test(sanitized);
}

function hasCrossTableProductFallback(line, field, taskAliases) {
  const nonProductAliases = ['bi', 'o', ...taskAliases];
  const aliases = nonProductAliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const productFirst = new RegExp(`\\bCOALESCE\\([^\\n)]*\\bp\\.${field}\\b[^\\n)]*\\b(?:${aliases})\\.${field}\\b`, 'i');
  const otherFirst = new RegExp(`\\bCOALESCE\\([^\\n)]*\\b(?:${aliases})\\.${field}\\b[^\\n)]*\\bp\\.${field}\\b`, 'i');
  return productFirst.test(line) || otherFirst.test(line);
}

function collectReadPathViolations(files) {
  const violations = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const taskAliases = collectTaskAliases(text);
    lines.forEach((line, index) => {
      if (/\bSELECT\s+(?:\*|[A-Za-z_][A-Za-z0-9_]*\.\*)\s+FROM\s+tasks\b/i.test(line)) {
        violations.push({
          file: path.relative(root, file).replace(/\\/g, '/'),
          line: index + 1,
          field: '*',
          text: line.trim()
        });
      }
      for (const field of productSnapshotFields) {
        if (hasCrossTableProductFallback(line, field, taskAliases)) {
          violations.push({
            file: path.relative(root, file).replace(/\\/g, '/'),
            line: index + 1,
            field,
            text: line.trim()
          });
          continue;
        }
        const aliasedReadPattern = new RegExp(`\\b(?:${taskAliases.map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\.${field}\\b`);
        const hasBareField = hasUnaliasedTaskStatementContext(lines, index) && hasBareTaskSnapshotField(line, field);
        if (!aliasedReadPattern.test(line) && !hasBareField) continue;
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
