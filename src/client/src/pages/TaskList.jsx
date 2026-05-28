import { useState, useEffect, useCallback } from 'react';
import { Button, Dialog, List, Tag, Toast, SpinLoading } from 'antd-mobile';
import { cancelTask, getApiErrorMessage, getTaskList, getTaskStats } from '../utils/api';
import UserNav from '../components/UserNav';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { formatBeijingDateTime } from '../utils/datetime';
import { getTaskFailureLabel } from '../utils/taskFailureReason';
import { getTaskStatCards } from '../utils/taskStats';

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchTasks = useCallback(() => {
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    Promise.all([
      runDeduped(`TaskList:getTaskList:${limit}:${page}`, () => getTaskList({ limit, page })),
      runDeduped('TaskList:getTaskStats', () => getTaskStats()).catch(() => ({ data: null }))
    ])
      .then(([taskRes, statsRes]) => {
        setTasks(taskRes.data.data || []);
        setTotal(Number(taskRes.data.total || 0));
        setStats(statsRes.data || null);
      })
      .catch(() => {
        setTasks([]);
        setStats(null);
      })
      .finally(() => setLoading(false));
  }, [limit, page]);

  useEffect(() => {
    fetchTasks();
    window.addEventListener('acting-user-change', fetchTasks);
    window.addEventListener(USER_ACTIVE_EVENT, fetchTasks);
    document.addEventListener('visibilitychange', fetchTasks);
    window.addEventListener('focus', fetchTasks);
    const interval = setInterval(fetchTasks, 10000);
    return () => {
      window.removeEventListener('acting-user-change', fetchTasks);
      window.removeEventListener(USER_ACTIVE_EVENT, fetchTasks);
      document.removeEventListener('visibilitychange', fetchTasks);
      window.removeEventListener('focus', fetchTasks);
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
      Toast.show({ content: getApiErrorMessage(e, '终止失败') });
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
          {getTaskStatCards(stats).map(({ label, value }) => (
            <div key={label} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <List header="任务列表" style={{ marginTop: embedded ? 12 : 8 }}>
        {tasks.length === 0 && <List.Item>暂无任务</List.Item>}
        {tasks.map(task => {
          const s = STATUS_MAP[task.status] || { label: task.status, color: 'default' };
          const statusLabel = task.status === 'failed' ? getTaskFailureLabel(task.error_msg) : s.label;
          const auctionId = task.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || task.product_id;
          const strategyLabel = STRATEGY_LABELS[task.strategy] || task.strategy || '即时拍';
          const maxPrice = task.user_max_price || task.max_price;
          const cancelable = canCancelTask(task);
          return (
            <List.Item key={task.id}
              extra={
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag color={s.color}>{statusLabel}</Tag>
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
                  {task.created_at ? (
                    <>，提交时间：{formatBeijingDateTime(task.created_at)}</>
                  ) : null}
                </div>
              }
            >
              <div style={{ fontWeight: 500 }}>{task.product_title || ('商品 ' + auctionId)}</div>
            </List.Item>
          );
        })}
      </List>
      {total > limit && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, padding: '12px 0' }}>
          <Button size="mini" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>上一页</Button>
          <span style={{ fontSize: 12, color: '#666' }}>{page} / {Math.ceil(total / limit)}</span>
          <Button size="mini" disabled={page >= Math.ceil(total / limit)} onClick={() => setPage(value => value + 1)}>下一页</Button>
        </div>
      )}
    </>
  );
}

