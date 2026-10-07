import assert from 'node:assert/strict';
import { isStatisticsDateTick, buildLineChartPoints, buildLineChartSegments } from './statisticsChart.js';

const ticks = Array.from({ length: 90 }, (_, index) => index).filter(index => isStatisticsDateTick(index, 90));
assert.deepEqual(ticks, [...Array.from({ length: 18 }, (_, index) => index * 5), 89]);
const points = buildLineChartPoints([
  { date: 'day1', harvest_rate: 0 },
  { date: 'day2', harvest_rate: 0.5 },
  { date: 'day3', harvest_rate: null },
  { date: 'day4', harvest_rate: 3 }
], 'harvest_rate', 1);
assert.equal(points[0].y, 190);
assert.equal(points[1].y, 95);
assert.equal(points[2].y, null);
assert.equal(points[3].y, 0);
assert.equal(points[3].value, 3, 'Overflow display retains the true ratio');
assert.equal(points[3].overflow, true);
assert.equal(points[0].x, 0);
assert.equal(points.at(-1).x, 900);
assert.deepEqual(buildLineChartSegments(points).map(segment => segment.map(point => point.date)), [['day1', 'day2'], ['day4']]);
console.log('Statistics chart tests passed.');
