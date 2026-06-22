const assert = require('assert');
const Database = require('better-sqlite3');
const { collectProductParity } = require('./check-product-parity');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE products (
      product_id VARCHAR(32) PRIMARY KEY,
      product_url TEXT,
      product_title VARCHAR(512),
      product_image_url TEXT
    );
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id VARCHAR(32)
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER,
      product_id VARCHAR(32)
    );
  `);
  return db;
}

function testCollectProductParityCountsOnlyRelationshipGaps() {
  const db = createDb();
  try {
    db.prepare("INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)").run('p1', 'url1', 'title1', 'image1');
    db.prepare("INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)").run('p3', 'url3', 'title3', 'image3');
    db.prepare("INSERT INTO products (product_id, product_url, product_title, product_image_url) VALUES (?, ?, ?, ?)").run('p4', 'url4', 'title4', 'image4');

    db.prepare('INSERT INTO tasks (id, product_id) VALUES (?, ?)').run(1, 'p1');
    db.prepare('INSERT INTO tasks (id, product_id) VALUES (?, ?)').run(2, 'p2');
    db.prepare('INSERT INTO tasks (id, product_id) VALUES (?, ?)').run(3, 'p3');
    db.prepare('INSERT INTO tasks (id, product_id) VALUES (?, ?)').run(4, 'p4');

    db.prepare('INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)').run(10, 1, 'p1');
    db.prepare('INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)').run(11, 1, null);
    db.prepare('INSERT INTO orders (id, task_id, product_id) VALUES (?, ?, ?)').run(12, 1, 'different');

    assert.deepEqual(collectProductParity(db), {
      tasksWithoutProductRow: 1,
      ordersWithoutProductId: 1,
      ordersProductIdMismatch: 1
    });
  } finally {
    db.close();
  }
}

testCollectProductParityCountsOnlyRelationshipGaps();
console.log('product parity check tests passed');
