const assert = require('assert/strict');

const {
  isMalformedRequestUrl,
  shouldServeSpaForMalformedRequest,
  buildProxyTargetUrl
} = require('./serve-client-dist');

function testMalformedRequestUrlDetection() {
  assert.equal(isMalformedRequestUrl('/%'), true);
  assert.equal(isMalformedRequestUrl('/%E0%A4%A'), true);
  assert.equal(isMalformedRequestUrl('/foo%ZZbar'), true);
  assert.equal(isMalformedRequestUrl('/submit?url=https%3A%2F%2Fauctions.yahoo.co.jp%2Fjp%2Fauction%2Fx1234567890'), false);
  assert.equal(isMalformedRequestUrl('/assets/index-abc123.js'), false);
}

function testApiProxyTargetPreservesApiPathAndQuery() {
  const target = buildProxyTargetUrl('/api/task/list?page=1', 'http://localhost:3034');
  assert.equal(target.toString(), 'http://localhost:3034/api/task/list?page=1');
}

function testMalformedPageNavigationFallsBackToSpa() {
  assert.equal(shouldServeSpaForMalformedRequest({
    method: 'GET',
    headers: { accept: 'text/html,application/xhtml+xml' }
  }), true);
  assert.equal(shouldServeSpaForMalformedRequest({
    method: 'HEAD',
    headers: { accept: '*/*' }
  }), true);
  assert.equal(shouldServeSpaForMalformedRequest({
    method: 'GET',
    headers: { accept: 'image/avif,image/webp,*/*' }
  }), false);
  assert.equal(shouldServeSpaForMalformedRequest({
    method: 'POST',
    headers: { accept: 'text/html' }
  }), false);
}

testMalformedRequestUrlDetection();
testApiProxyTargetPreservesApiPathAndQuery();
testMalformedPageNavigationFallsBackToSpa();
