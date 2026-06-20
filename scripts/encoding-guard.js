const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEXT_FILE_RE = /\.(js|jsx|ts|tsx|json|md|txt|css|html|sql|bat|cjs|mjs|yml|yaml|env|example|gitignore|gitattributes|editorconfig)$/i;
const EXTRA_TEXT_FILES = new Set([
  '.env',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  'docker-compose.yml'
]);

const SKIP_PARTS = [
  'node_modules',
  '.git',
  'logs',
  'data',
  path.join('src', 'admin', 'src', '.umi'),
  path.join('src', 'admin', 'src', '.umi-production')
];

const ALLOWED_FILES = new Set([
  'agents.md'
]);

const ALLOWED_FILE_PREFIXES = [
  'docs/'
];

const ALLOWED_LINE_RULES = [
  {
    file: 'src/server/services/googleSheets.js',
    text: 'looksLikeMojibake'
  }
];

const SUSPICIOUS_CODEPOINTS = [
  0xFFFD,
  0x9225, 0x9241, 0x920E, 0x6506, 0x651C, 0x951B, 0x951F,
  0x935F, 0x9422, 0x7ECB, 0x8930, 0x6D63, 0x947E, 0x93BB,
  0x95B0, 0x5A75, 0x95C2, 0x95BB, 0x6FE0, 0x8B41, 0x7E3A,
  0x7E67, 0x74D2, 0x546E, 0x6902, 0x93C8, 0x6B76, 0x9350,
  0x934A, 0x93B6, 0x7487, 0x6F36, 0x6D93, 0x7459, 0x93C5
];

const OLD_SHEET_NAME = `-${String.fromCodePoint(0x4EE3, 0x62CD, 0x8868)}-`;
const SUSPICIOUS_CHARS = new Set(SUSPICIOUS_CODEPOINTS.map(code => String.fromCodePoint(code)));
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function normalizePath(value) {
  return value.replace(/\\/g, '/');
}

function isTextFile(relPath) {
  return TEXT_FILE_RE.test(relPath) || EXTRA_TEXT_FILES.has(relPath);
}

function shouldSkipFile(relPath) {
  const normalized = normalizePath(relPath);
  return SKIP_PARTS.some(part => normalized === normalizePath(part) || normalized.startsWith(`${normalizePath(part)}/`));
}

function isAllowedLine(file, line) {
  const normalized = normalizePath(file);
  if (ALLOWED_FILES.has(normalized)) return true;
  if (ALLOWED_FILE_PREFIXES.some(prefix => normalized.startsWith(prefix))) return true;
  return ALLOWED_LINE_RULES.some(rule => normalized === rule.file && line.includes(rule.text));
}

function getDefaultFiles(rootDir) {
  const tracked = execFileSync('git', ['ls-files'], { cwd: rootDir, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  if (fs.existsSync(path.join(rootDir, '.env'))) tracked.push('.env');
  return [...new Set(tracked)];
}

function hasSuspiciousText(text) {
  if (text.includes(OLD_SHEET_NAME)) return true;
  for (const char of text) {
    if (SUSPICIOUS_CHARS.has(char)) return true;
  }
  return false;
}

function issueKind(line) {
  if (line.includes(String.fromCodePoint(0xFFFD))) return 'replacement-char';
  if (line.includes(OLD_SHEET_NAME)) return 'old-google-sheet-name';
  return 'mojibake';
}

function safeSnippet(file, line) {
  if (normalizePath(file) === '.env') {
    const match = line.match(/^\s*([^=#\s]+)\s*=/);
    return match ? `${match[1]}=<masked>` : '<env-line>';
  }
  return line.trim().slice(0, 220);
}

function scanEncodingIssues(options = {}) {
  const rootDir = options.rootDir || path.resolve(__dirname, '..');
  const files = options.files || getDefaultFiles(rootDir);
  const issues = [];
  const decodeErrors = [];

  for (const relPath of files) {
    const normalized = normalizePath(relPath);
    if (shouldSkipFile(normalized) || !isTextFile(normalized)) continue;

    const absPath = path.join(rootDir, relPath);
    if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) continue;

    const bytes = fs.readFileSync(absPath);
    let text;
    try {
      text = UTF8_DECODER.decode(bytes);
    } catch (error) {
      decodeErrors.push({ file: normalized, error: error.message });
      continue;
    }

    text.split(/\r?\n/).forEach((line, index) => {
      if (!hasSuspiciousText(line) || isAllowedLine(normalized, line)) return;
      issues.push({
        file: normalized,
        line: index + 1,
        kind: issueKind(line),
        text: safeSnippet(normalized, line)
      });
    });
  }

  return { issues, decodeErrors };
}

function main() {
  const result = scanEncodingIssues();
  if (!result.decodeErrors.length && !result.issues.length) {
    console.log('Encoding guard passed.');
    return;
  }

  for (const item of result.decodeErrors) {
    console.error(`${item.file}: UTF-8 decode failed: ${item.error}`);
  }
  for (const issue of result.issues) {
    console.error(`${issue.file}:${issue.line}: ${issue.kind}: ${issue.text}`);
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  scanEncodingIssues,
  hasSuspiciousText
};
