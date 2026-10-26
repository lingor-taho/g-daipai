import { Dialog } from 'antd-mobile';
import { checkAgentProducts } from './api';
import { getBatchClientContext, isBatchContextCurrent } from './batchSubmit';

export const agentPolicyOptions = [
  { value: 'exclusive', label: '同商品互斥' },
  { value: 'confirm', label: '同商品提醒，能继续拍' },
  { value: 'allow', label: '同商品无提醒，直接拍' }
];

export async function allowAgentSubmission(productIds, context = getBatchClientContext()) {
  if (!productIds.length) return true;
  const { data } = await checkAgentProducts(productIds, context);
  if (!isBatchContextCurrent(context)) return false;
  if (!data.success) throw new Error('代理组策略查询失败，请稍后重试');
  if (!data.conflicts?.length || data.policy === 'allow') return true;
  const products = productIds.length > 1 ? `涉及商品：${data.conflicts.join('、')}` : '';
  if (data.policy === 'exclusive') {
    await Dialog.alert({ content: `代理组内该商品有人提交，请联系代理！${products ? `\n${products}` : ''}`, confirmText: '知道了' });
    return false;
  }
  const confirmed = await Dialog.confirm({ content: `代理组内该商品有人提交，是否继续？${products ? `\n${products}` : ''}`, confirmText: '继续', cancelText: '取消' });
  return confirmed && isBatchContextCurrent(context);
}
