const { CONFIG_DEFINITIONS } = require('./configRegistry');

function normalizeConfigValue(key, value) {
  const definition = CONFIG_DEFINITIONS[key];
  if (!definition) return value;
  if (definition.type === 'boolean') {
    return value === true || value === '1' || value === 1;
  }
  if (definition.type === 'integer' || definition.type === 'number') {
    const number = Number(value);
    if (!Number.isFinite(number)) return definition.defaultValue;
    const normalized = definition.type === 'integer' ? Math.floor(number) : number;
    if (definition.min !== undefined && normalized < definition.min) return definition.defaultValue;
    if (definition.max !== undefined && normalized > definition.max) return definition.defaultValue;
    return normalized;
  }
  return value ?? definition.defaultValue;
}

async function readConfigMap(database, keys) {
  const rows = await database.getAll(
    `SELECT key, value FROM config WHERE key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const byKey = new Map(rows.map(row => [row.key, row.value]));
  return Object.fromEntries(keys.map(key => {
    const definition = CONFIG_DEFINITIONS[key];
    const raw = byKey.has(key) ? byKey.get(key) : definition?.defaultValue;
    return [key, normalizeConfigValue(key, raw)];
  }));
}

module.exports = {
  CONFIG_DEFINITIONS,
  normalizeConfigValue,
  readConfigMap
};
