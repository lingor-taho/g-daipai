const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { performance } = require('perf_hooks');
const { buildIfNeeded } = require('./build-if-needed');
const { waitForServices } = require('./wait-for-services');

function testBuildCache() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'g-daipai startup '));
  function write(name, content = 'source') {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  try {
    let builds = 0;
    const options = {
      root, target: 'client', log() {}, env: {},
      build() {
        builds++;
        write('src/client/dist/index.html', '<html>ready</html>');
        write('src/client/dist/assets/app.js', 'compiled');
        write('src/client/src/.umi-production/generated.js', String(builds));
      }
    };
    write('src/client/src/app.js');
    write('src/client/package-lock.json');
    assert.equal(buildIfNeeded(options), true, 'first launch builds');
    assert.equal(buildIfNeeded(options), false, 'unchanged launch skips build');
    const app = path.join(root, 'src/client/src/app.js');
    fs.utimesSync(app, new Date(), new Date());
    write('src/client/ignored.log');
    write('src/server/api.js');
    assert.equal(buildIfNeeded(options), false, 'timestamps, logs and API do not rebuild frontend');
    for (const file of [
      'src/client/src/app.js', 'src/shared/orderStatus.js', 'src/client/public/icon.svg',
      'src/client/vite.config.js', 'src/client/.env.production', 'src/client/package-lock.json',
      'src/client/node_modules/.package-lock.json', 'package-lock.json'
    ]) {
      write(file, 'updated');
      assert.equal(buildIfNeeded(options), true, `${file} change rebuilds`);
      assert.equal(buildIfNeeded(options), false);
    }
    fs.unlinkSync(app);
    assert.equal(buildIfNeeded(options), true, 'source deletion rebuilds');
    fs.unlinkSync(path.join(root, 'src/client/dist/assets/app.js'));
    assert.equal(buildIfNeeded(options), true, 'missing output asset rebuilds');
    fs.unlinkSync(path.join(root, 'src/client/dist/index.html'));
    assert.equal(buildIfNeeded(options), true, 'missing index rebuilds');
    write('src/client/src/app.js', 'new version');
    assert.throws(() => buildIfNeeded({ ...options, build() { throw new Error('compile failed'); } }), /compile failed/);
    assert.equal(fs.existsSync(path.join(root, 'src/client/dist/.startup-build.json')), false);
    assert.equal(buildIfNeeded(options), true, 'failed build retries next launch');
    assert.equal(buildIfNeeded({ ...options, env: { VITE_ENDPOINT: '/new' } }), true, 'build env change rebuilds');
    assert.equal(buildIfNeeded({ ...options, force: true }), true, 'force rebuild works');
    assert.throws(() => buildIfNeeded({ ...options, force: true, build() {
      options.build();
      write('src/shared/orderStatus.js', 'changed during compilation');
    } }), /inputs changed during build/);
    assert.equal(buildIfNeeded(options), true);
    assert.ok(builds > 0);
  } finally {
    // Only remove the exact isolated directory created by this test.
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('g-daipai startup '));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testReadiness() {
  let ready = true;
  let apiBody = '{"status":"ok"}';
  const server = http.createServer((req, res) => {
    if (req.url === '/hang') return;
    if (!ready) { res.writeHead(503); res.end('starting'); return; }
    res.end(req.url === '/health' ? apiBody : '<html>ready</html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const targets = [{ name: 'API', url: `${base}/health`, jsonHealth: true }, { name: 'Web', url: `${base}/` }];
  const options = { targets, timeoutMs: 1000, intervalMs: 20, log() {} };
  try {
    const start = performance.now();
    assert.equal(await waitForServices(options), true);
    assert.ok(performance.now() - start < 800, 'ready services return without waiting for the deadline');
    ready = false;
    const timer = setTimeout(() => { ready = true; }, 100);
    assert.equal(await waitForServices(options), true, 'services becoming ready are detected');
    clearTimeout(timer);
    ready = false;
    assert.equal(await waitForServices({ ...options, timeoutMs: 100 }), false, 'HTTP failure is not ready');
    ready = true;
    apiBody = '{"status":"error"}';
    assert.equal(await waitForServices({ ...options, timeoutMs: 100 }), false, 'API health body is checked');
    const hangingStart = performance.now();
    assert.equal(await waitForServices({ ...options, targets: [{ name: 'Hung', url: `${base}/hang` }], timeoutMs: 120 }), false);
    assert.ok(performance.now() - hangingStart < 800, 'hanging HTTP response is bounded by deadline');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await waitForServices({ ...options, timeoutMs: 100 }), false, 'closed port is not ready');
}

(async () => {
  testBuildCache();
  await testReadiness();
  console.log('Startup build cache and readiness tests passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
