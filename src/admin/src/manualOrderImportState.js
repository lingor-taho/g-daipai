function getManualOrderImportCandidateCount(batch) {
  return Number(batch?.candidate_count || 0);
}

function getManualOrderImportStatusView(batch) {
  const status = String(batch?.status || '').trim();
  const candidateCount = getManualOrderImportCandidateCount(batch);

  if (status === 'requested') {
    return {
      label: '等待插件读取',
      color: 'blue',
      canConfirm: false,
      isCompleteWithoutCandidates: false
    };
  }
  if (status === 'scanning') {
    return {
      label: '插件读取中',
      color: 'gold',
      canConfirm: false,
      isCompleteWithoutCandidates: false
    };
  }
  if (status === 'ready' && candidateCount > 0) {
    return {
      label: '待分配用户',
      color: 'green',
      canConfirm: true,
      isCompleteWithoutCandidates: false
    };
  }
  if (status === 'ready') {
    return {
      label: '读取完成（无新订单）',
      color: 'default',
      canConfirm: false,
      isCompleteWithoutCandidates: true,
      emptyText: '读取完成，没有新的待分配订单'
    };
  }
  if (status === 'confirmed') {
    return {
      label: '已导入',
      color: 'purple',
      canConfirm: false,
      isCompleteWithoutCandidates: false
    };
  }
  if (status === 'failed') {
    return {
      label: '读取失败',
      color: 'red',
      canConfirm: false,
      isCompleteWithoutCandidates: false
    };
  }
  return {
    label: status || '-',
    color: undefined,
    canConfirm: false,
    isCompleteWithoutCandidates: false
  };
}

function shouldAutoRefreshManualOrderImportBatch(batch) {
  const status = String(batch?.status || '').trim();
  return status === 'requested' || status === 'scanning';
}

function formatManualOrderImportFlag(flags) {
  return Number(flags?.manualOrderImportFlag || 0) > 0 ? '1' : '0';
}

function shouldEditManualImportShippingFee(shippingFeeText) {
  return /落札者負担|着払い/.test(String(shippingFeeText || ''));
}

module.exports = {
  formatManualOrderImportFlag,
  getManualOrderImportCandidateCount,
  getManualOrderImportStatusView,
  shouldEditManualImportShippingFee,
  shouldAutoRefreshManualOrderImportBatch
};
