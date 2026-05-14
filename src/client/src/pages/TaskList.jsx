import { useState, useEffect, useCallback } from 'react';
import { List, Tag, SpinLoading } from 'antd-mobile';
import { getTaskList, getTaskStats } from '../utils/api';

const STATUS_MAP = {
  pending: { label: '队列中', color: 'default' },
  processing: { label: '执行中', color: 'warning' },
  bidding: { label: '已出价', color: 'primary' },
  success: { label: '成功', color: 'success' },
  failed: { label: '出价失败', color: 'danger' }
};

const STRATEGY_LABELS = {
  direct: '即时拍',
  '1min': '结束前 1 分钟',
  '2min': '结束前 2 分钟',
  '5min': '结束前 5 分钟',
  '10min': '结束前 10 分钟'
};

export default function TaskList({ limit = 10, embedded = false }) {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(() => {
    Promise.all([
      getTaskList({ limit }),
      getTaskStats().catch(() => ({ data: null }))
    ])
      .then(([taskRes, statsRes]) => {
        setTasks(taskRes.data.data || []);
        setStats(statsRes.data || null);
      })
      .catch(() => {
        setTasks([]);
        setStats(null);
      })
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><SpinLoading /></div>;

  return (
    <>
      {stats && (
        <div style={{ margin: '12px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            ['总任务', stats.total],
            ['队列中', stats.pending],
            ['执行中', stats.processing],
            ['已出价', stats.bidding],
            ['成功', stats.success],
            ['出价失败', stats.failed],
          ].map(([label, value]) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value || 0}</div>
            </div>
          ))}
        </div>
      )}

      <List header="任务列表" style={{ marginTop: embedded ? 12 : 8 }}>
        {tasks.length === 0 && <List.Item>暂无任务</List.Item>}
        {tasks.map(task => {
          const s = STATUS_MAP[task.status] || { label: task.status, color: 'default' };
          const auctionId = task.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || task.product_id;
          const strategyLabel = STRATEGY_LABELS[task.strategy] || task.strategy || '即时拍';
          return (
            <List.Item key={task.id}
              extra={<Tag color={s.color}>{s.label}</Tag>}
              description={
                <div style={{ fontSize: 12, color: '#666' }}>
                  ID: {auctionId}，策略: {strategyLabel}
                </div>
              }
            >
              <div style={{ fontWeight: 500 }}>{task.product_title || ('商品 ' + auctionId)}</div>
            </List.Item>
          );
        })}
      </List>
    </>
  );
}

