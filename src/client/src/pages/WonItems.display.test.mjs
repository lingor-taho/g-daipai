import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'WonItems.jsx'), 'utf8');

assert.equal(
  source.includes("manual_import: '导入'") || source.includes('manual_import: "导入"'),
  true,
  'WonItems page must render manual_import strategy as 导入'
);

assert.equal(
  source.includes('购买页面') && source.includes('/purchase-page'),
  true,
  'WonItems page must link won items to the read-only purchase page'
);

assert.equal(
  source.includes("canViewPurchasePage = item.order_status === 'completed'") && source.includes('{canViewPurchasePage ?'),
  true,
  'WonItems page must show the purchase page button only for completed orders'
);
