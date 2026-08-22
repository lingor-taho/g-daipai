import assert from 'assert/strict';
import { appendUniqueItems, mergeFirstPageItems } from './pagedList.js';

assert.deepEqual(
  appendUniqueItems([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]),
  [{ id: 1 }, { id: 2 }, { id: 3 }]
);

assert.deepEqual(
  appendUniqueItems([{ product_id: 'a' }], [{ product_id: 'a' }, { product_id: 'b' }], 'product_id'),
  [{ product_id: 'a' }, { product_id: 'b' }]
);

assert.deepEqual(
  mergeFirstPageItems(
    [{ id: 2, status: 'old' }, { id: 1, status: 'old' }],
    [{ id: 3, status: 'new' }, { id: 2, status: 'updated' }]
  ),
  [{ id: 3, status: 'new' }, { id: 2, status: 'updated' }, { id: 1, status: 'old' }]
);
