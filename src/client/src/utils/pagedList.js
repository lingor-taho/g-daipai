function getItemKey(item, keyField) {
  if (typeof keyField === 'function') return keyField(item);
  return item?.[keyField];
}

export function appendUniqueItems(currentItems, incomingItems, keyField = 'id') {
  const result = [...(currentItems || [])];
  const seen = new Set(result.map(item => String(getItemKey(item, keyField))));
  for (const item of incomingItems || []) {
    const key = String(getItemKey(item, keyField));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function mergeFirstPageItems(currentItems, firstPageItems, keyField = 'id') {
  const firstPage = [...(firstPageItems || [])];
  const firstPageKeys = new Set(firstPage.map(item => String(getItemKey(item, keyField))));
  return [
    ...firstPage,
    ...(currentItems || []).filter(item => !firstPageKeys.has(String(getItemKey(item, keyField))))
  ];
}
