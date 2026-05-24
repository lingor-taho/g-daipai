import assert from 'node:assert/strict';
import { formatBeijingDateTime } from './datetime.js';

function testFormatsUtcSqlTimeAsBeijingTime() {
  assert.equal(formatBeijingDateTime('2026-05-22 01:46:35'), '2026-05-22 09:46:35');
}

function testFormatsIsoOffsetTimeAsBeijingTime() {
  assert.equal(formatBeijingDateTime('2026-05-22T10:46:35+09:00'), '2026-05-22 09:46:35');
}

testFormatsUtcSqlTimeAsBeijingTime();
testFormatsIsoOffsetTimeAsBeijingTime();
