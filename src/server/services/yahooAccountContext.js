const { AsyncLocalStorage } = require('async_hooks');
const storage = new AsyncLocalStorage();
const context = () => storage.getStore() || null;
const accountId = () => Number(context()?.accountId || 0);
const run = (value, callback) => storage.run(value, callback);

// Business settings stay shared. Only execution state is namespaced.
const runtimeKeys = new Set([
  'transaction_start_requested', 'transaction_start_requested_source',
  'transaction_start_last_run_date', 'transaction_start_last_run_slot', 'transaction_start_last_run_log',
  'confirm_receipt_requested', 'confirm_receipt_requested_source', 'confirm_receipt_last_run_slot',
  'confirm_receipt_alert_message', 'scan_idle_counter', 'scan_requested',
  'payment_requested', 'payment_alert_message', 'shipment_alerts', 'google_sheet_alerts',
  'manual_captcha_challenge', 'yahoo_login_status', 'yahoo_login_message',
  'last_bidding_sync_at', 'last_orders_sync_at', 'last_bidding_sync_count'
]);
const scopedTables = ['tasks', 'orders', 'bid_logs', 'bidding_items', 'plugin_diagnostics',
  'manual_order_import_batches', 'manual_order_import_items', 'yahoo_trade_messages'];

function configKey(key, id) {
  return runtimeKeys.has(key) && id ? `yahoo:${id}:${key}` : key;
}

// Tokenize SQL so identifiers in strings/comments are never rewritten. SELECTs
// use account views; writes retain real tables and are fenced by DB triggers.
function prepareQuery(sql, params, primaryId) {
  const id = accountId();
  const runtimeId = id || primaryId;
  const configQuery = /\b(?:FROM|INTO|UPDATE)\s+config\b/i.test(sql);
  const tokens = sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\b[A-Za-z_][A-Za-z_0-9]*\b|\s+|./g) || [];
  let expectTable = false;
  let readTable = true;
  let previous = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^\s+$/.test(token) || token.startsWith('--') || token.startsWith('/*')) continue;
    if (configQuery && token.startsWith("'") && runtimeKeys.has(token.slice(1, -1))) {
      tokens[i] = `'${configKey(token.slice(1, -1), runtimeId)}'`;
    }
    if (expectTable) {
      const name=token.replace(/^"|"$/g,'').toLowerCase();
      if (readTable && id && scopedTables.includes(name)) {
        let j = i + 1;
        while (/^\s+$/.test(tokens[j] || '')) j++;
        const alias = tokens[j] || '';
        const hasAlias = /^AS$/i.test(alias) || (/^[A-Za-z_][A-Za-z_0-9]*$/.test(alias) && !/^(WHERE|ON|INNER|LEFT|RIGHT|JOIN|GROUP|ORDER|LIMIT|HAVING|UNION|SET|CROSS|FULL|INDEXED|NOT|EXCEPT|INTERSECT)$/i.test(alias));
        tokens[i] = `yahoo_scope_${name}${hasAlias ? '' : ` AS ${token}`}`;
      }
      expectTable = false;
    }
    if (/^(FROM|JOIN)$/i.test(token)) { expectTable = true; readTable=previous.toUpperCase()!=='DELETE'; }
    previous=token;
  }
  return {
    sql: tokens.join(''),
    params: configQuery && params ? params.map(value => typeof value === 'string' ? configKey(value, runtimeId) : value) : params,
    restore(row) {
      if (row?.key?.startsWith(`yahoo:${runtimeId}:`)) return { ...row, key: row.key.slice(`yahoo:${runtimeId}:`.length) };
      return row;
    }
  };
}

function installAccountIsolation(raw) {
  raw.function('current_yahoo_account', () => accountId());
  for (const table of scopedTables) {
    raw.exec(`CREATE VIEW IF NOT EXISTS yahoo_scope_${table} AS
      SELECT * FROM ${table} WHERE account_id = current_yahoo_account();
      CREATE TRIGGER IF NOT EXISTS yahoo_guard_${table}_update BEFORE UPDATE ON ${table}
      WHEN current_yahoo_account() > 0 AND (NEW.account_id <> current_yahoo_account() OR (OLD.account_id > 0 AND OLD.account_id <> current_yahoo_account()))
      BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS yahoo_guard_${table}_delete BEFORE DELETE ON ${table}
      WHEN current_yahoo_account() > 0 AND OLD.account_id <> current_yahoo_account()
      BEGIN SELECT RAISE(IGNORE); END;
      CREATE TRIGGER IF NOT EXISTS yahoo_guard_${table}_insert BEFORE INSERT ON ${table}
      WHEN current_yahoo_account() > 0 AND NEW.account_id > 0 AND NEW.account_id <> current_yahoo_account()
      BEGIN SELECT RAISE(ABORT, 'Yahoo account mismatch'); END;`);
    const parent = table === 'orders' || table === 'bid_logs'
      ? '(SELECT account_id FROM tasks WHERE id = NEW.task_id)'
      : table === 'yahoo_trade_messages'
        ? '(SELECT account_id FROM orders WHERE id = NEW.order_id)'
        : table === 'manual_order_import_items'
          ? '(SELECT account_id FROM manual_order_import_batches WHERE id = NEW.batch_id)'
          : 'NULL';
    raw.exec(`CREATE TRIGGER IF NOT EXISTS yahoo_fill_${table}_account AFTER INSERT ON ${table}
      WHEN NEW.account_id = 0 OR NEW.account_id IS NULL
      BEGIN UPDATE ${table} SET account_id = COALESCE(${parent}, NULLIF(current_yahoo_account(),0),
        (SELECT id FROM yahoo_accounts WHERE is_primary=1)) WHERE rowid=NEW.rowid; END;`);
  }
}

module.exports = { context, accountId, run, runtimeKeys, scopedTables, configKey, prepareQuery, installAccountIsolation };
