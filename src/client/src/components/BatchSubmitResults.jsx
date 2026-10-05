import { useEffect, useState } from 'react';
import { Button, Popup } from 'antd-mobile';
import { dismissBatchTaskResult, getBatchTaskResults } from '../utils/api';
import { createBatchResultPoller, getBatchClientContext, getBatchScope, isBatchContextCurrent } from '../utils/batchSubmit';
import { colors, primaryButtonStyle } from '../styles';

export default function BatchSubmitResults() {
  const [version, setVersion] = useState(0);
  const [results, setResults] = useState([]);
  const [inputVisible, setInputVisible] = useState(false);
  const [closeResult, setCloseResult] = useState(() => () => {});

  useEffect(() => {
    const reset = () => { setResults([]); setInputVisible(false); setVersion(value => value + 1); };
    const input = event => setInputVisible(Boolean(event.detail));
    window.addEventListener('acting-user-change', reset);
    window.addEventListener('batch-input-visibility', input);
    return () => {
      window.removeEventListener('acting-user-change', reset);
      window.removeEventListener('batch-input-visibility', input);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const context = getBatchClientContext();
    const storageKey = `batchBidDismissPending:v1:${getBatchScope()}`;
    let stored;
    try { stored = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); } catch (_) { stored = []; }
    const pending = new Set(Array.isArray(stored) ? stored.filter(Number.isSafeInteger) : []);
    const closed = new Set(pending);
    const observed = new Set();
    const current = () => active && isBatchContextCurrent(context);
    const persist = () => { try { sessionStorage.setItem(storageKey, JSON.stringify([...pending])); } catch (_) {} };
    const dismiss = async id => {
      try { await dismissBatchTaskResult(id, context); pending.delete(id); persist(); } catch (_) {}
    };
    setCloseResult(() => id => {
      closed.add(id); pending.add(id); persist();
      setResults(items => items.filter(item => item.id !== id));
      dismiss(id);
    });
    const poll = createBatchResultPoller({
      isCurrent: current,
      fetchResults: async () => {
        for (const id of [...pending]) await dismiss(id);
        return getBatchTaskResults(context);
      },
      onResults: items => {
        const available = items.filter(item => !closed.has(item.id) && item.submit_failed_count > 0)
          .map(item => ({ ...item, items: item.items.filter(row => row.status === 'submit_failed') }));
        if (available.some(item => !observed.has(item.id))) window.dispatchEvent(new Event('batch-tasks-updated'));
        available.forEach(item => observed.add(item.id));
        setResults(available);
      }
    });
    const load = () => { if (document.visibilityState !== 'hidden' && current()) poll(); };
    load();
    const timer = window.setInterval(load, 5000);
    window.addEventListener('batch-tasks-enqueued', load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', load);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('batch-tasks-enqueued', load);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', load);
    };
  }, [version]);

  const result = results[0];
  const close = () => { if (result) closeResult(result.id); };
  return (
    <Popup visible={Boolean(result) && !inputVisible} position="bottom" onMaskClick={close}
      bodyStyle={{ maxHeight: '85vh', overflow: 'hidden', borderRadius: '16px 16px 0 0', background: colors.card }}>
      {result && <div style={{ padding: '20px 16px', maxWidth: 720, maxHeight: '85vh', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', margin: '0 auto', color: colors.text }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>批量任务提交结果</div>
        <div style={{ fontSize: 14, lineHeight: 1.8, marginTop: 12 }}>
          共 {result.total} 件：提交成功 {result.submit_success_count ?? result.total - result.submit_failed_count} 件，提交失败 {result.submit_failed_count} 件
        </div>
        <div style={{ overflowY: 'auto', minHeight: 0, marginTop: 8 }}>
        {result.items.map(item => {
          return <div key={item.line} style={{ borderBottom: '1px solid var(--client-border)', padding: '12px 0', fontSize: 13, overflowWrap: 'anywhere' }}>
            <div>第 {item.line} 行：{item.product_id || item.text}{item.max_price ? ` · 最高价 ${item.max_price} 円` : ''}</div>
            <div style={{ color: colors.danger, marginTop: 4 }}>提交失败：{item.error}</div>
          </div>;
        })}
        </div>
        <Button block color="primary" style={{ ...primaryButtonStyle, marginTop: 16, flexShrink: 0 }} onClick={close}>关闭</Button>
      </div>}
    </Popup>
  );
}
