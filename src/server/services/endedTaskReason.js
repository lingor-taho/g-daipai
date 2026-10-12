const ENDED_REASON = 'Auction ended according to product page snapshot';

// Read-only compatibility for old failures with an empty reason. Match the exact
// task, product and account; another bid on the same product is not evidence.
function withEndedTaskReason(items, database) {
  if (!database.raw || !items.some(t => t.status === 'failed' && !t.error_msg)) return items;
  const evidence = database.raw.prepare(`SELECT 1 FROM plugin_diagnostics d
    JOIN tasks t ON t.id=?
    WHERE d.product_id=t.product_id AND d.account_id=t.account_id
      AND d.type='bid_failure' AND d.message=?
      AND instr(',' || COALESCE(d.diagnostics,'') || ',', ',taskId=' || t.id || ',')>0 LIMIT 1`);
  return items.map(t => t.status === 'failed' && !t.error_msg && evidence.get(t.id,ENDED_REASON)
    ? {...t,error_msg:ENDED_REASON} : t);
}
module.exports = { ENDED_REASON, withEndedTaskReason };
