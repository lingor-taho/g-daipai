export function getTaskFailureLabel(errorMsg) {
  const text = String(errorMsg || '');

  if (
    /Current price is above max price before execution/i.test(text) ||
    /当前价格|税込合計金額|出价金额|加价后金额|高于最高价|above max price/i.test(text) ||
    /褰撳墠浠锋牸|绋庤炯鍚堣▓閲戦|鍑轰环閲戦|鍔犱环鍚庨噾棰|楂樹簬鏈€楂樹环|楂樹簬鏈€楂/i.test(text)
  ) {
    return '失败：低于当前价';
  }

  if (
    /Auction ended before plugin execution|商品.*结束|商品.*已经结束|商品.*已结束|ended before/i.test(text) ||
    /鍟嗗搧.*缁撴潫|鍟嗗搧.*宸茬粡缁撴潫|鍟嗗搧.*宸茬粨鏉/i.test(text)
  ) {
    return '失败：商品已结束';
  }

  if (
    /outbid after bid|再入札|最高价未超过当前最高出价/i.test(text) ||
    /鍐嶅叆鏈|鏈€楂樹环鏈秴杩囧綋鍓嶆渶楂樺嚭浠/i.test(text)
  ) {
    return '失败：出价后被超过';
  }

  if (/timeout|timed out|超时|加载超时|响应超时|networkidle|瓒呮椂/i.test(text)) {
    return '失败：响应超时';
  }

  if (/需要登录 Yahoo|Yahoo.*登录|login.*Yahoo|Yahoo.*login|闇€瑕佺櫥褰.*Yahoo/i.test(text)) {
    return '失败：yahoo登录失败';
  }

  return '失败：系统原因';
}
