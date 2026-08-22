import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'ActiveBidding.jsx'), 'utf8');

assert.equal(
  source.includes("manual_import: '导入'") || source.includes('manual_import: "导入"'),
  true,
  'ActiveBidding page must render manual_import strategy as 导入'
);

assert.equal(
  source.includes('<InfiniteScroll') && source.includes('hasMore={items.length < total}'),
  true,
  'ActiveBidding must append the next 10 items when the user reaches the bottom'
);

assert.equal(
  source.includes('上一页') || source.includes('下一页'),
  false,
  'ActiveBidding must not render previous/next pagination buttons'
);
