const { spawnSync } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const adminDir = path.join(rootDir, 'src', 'admin');
const clientDir = path.join(rootDir, 'src', 'client');
const npmCommand = 'npm';

const steps = [
  ['Google Sheets config tests', process.execPath, ['src/server/services/googleSheets.test.js'], rootDir],
  ['Online users service tests', process.execPath, ['src/server/services/onlineUsers.test.js'], rootDir],
  ['Admin order route tests', process.execPath, ['src/server/routes/admin.orders.test.js'], rootDir],
  ['Plugin route tests', process.execPath, ['src/server/routes/plugin.test.js'], rootDir],
  ['Yahoo plugin content tests', process.execPath, ['yahoo-plugin/content.test.js'], rootDir],
  ['Yahoo plugin background tests', process.execPath, ['yahoo-plugin/background.test.js'], rootDir],
  ['Yahoo plugin encoding guard', process.execPath, ['yahoo-plugin/encoding.test.js'], rootDir],
  ['Admin build', npmCommand, ['run', 'build'], adminDir],
  ['Client build', npmCommand, ['run', 'build'], clientDir]
];

for (const [label, command, args, cwd] of steps) {
  console.log(`\n=== ${label} ===`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: process.env,
    shell: command === npmCommand
  });
  if (result.error) {
    console.error(`\nRegression failed while starting "${label}": ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\nRegression failed at "${label}" with exit code ${result.status}.`);
    process.exit(result.status || 1);
  }
}

console.log('\nRegression passed.');
