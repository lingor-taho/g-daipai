import { useState, useEffect, useCallback } from 'react';
import { Button, Dialog, InfiniteScroll, List, Tag, Toast, SpinLoading } from 'antd-mobile';
import { useNavigate } from 'react-router-dom';
import { cancelTask, getApiErrorMessage, getTaskList, getTaskStats } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { formatBeijingDateTime } from '../utils/datetime';
import { getTaskFailureLabel } from '../utils/taskFailureReason';
import { getTaskStatCards } from '../utils/taskStats';
import { getAuctionProductUrl, getRebidSubmitPath } from '../utils/rebid';
import { appendUniqueItems, mergeFirstPageItems } from '../utils/pagedList';
import { cardStyle, colors, itemCardStyle, listStyle } from '../styles';

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
  manual_import: '导入',
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
  if (strategy === 'multi_bid') return { color: colors.accent, fontWeight: 600 };
  if (/^\d+min$/.test(strategy || '')) return { color: '#7c3aed', fontWeight: 600 };
  return { color: '#4b5563', fontWeight: 600 };
}

export default function TaskList({ limit = 10, embedded = false, onRebid }) {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  const fetchFirstPage = useCallback(async ({ preserveLoaded = false } = {}) => {
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    if (!preserveLoaded) setLoading(true);
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const [taskRes, statsRes] = await Promise.all([
        runDeduped(`TaskList:getTaskList:${actingUserKey}:${limit}:1`, () => getTaskList({ limit, page: 1 })),
        runDeduped(`TaskList:getTaskStats:${actingUserKey}`, () => getTaskStats()).catch(() => ({ data: null }))
      ]);
      if ((localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      const firstPageItems = taskRes.data.data || [];
      setTasks(current => preserveLoaded
        ? mergeFirstPageItems(current, firstPageItems)
        : firstPageItems);
      setTotal(Number(taskRes.data.total || 0));
      setStats(statsRes.data || null);
      if (!preserveLoaded) setPage(1);
    } catch (_) {
      if (!preserveLoaded) {
        setTasks([]);
        setStats(null);
        setTotal(0);
        setPage(0);
      }
    } finally {
      setLoading(false);
    }
  }, [limit]);

  const resetTasks = useCallback(() => fetchFirstPage(), [fetchFirstPage]);
  const refreshFirstPage = useCallback(() => fetchFirstPage({ preserveLoaded: true }), [fetchFirstPage]);

  const loadMore = useCallback(async () => {
    const nextPage = page + 1;
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const taskRes = await getTaskList({ limit, page: nextPage });
      if ((localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      setTasks(current => appendUniqueItems(current, taskRes.data?.data || []));
      setTotal(Number(taskRes.data?.total || 0));
      setPage(Number(taskRes.data?.page || nextPage));
    } catch (error) {
      Toast.show({ content: getApiErrorMessage(error, '任务加载失败') });
      throw error;
    }
  }, [limit, page]);

  useEffect(() => {
    resetTasks();
    const handleActingUserChange = () => {
      setTasks([]);
      setTotal(0);
      setPage(0);
      resetTasks();
    };
    window.addEventListener('acting-user-change', handleActingUserChange);
    window.addEventListener(USER_ACTIVE_EVENT, refreshFirstPage);
    document.addEventListener('visibilitychange', refreshFirstPage);
    window.addEventListener('focus', refreshFirstPage);
    const interval = setInterval(refreshFirstPage, 10000);
    return () => {
      window.removeEventListener('acting-user-change', handleActingUserChange);
      window.removeEventListener(USER_ACTIVE_EVENT, refreshFirstPage);
      document.removeEventListener('visibilitychange', refreshFirstPage);
      window.removeEventListener('focus', refreshFirstPage);
      clearInterval(interval);
    };
  }, [refreshFirstPage, resetTasks]);

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
      setTasks(current => current.map(item => item.id === task.id
        ? { ...item, status: 'cancelled', error_msg: null }
        : item));
      refreshFirstPage();
    } catch (e) {
      Toast.show({ content: getApiErrorMessage(e, '终止失败') });
    } finally {
      setCancellingId(null);
    }
  }

  function handleRebid(task) {
    const productUrl = getAuctionProductUrl(task);
    if (!productUrl) {
      Toast.show({ content: '该任务缺少商品ID' });
      return;
    }
    if (onRebid) {
      onRebid(productUrl);
      return;
    }
    navigate(getRebidSubmitPath(task));
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><SpinLoading /></div>;

  return (
    <>
      {stats && (
        <div style={{ margin: '12px 0', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {getTaskStatCards(stats).map(({ label, value }) => (
            <div key={label} style={{ ...cardStyle, padding: 10, background: colors.card }}>
              <div style={{ fontSize: 12, color: colors.muted }}>{label}</div>
              <div style={{ fontSize: 19, fontWeight: 600, marginTop: 4, color: colors.text }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <List
        header={<div style={{ borderBottom: '1px solid #eee', paddingBottom: 10 }}>任务列表</div>}
        style={{ ...listStyle, marginTop: embedded ? 12 : 8 }}
      >
        {tasks.length === 0 && <List.Item>暂无任务</List.Item>}
        {tasks.map(task => {
          const s = STATUS_MAP[task.status] || { label: task.status, color: 'default' };
          const statusLabel = task.status === 'failed' ? getTaskFailureLabel(task.error_msg) : s.label;
          const auctionId = task.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || task.product_id;
          const strategyLabel = STRATEGY_LABELS[task.strategy] || task.strategy || '即时拍';
          const maxPrice = task.user_max_price || task.max_price;
          const cancelable = canCancelTask(task);
          return (
            <div key={task.id}>
              <List.Item
                style={itemCardStyle}
                extra={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color={s.color}>{statusLabel}</Tag>
                    {cancelable && (
                      <Button
                        size="mini"
                        color="danger"
                        fill="outline"
                        loading={cancellingId === task.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleCancel(task);
                        }}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        终止
                      </Button>
                    )}
                  </div>
                }
                description={
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.65 }}>
                    ID: <span
                      onDoubleClick={() => handleRebid(task)}
                      style={{ cursor: 'pointer' }}
                    >
                      {auctionId}
                    </span>，策略: <span style={getStrategyTextStyle(task.strategy)}>{strategyLabel}</span>，最高出价：
                    <span style={{ color: colors.danger, fontWeight: 600 }}>{formatJPY(maxPrice)}</span>
                    {task.created_at ? (
                      <>，提交时间：{formatBeijingDateTime(task.created_at)}</>
                    ) : null}
                  </div>
                }
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, lineHeight: 1.35 }}>{task.product_title || ('商品 ' + auctionId)}</div>
              </List.Item>
            </div>
          );
        })}
      </List>
      {!loading && tasks.length > 0 ? (
        <InfiniteScroll loadMore={loadMore} hasMore={tasks.length < total} />
      ) : null}
    </>
  );
}
