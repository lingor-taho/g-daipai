import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Space, Typography, message } from 'antd';
import { fetchAdminJson } from './utils/auth';
import { getManualVerificationDisplayState } from './manualVerificationState';

export default function ManualVerificationAlert({ accountId, accountTitle = '', challenge }: {
  accountId?: number; accountTitle?: string; challenge: any;
}) {
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [submitted, setSubmitted] = useState({ id: '', type: '' });
  const [passedType, setPassedType] = useState('');
  const [closedId, setClosedId] = useState('');
  const submittedRef = useRef(submitted);
  const passedTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setAnswer('');
    if (challenge) {
      setPassedType('');
      if (challenge.id !== submittedRef.current.id) {
        submittedRef.current = { id: '', type: '' };
        setSubmitted(submittedRef.current);
      }
    } else {
      if (submittedRef.current.type === 'captcha') {
        setPassedType('captcha');
        window.clearTimeout(passedTimer.current);
        passedTimer.current = window.setTimeout(() => setPassedType(''), 1800);
      }
      submittedRef.current = { id: '', type: '' };
      setSubmitted(submittedRef.current);
      setClosedId('');
    }
  }, [challenge?.id]);
  useEffect(() => () => window.clearTimeout(passedTimer.current), []);
  const view = getManualVerificationDisplayState(challenge, {
    submittedChallengeId: submitted.id, passedChallengeType: passedType
  });
  const isPin = challenge?.type === 'pin';
  async function act(action: 'answer' | 'continue' | 'close') {
    if (!challenge?.id || busyRef.current) return;
    const value = answer.trim();
    if (action === 'answer' && !value) {
      message.warning(isPin ? '请输入 PIN 码' : '请输入验证码文字');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const id = challenge.id;
    try {
      await fetchAdminJson(`/api/admin/manual-captcha/${action}${accountId ? `?account_id=${accountId}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...(accountId ? { account_id: accountId } : {}), ...(action === 'answer' ? { answer: value } : {}) })
      });
      setAnswer('');
      if (action === 'close') {
        setClosedId(id);
        submittedRef.current = { id: '', type: '' };
        setSubmitted(submittedRef.current);
        setPassedType('');
      } else {
        submittedRef.current = { id, type: challenge.type || 'captcha' };
        setSubmitted(submittedRef.current);
        if (action === 'answer') message.success('已提交，插件会继续当前任务');
      }
    } catch (e: any) {
      message.error(e.message || '提交验证信息失败');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  if (!view.visible || (challenge?.id && challenge.id === closedId)) return null;
  return <Alert
    data-manual-verification-account={accountId || 'primary'}
    type={view.status === 'passed' ? 'success' : view.status === 'error' ? 'error' : 'warning'}
    showIcon style={{ marginBottom: 12 }}
    message={<Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Typography.Text strong>{accountTitle ? `${accountTitle}：` : ''}{view.title}</Typography.Text>
      {view.showContinue ? <Button type="primary" size="small" loading={busy} onClick={() => act('continue')}>继续</Button> : null}
      {challenge ? <Space wrap align="start">
        {!isPin && view.showInput && challenge.imageDataUrl ? <img src={challenge.imageDataUrl} alt="Yahoo 验证码"
          style={{ maxWidth: 360, width: '100%', border: '1px solid #d9d9d9', background: '#fff' }} /> : null}
        <Space direction="vertical">
          <Typography.Text type="secondary">{challenge.productId ? `商品ID：${challenge.productId}` : 'Yahoo 验证页面'}</Typography.Text>
          {view.showInput && challenge.message ? <Typography.Text type="danger">{challenge.message}</Typography.Text> : null}
          {view.showInput ? <>
            <Input value={answer} onChange={event => setAnswer(event.target.value)}
              onPressEnter={event => { if (!event.nativeEvent.isComposing) act('answer'); }}
              placeholder={isPin ? '输入 PIN 码' : '输入图中日文'} style={{ width: 220 }} disabled={busy} />
            <Button type="primary" loading={busy} onClick={() => act('answer')}>{isPin ? '提交 PIN' : '提交验证码'}</Button>
          </> : null}
          <Button disabled={busy} onClick={() => act('close')}>关闭提醒</Button>
        </Space>
      </Space> : null}
    </Space>}
  />;
}
