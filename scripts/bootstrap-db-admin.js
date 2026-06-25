const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function ensureDbPath() {
  const rawDbPath = process.env.DB_PATH;
  if (!rawDbPath) {
    fail('环境变量 DB_PATH 未设置。');
  }
  return rawDbPath;
}

function main() {
  const dbPath = ensureDbPath();
  const initSqlPath = path.join(process.cwd(), 'src', 'db', 'init.sql');
  if (!fs.existsSync(initSqlPath)) {
    fail(`未找到初始化 SQL 文件：${initSqlPath}`);
  }
  const dbDir = path.dirname(dbPath);
  if (dbDir && !fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);
  try {
    db.pragma('foreign_keys = ON');
    const initSql = fs.readFileSync(initSqlPath, 'utf8');
    db.exec(initSql);

    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminPass = process.env.ADMIN_PASS || 'admin123';
    const hash = bcrypt.hashSync(adminPass, 10);

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(adminUser);
    if (existing) {
      db.prepare('UPDATE users SET password_hash = ?, role = ? WHERE username = ?')
        .run(hash, 'admin', adminUser);
      console.log('admin 已存在，已重置密码为 admin123');
    } else {
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?,?,?)')
        .run(adminUser, hash, 'admin');
      console.log('admin 已创建');
    }

    console.log(`数据库路径：${dbPath}`);
    console.log('数据库初始化完成。');
  } finally {
    db.close();
  }
}

main();
