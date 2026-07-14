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
  /ID:\s*<span\s+onDoubleClick=\{\(\) => handleRebid\(task\)\}/.test(source),
  true,
  'TaskList product IDs must support double-click rebidding'
);

assert.equal(
  /<div\s+key=\{task\.id\}\s+onDoubleClick=/.test(source),
  false,
  'TaskList rows must not trigger rebidding outside the product ID'
);

assert.equal(
  source.includes('title="双击可再次入札"'),
  false,
  'TaskList must not display a double-click rebid hint'
);

assert.equal(
  source.includes('onRebid(productUrl)'),
  true,
  'Embedded TaskList must reuse the submit page product-loading callback'
);
