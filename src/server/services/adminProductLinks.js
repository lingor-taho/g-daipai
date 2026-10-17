const { getProductItemUrl } = require('../../shared/adminProductUrl.cjs');

// Enrich only the admin response; do not rewrite stored alerts or plugin data.
async function addAdminAlertProductTypes(database, flags) {
  const ids = new Set((String(flags.paymentAlertMessage || '').match(/[a-zA-Z]?\d{8,10}/g) || []).map(id => id.toLowerCase()));
  const alerts = [...(flags.shipmentAlerts || []), ...(flags.googleSheetAlerts || []),
    ...(flags.auctionHistoryAlerts || []).flatMap(alert => alert.items || [])];
  for (const alert of alerts) if (alert.productId) ids.add(String(alert.productId).toLowerCase());
  const productTypes = {};
  const list = [...ids];
  for (let offset = 0; offset < list.length; offset += 500) {
    const batch = list.slice(offset, offset + 500);
    const rows = await database.getAll(`SELECT product_id, product_type FROM products WHERE product_id IN (${batch.map(() => '?').join(',')})`, batch);
    for (const row of rows) productTypes[row.product_id] = row.product_type;
  }
  const enrich = alert => ({ ...alert, product_type: productTypes[String(alert.productId || '').toLowerCase()] || null });
  return { ...flags, productTypes,
    shipmentAlerts: (flags.shipmentAlerts || []).map(enrich),
    googleSheetAlerts: (flags.googleSheetAlerts || []).map(enrich),
    auctionHistoryAlerts: (flags.auctionHistoryAlerts || []).map(alert => ({ ...alert, items: (alert.items || []).map(enrich) })) };
}

async function fetchAdminProduct(database, service, productId) {
  const product = await database.getOne('SELECT product_id, product_type FROM products WHERE product_id = ?', [productId]);
  const url = getProductItemUrl(product);
  if (!url) return null;
  return { url, product: await service.fetchProduct(url, { adminProductType: product.product_type }) };
}

module.exports = { addAdminAlertProductTypes, fetchAdminProduct };
