import { useEffect, useRef, useState } from 'react';
import { Button, Popup, TextArea, Toast } from 'antd-mobile';
import batchBid from '../../../shared/batchBid.cjs';
import { createClientRequestId, enqueueBatchTasks, getApiErrorMessage } from '../utils/api';
import { createBatchRequestStore, getBatchClientContext, getBatchScope, isBatchContextCurrent } from '../utils/batchSubmit';
import { colors, outlineButtonStyle, primaryButtonStyle } from '../styles';

const { MAX_BATCH_BID_ITEMS, parseBatchBidText } = batchBid;

export default function BatchSubmitPopup({ visible, onClose, onSubmitted, bidBlocked }) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const stores = useRef(new Map());
  const onSubmittedRef = useRef(onSubmitted);
  onSubmittedRef.current = onSubmitted;

  useEffect(() => {
    const reset = () => {
      generation.current += 1;
      busy.current = false;
      setRunning(false);
      setText('');
      onClose();
    };
    window.addEventListener('acting-user-change', reset);
    return () => {
      generation.current += 1;
      window.removeEventListener('acting-user-change', reset);
    };
  }, [onClose]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('batch-input-visibility', { detail: visible }));
    return () => window.dispatchEvent(new CustomEvent('batch-input-visibility', { detail: false }));
  }, [visible]);

  async function handleSubmit() {
    if (busy.current) return;
    if (bidBlocked) { Toast.show({ content: '出价功能被一时限制，请联系管理员。' }); return; }
    try { parseBatchBidText(text); } catch (error) { Toast.show({ content: error.message }); return; }
    const context = getBatchClientContext();
    const scope = getBatchScope();
    if (!stores.current.has(scope)) stores.current.set(scope, createBatchRequestStore(sessionStorage, scope, createClientRequestId));
    const store = stores.current.get(scope);
    const submittedText = text.trim();
    const requestId = store.get(submittedText);
    const currentGeneration = ++generation.current;
    const shouldStop = () => currentGeneration !== generation.current || !isBatchContextCurrent(context);
    busy.current = true;
    setRunning(true);
    try {
      const response = await enqueueBatchTasks({ text: submittedText, client_request_id: requestId }, context);
      if (!response.data?.success) throw new Error('批量入队结果未确认');
      store.settle(submittedText);
      if (!shouldStop()) {
        setText('');
        onClose();
        onSubmittedRef.current();
        window.dispatchEvent(new Event('batch-tasks-enqueued'));
        Toast.show({ content: `已接收 ${response.data.count} 件，后台正在补全商品并排队出价` });
      }
    } catch (error) {
      if (error.response) store.settle(submittedText);
      if (!shouldStop()) Toast.show({ content: error.response ? getApiErrorMessage(error, '批量入队失败') : '入队结果未确认，请再次提交核对（不会重复入队）' });
    } finally {
      if (currentGeneration === generation.current) { busy.current = false; setRunning(false); }
    }
  }

  return (
    <Popup visible={visible} position="bottom" onMaskClick={() => { if (!running) onClose(); }}
      bodyStyle={{ maxHeight: '90vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', background: colors.card }}>
      <div style={{ padding: '20px 16px', maxWidth: 720, margin: '0 auto', color: colors.text }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>批量添加即时拍任务</div>
        <div style={{ fontSize: 13, color: colors.muted, lineHeight: 1.7, marginBottom: 12 }}>
          每行输入商品 ID 或链接和税前日元最高价，以空格、Tab、逗号或分号分隔。每批最多 {MAX_BATCH_BID_ITEMS} 件。<br />
          有税商品另计税，例如最高价 11800 円，含税金额为 12980 円。仅支持即时拍，不支持仅即决商品。<br />
          当前价不足 1000 円且最高价超过 10000 円时，沿用两步出价规则：先出 9000 円，价格突破 1000 円后再按原最高价出价。
          <br />提交后关闭窗口，每件商品补全后立即排队出价；仅有提交失败时显示提示。刷新或关闭页面不影响已接收任务。
        </div>
        <label htmlFor="batch-bid-input" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>批量商品和最高价</label>
        <div style={{ border: '1px solid var(--client-border-strong)', borderRadius: 10, padding: 12 }}>
          <TextArea id="batch-bid-input" value={text} onChange={setText} disabled={running}
            placeholder={'d1246248584 11800\nd1246180991,5800\nhttps://auctions.yahoo.co.jp/jp/auction/e1246602869 21980'}
            rows={8} style={{ '--font-size': '15px' }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <Button style={{ ...outlineButtonStyle, flex: 1 }} disabled={running} onClick={onClose}>关闭</Button>
          <Button color="primary" style={{ ...primaryButtonStyle, flex: 2 }} loading={running} disabled={running || !text.trim()} onClick={handleSubmit}>
            {running ? '正在入队' : '提交批量任务'}
          </Button>
        </div>
      </div>
    </Popup>
  );
}
