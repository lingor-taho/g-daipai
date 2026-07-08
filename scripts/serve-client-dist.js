const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const defaultDistDir = path.join(rootDir, 'src', 'client', 'dist');
const defaultPort = Number(process.env.CLIENT_PORT || 3035);
const defaultApiTarget = process.env.API_TARGET || 'http://localhost:3034';

function isMalformedRequestUrl(rawUrl) {
  try {
    decodeURI(String(rawUrl || ''));
    return false;
  } catch (_) {
    return true;
  }
}

function shouldServeSpaForMalformedRequest(req = {}) {
  const method = String(req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const accept = String(req.headers?.accept || '');
  if (!accept || accept.includes('text/html')) return true;
  if (!accept.includes('*/*')) return false;
  return !/image\/|text\/css|javascript|json|font\//i.test(accept);
}

function buildProxyTargetUrl(rawUrl, apiTarget = defaultApiTarget) {
  return new URL(String(rawUrl || '/'), apiTarget);
}

function copyProxyHeaders(headers, target) {
  const nextHeaders = { ...headers };
  nextHeaders.host = target.host;
  delete nextHeaders.connection;
  delete nextHeaders['content-length'];
  return nextHeaders;
}

function proxyApiRequest(req, res, apiTarget = defaultApiTarget) {
  const target = buildProxyTargetUrl(req.url, apiTarget);
  const transport = target.protocol === 'https:' ? https : http;
  const proxyReq = transport.request(target, {
    method: req.method,
    headers: copyProxyHeaders(req.headers, target)
  }, proxyRes => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', error => {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    res.status(502).json({ error: 'api proxy error' });
  });

  req.pipe(proxyReq);
}

function createClientApp({
  distDir = defaultDistDir,
  apiTarget = defaultApiTarget
} = {}) {
  const app = express();
  const indexPath = path.join(distDir, 'index.html');

  app.use((req, res, next) => {
    if (!isMalformedRequestUrl(req.url)) return next();
    if (shouldServeSpaForMalformedRequest(req) && fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    res.status(400).type('text/plain').send('Bad Request: malformed URL');
  });

  app.use((req, res, next) => {
    if (!String(req.url || '').startsWith('/api')) return next();
    proxyApiRequest(req, res, apiTarget);
  });

  app.use(express.static(distDir, {
    index: false,
    fallthrough: true
  }));

  app.get('*', (req, res) => {
    if (!fs.existsSync(indexPath)) {
      res.status(500).type('text/plain').send(`Client build not found: ${indexPath}`);
      return;
    }
    res.sendFile(indexPath);
  });

  return app;
}

function startServer({
  port = defaultPort,
  distDir = defaultDistDir,
  apiTarget = defaultApiTarget
} = {}) {
  const app = createClientApp({ distDir, apiTarget });
  return app.listen(port, '0.0.0.0', () => {
    console.log(`Client static server running on port ${port}`);
    console.log(`Serving ${distDir}`);
    console.log(`Proxying /api to ${apiTarget}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  isMalformedRequestUrl,
  shouldServeSpaForMalformedRequest,
  buildProxyTargetUrl,
  createClientApp,
  startServer
};
