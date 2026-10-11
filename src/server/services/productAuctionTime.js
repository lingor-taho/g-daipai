// A win on any Yahoo account establishes the end of the shared auction.
// This reads time only; user ownership and account-specific execution stay separate.
const winningOrderMatch = `o.product_id=p.product_id
  OR (COALESCE(o.product_id,'')='' AND winning_task.product_id=p.product_id)`;
const hasWinningOrderSql = `EXISTS(SELECT 1 FROM orders o
  LEFT JOIN tasks winning_task ON winning_task.id=o.task_id WHERE ${winningOrderMatch})`;
const winningTimeSql = `(SELECT o.won_at FROM orders o
  LEFT JOIN tasks winning_task ON winning_task.id=o.task_id
  WHERE ${winningOrderMatch} ORDER BY o.id LIMIT 1)`;
const auctionEndTimeSql = `CASE WHEN ${hasWinningOrderSql}
  THEN ${winningTimeSql} ELSE p.end_time END`;

module.exports = { hasWinningOrderSql, auctionEndTimeSql };
