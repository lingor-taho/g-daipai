const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');

const source = readFileSync(join(__dirname, 'MessageRead.tsx'), 'utf8');

assert.equal(
  source.includes('yahoo-message-view'),
  true,
  'MessageRead modal should scope Yahoo-style trade message rendering'
);

assert.equal(
  source.includes('yahoo-own-message'),
  true,
  'MessageRead modal should decorate own Yahoo messages before rendering'
);

assert.equal(
  source.includes('#fffdd1') && source.includes('#f1f2ff'),
  true,
  'MessageRead modal should render seller/store messages and own messages with different Yahoo-like backgrounds'
);

assert.equal(
  source.includes('ul.sc-c46fd2ce-0') && source.includes('#messagelist'),
  true,
  'MessageRead modal should style both store and normal Yahoo message markup'
);
