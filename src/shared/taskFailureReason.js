export function getTaskFailureLabel(errorMsg) {
  const text = String(errorMsg || '');

  if (/Yahoo bid failed|Yahoo system error page|Yahoo error page|Yahoo.*access failure/i.test(text)) {
    return '失败：Yahoo页面错误';
  }

  if (
    /Current price is above max price before execution/i.test(text) ||
    /当前价格|税込合計金額|出价金额|加价后金额|高于最高价|above max price/i.test(text) ||
    /\u8930\u64b3\u58a0\u6d60\u950b\u7278|\u7ecb\u5ea4\u70af\u935a\u5823\u2593\u95b2\u6226\ue512|\u9351\u8f70\u73af\u95b2\u6226\ue582|\u9354\u72b1\u73af\u935a\u5ea8\u567e\u68f0|\u6942\u6a39\u7c2c\u93c8\u20ac\u6942\u6a39\u73af|\u6942\u6a39\u7c2c\u93c8\u20ac\u6942/i.test(text)
  ) {
    return '失败：低于当前价';
  }

  if (
    /Auction ended before plugin execution|Auction ended according to product page snapshot|商品.*结束|商品.*已经结束|商品.*已结束|ended before/i.test(text) ||
    /\u935f\u55d7\u6427.*\u7f01\u64b4\u6f6b|\u935f\u55d7\u6427.*\u5bb8\u832c\u7ca1\u7f01\u64b4\u6f6b|\u935f\u55d7\u6427.*\u5bb8\u832c\u7ca8\u93c9/i.test(text)
  ) {
    return '失败：商品已结束';
  }

  if (
    /outbid after bid|Rebid required|current bid is not high enough|再入札|最高价未超过当前最高出价/i.test(text) ||
    /\u9350\u5d85\u53c6\u93c8|\u93c8\u20ac\u6942\u6a39\u73af\u93c8\ue047\u79f4\u6769\u56e7\u7d8b\u9353\u5d86\u6e36\u6942\u6a3a\u56ad\u6d60/i.test(text)
  ) {
    return '失败：出价后被超过';
  }

  if (/Task execution timeout after|timeout|timed out|超时|加载超时|响应超时|networkidle|30.*tab|\?\?\?30\?\?\?\?\?\?|\u74d2\u546e\u6902/i.test(text)) {
    return '失败：响应超时';
  }

  if (/需要登录 Yahoo|Yahoo.*登录|login.*Yahoo|Yahoo.*login|\u95c7\u20ac\u7455\u4f7a\u6ae5\u8930.*Yahoo/i.test(text)) {
    return '失败：yahoo登录失败';
  }

  if (/Server tab error|No tab with id|Tabs cannot be edited right now|user may be dragging a tab/i.test(text)) {
    return '失败：服务器tab异常';
  }

  return '失败：系统原因';
}
