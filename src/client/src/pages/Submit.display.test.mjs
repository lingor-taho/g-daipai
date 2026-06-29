import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'Submit.jsx'), 'utf8');

assert.equal(
  source.includes('网站汇率'),
  false,
  'Submit page must not expose website rate wording to users'
);

assert.equal(
  source.includes('已获取标题（价格需在页面提取）'),
  false,
  'Submit page must not show title-only product fetch wording'
);

assert.equal(
  source.includes("Toast.show({ content: '已获取商品信息' });"),
  true,
  'Submit page should use the standard product fetch success toast'
);
