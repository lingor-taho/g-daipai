import assert from 'node:assert/strict';
import { buildBidPriceMarkers, formatBidSubmissionTime } from './bidPriceTimeline.js';

const markers = buildBidPriceMarkers([
  { task_id: 1, amount: 1000 },
  { task_id: 2, amount: 2000 },
  { task_id: 3, amount: 2000 },
  { task_id: 4, amount: 5000 }
], 3500, 350);
assert.equal(markers.length, 4, 'Every submission gets a marker, including repeated prices');
assert.equal(markers[0].x, 70);
assert.equal(markers[1].x, 140);
assert.equal(markers[2].x, 140);
assert.equal(markers[2].lane, 1, 'Equal-price markers remain visible separately');
assert.equal(markers[3].x, 350);
assert.equal(markers[3].amount, 5000, 'An above-endpoint bid retains its real amount');
assert.equal(markers[3].overflow, true);
const highLimit = buildBidPriceMarkers([{ task_id: 1, amount: 9000 }], 2000, 900);
assert.equal(highLimit.length, 1);
assert.equal(highLimit[0].x, 900);
assert.equal(highLimit[0].currentX, 200, 'The current price stays at its true position below the submitted limit');
assert.equal(highLimit[0].amount, 9000);
assert.deepEqual(buildBidPriceMarkers([{ amount: 1000 }], 0), []);
assert.equal(formatBidSubmissionTime('2026-10-07 03:24:00'), '10-07 11:24');
assert.equal(formatBidSubmissionTime('2026-10-07T03:24:00Z'), '10-07 11:24');
assert.equal(formatBidSubmissionTime(null), '');
console.log('Bid price timeline tests passed.');
