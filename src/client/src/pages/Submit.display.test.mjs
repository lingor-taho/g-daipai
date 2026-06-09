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
