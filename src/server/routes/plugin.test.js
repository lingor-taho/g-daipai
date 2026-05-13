const assert = require('assert/strict');
const {
  getStrategyLeadMs,
  isTaskReadyForDispatch,
  chooseNextPluginTask,
  isTaskNeedingEndTimeRefresh
} = require('./plugin');

const now = Date.parse('2026-05-13T12:00:00.000Z');

function minutesFromNow(minutes) {
  return new Date(now + minutes * 60 * 1000).toISOString();
}

function testDirectTaskIsReadyImmediately() {
  assert.equal(isTaskReadyForDispatch({ strategy: 'direct', end_time: minutesFromNow(60) }, now), true);
  assert.equal(isTaskReadyForDispatch({ strategy: 'direct', end_time: minutesFromNow(-1) }, now), false);
}

function testTimedTaskWaitsUntilLeadWindow() {
  assert.equal(getStrategyLeadMs({ strategy: '5min' }), 5 * 60 * 1000);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: minutesFromNow(6) }, now), false);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: minutesFromNow(5) }, now), true);
  assert.equal(isTaskReadyForDispatch({ strategy: '5min', end_time: null }, now), true);
  assert.equal(isTaskNeedingEndTimeRefresh({ strategy: '5min', end_time: null }), true);
}

function testTimedTaskUsesExplicitMinuteColumns() {
  assert.equal(
    getStrategyLeadMs({ strategy: 'custom', start_minutes_before: 2, start_seconds_before: 30 }),
    150000
  );
}

function testChooseNextTaskSkipsFutureTimedTask() {
  const task = chooseNextPluginTask([
    { id: 1, strategy: '10min', end_time: minutesFromNow(30), created_at: '2026-05-13T10:00:00Z' },
    { id: 2, strategy: 'direct', end_time: minutesFromNow(30), created_at: '2026-05-13T10:01:00Z' }
  ], now);
  assert.equal(task.id, 2);
}

function testChooseRefreshTaskWhenNoExecutableTaskExists() {
  const task = chooseNextPluginTask([
    { id: 1, strategy: '10min', end_time: minutesFromNow(30), created_at: '2026-05-13T10:00:00Z' },
    { id: 2, strategy: '5min', end_time: null, created_at: '2026-05-13T10:01:00Z' }
  ], now);
  assert.equal(task.id, 2);
}

testDirectTaskIsReadyImmediately();
testTimedTaskWaitsUntilLeadWindow();
testTimedTaskUsesExplicitMinuteColumns();
testChooseNextTaskSkipsFutureTimedTask();
testChooseRefreshTaskWhenNoExecutableTaskExists();
