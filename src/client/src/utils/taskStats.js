export function getTaskStatCards(stats = {}) {
  return [
    ['总任务', stats.total],
    ['队列中', stats.pending],
    ['已出价', stats.bidding],
    ['成功', stats.success],
    ['出价失败', stats.failed],
    ['已终止', stats.cancelled]
  ].map(([label, value]) => ({ label, value: value || 0 }));
}
