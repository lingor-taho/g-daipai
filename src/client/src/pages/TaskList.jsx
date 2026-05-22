import { useState, useEffect, useCallback } from 'react';
import { Button, Dialog, List, Tag, Toast, SpinLoading } from 'antd-mobile';
import { cancelTask, getTaskList, getTaskStats } from '../utils/api';
import UserNav from '../components/UserNav';

const STATUS_MAP = {
  pending: { label: '队列中', color: 'default' },
  processing: { label: '执行中', color: 'warning' },
  bidding: { label: '已出价', color: 'primary' },
  success: { label: '成功', color: 'success' },
  failed: { label: '出价失败', color: 'danger' },
  cancelled: { label: '已终止', color: 'default' }
};

const STRATEGY_LABELS = {
  direct: '即时拍',
  multi_bid: '多次出价',
  '1min': '结束前 1 分钟',
  '2min': '结束前 2 分钟',
  '5min': '结束前 5 分钟',
  '10min': '结束前 10 分钟'
};

function formatJPY(value) {
  return `${Number(value || 0).toLocaleString('ja-JP')}円`;
}

function canCancelTask(task) {
  if (!task || task.strategy === 'direct') return false;
  if (task.status === 'pending') return true;
  return task.status === 'bidding' && task.strategy === 'multi_bid';
}

function getStrategyTextStyle(strategy) {
  if (strategy === 'multi_bid') return { color: '#2563eb', fontWeight: 600 };
  if (/^\d+min$/.test(strategy || '')) return { color: '#7c3aed', fontWeight: 600 };
  return { color: '#4b5563', fontWeight: 600 };
}

export default function TaskList({ limit = 10, embedded = false }) {
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);

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
    window.addEventListener('acting-user-change', fetchTasks);
    const interval = setInterval(fetchTasks, 3000);
    return () => {
      window.removeEventListener('acting-user-change', fetchTasks);
      clearInterval(interval);
    };
  }, [fetchTasks]);

  async function handleCancel(task) {
    const confirmed = await Dialog.confirm({
      title: '终止任务',
      content: '终止后该策略不会再进行后续自动操作，是否确认？',
      confirmText: '终止',
      cancelText: '取消'
    });
    if (!confirmed) return;
    setCancellingId(task.id);
    try {
      await cancelTask(task.id);
      Toast.show({ content: '任务已终止' });
      fetchTasks();
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '终止失败' });
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><SpinLoading /></div>;

  return (
    <>
      {!embedded && (
        <div style={{ padding: 16, paddingBottom: 0 }}>
          <UserNav />
        </div>
      )}
      {stats && (
        <div style={{ margin: '12px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[
            ['总任务', stats.total],
            ['队列中', stats.pending],
            ['执行中', stats.processing],
            ['已出价', stats.bidding],
            ['成功', stats.success],
            ['出价失败', stats.failed],
            ['已终止', stats.cancelled],
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
          const maxPrice = task.user_max_price || task.max_price;
          const cancelable = canCancelTask(task);
          return (
            <List.Item key={task.id}
              extra={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag color={s.color}>{s.label}</Tag>
                  {cancelable && (
                    <Button
                      size="mini"
                      color="danger"
                      fill="outline"
                      loading={cancellingId === task.id}
                      onClick={() => handleCancel(task)}
                    >
                      终止
                    </Button>
                  )}
                </div>
              }
              description={
                <div style={{ fontSize: 12, color: '#666' }}>
                  ID: {auctionId}，策略: <span style={getStrategyTextStyle(task.strategy)}>{strategyLabel}</span>，最高出价：
                  <span style={{ color: '#dc2626', fontWeight: 600 }}>{formatJPY(maxPrice)}</span>
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

