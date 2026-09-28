const http = require('http');
const { performance } = require('perf_hooks');

const services = [
  { name: 'API Server', url: 'http://127.0.0.1:3034/health', jsonHealth: true, logs: 'server-start.log / server-start.err.log' },
  { name: 'Client', url: 'http://127.0.0.1:3035/', logs: 'client-build.log / client-start.log' },
  { name: 'Admin Report', url: 'http://127.0.0.1:8000/', logs: 'admin-start.log' }
];

function probe(service, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    let timer;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      request.destroy();
      resolve(ok);
    };
    const request = http.get(service.url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) finish(false);
      });
      response.on('error', () => finish(false));
      response.on('end', () => {
        if (response.statusCode !== 200) return finish(false);
        if (service.jsonHealth) {
          try { finish(JSON.parse(body).status === 'ok'); } catch (_) { finish(false); }
        } else finish(/<html[\s>]/i.test(body));
      });
    });
    request.on('error', () => finish(false));
    // Absolute request deadline, including connection and response body time.
    timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
  });
}

async function waitForServices({ targets = services, timeoutMs = 20000, intervalMs = 500, log = console.log } = {}) {
  const start = performance.now();
  const deadline = start + timeoutMs;
  let ready = targets.map(() => false);
  do {
    ready = await Promise.all(targets.map((service) => probe(service, Math.min(1000, Math.max(1, deadline - performance.now())))));
    if (ready.every(Boolean) || performance.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, deadline - performance.now())));
  } while (performance.now() < deadline);
  targets.forEach((service, index) => log(ready[index]
    ? `${service.name} OK: ${service.url}`
    : `${service.name} NOT ready. Check ${service.logs || service.url}`));
  log(`Readiness check finished in ${((performance.now() - start) / 1000).toFixed(1)}s.`);
  return ready.every(Boolean);
}

if (require.main === module) {
  waitForServices().then((ok) => { process.exitCode = ok ? 0 : 1; }).catch((error) => {
    console.error(error.message); process.exitCode = 1;
  });
}

module.exports = { waitForServices };
