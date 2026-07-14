import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'TaskList.jsx'), 'utf8');

assert.equal(
  source.includes("manual_import: '导入'") || source.includes('manual_import: "导入"'),
  true,
  'TaskList page must render manual_import strategy as 导入'
);

assert.equal(
  source.includes('onDoubleClick={() => handleRebid(task)}'),
  true,
  'TaskList rows must support double-click rebidding'
);

assert.equal(
  source.includes('onRebid(productUrl)'),
  true,
  'Embedded TaskList must reuse the submit page product-loading callback'
);
