const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const stampName = '.startup-build.json';
const excluded = new Set(['node_modules', 'dist', '.git', '.umi', '.umi-production', '.cache', 'coverage']);

function hashPaths(root, paths, skip = () => false) {
  const hash = crypto.createHash('sha256');
  function visit(file) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    if (skip(file)) return;
    if (!fs.existsSync(file)) {
      hash.update(`missing:${relative}\0`);
      return;
    }
    if (fs.statSync(file).isDirectory()) {
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name));
    } else {
      const content = fs.readFileSync(file);
      hash.update(`${relative}\0${content.length}\0`);
      hash.update(content);
    }
  }
  for (const file of paths) visit(file);
  return hash.digest('hex');
}

function inputHash(root, project, env = process.env) {
  const files = [project, path.join(root, 'src', 'shared')];
  for (const base of [root, project]) {
    for (const name of ['package.json', 'package-lock.json', '.npmrc', 'node_modules/.package-lock.json']) {
      files.push(path.join(base, name));
    }
  }
  const sourceHash = hashPaths(root, files, (file) => {
    const name = path.basename(file);
    return excluded.has(name) || name.startsWith('.umi-') || name.endsWith('.log');
  });
  // Build-time variables can change compiled assets even when files are unchanged.
  const buildEnv = Object.keys(env).filter((key) => /^(VITE_|UMI_|REACT_APP_|NODE_ENV$|PUBLIC_PATH$|BASE_URL$|BABEL_ENV$)/.test(key))
    .sort().map((key) => [key, env[key]]);
  return crypto.createHash('sha256').update(JSON.stringify([1, process.version, process.platform, sourceHash, buildEnv])).digest('hex');
}

function outputHash(root, project) {
  return hashPaths(root, [path.join(project, 'dist')], (file) => path.basename(file) === stampName);
}

function runBuild(project) {
  // Only fixed arguments enter the shell; the project path is passed through cwd.
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: project, stdio: 'inherit', shell: process.platform === 'win32', env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build exited with code ${result.status}`);
}

function buildIfNeeded({ root = path.resolve(__dirname, '..'), target, force = false, build = runBuild, log = console.log, env = process.env }) {
  if (!['client', 'admin'].includes(target)) throw new Error('Target must be client or admin');
  const project = path.join(root, 'src', target);
  const stampFile = path.join(project, 'dist', stampName);
  const indexFile = path.join(project, 'dist', 'index.html');
  const before = inputHash(root, project, env);
  let stamp;
  try { stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch (_) { /* First build or invalid stamp. */ }
  if (!force && fs.existsSync(indexFile) && stamp?.input === before && stamp.output === outputHash(root, project)) {
    log(`[${target}] Build unchanged; using existing dist.`);
    return false;
  }
  log(`[${target}] Build required (inputs changed, first run, or dist missing/changed).`);
  // A failed build must never leave a successful cache record behind.
  fs.rmSync(stampFile, { force: true });
  build(project);
  if (!fs.existsSync(indexFile)) throw new Error(`${target} build did not produce dist/index.html`);
  if (inputHash(root, project, env) !== before) throw new Error(`${target} inputs changed during build; retry before using the cache`);
  fs.writeFileSync(stampFile, JSON.stringify({ input: before, output: outputHash(root, project) }) + '\n');
  log(`[${target}] Build completed; cache recorded.`);
  return true;
}

if (require.main === module) {
  try { buildIfNeeded({ target: process.argv[2], force: process.argv.includes('--force') }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildIfNeeded };
