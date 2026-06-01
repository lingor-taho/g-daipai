// 在图3页面的浏览器控制台运行这个脚本，诊断按钮查找问题

console.log('=== 诊断开始 ===');

// 1. 查找所有 button 元素
const allButtons = [...document.querySelectorAll('button')];
console.log('页面总共有', allButtons.length, '个 button 元素');

// 2. 查找包含"まとめて取引"的按钮
const bundleButtons = allButtons.filter(btn => {
  const text = btn.textContent || '';
  return /まとめて取引/.test(text);
});
console.log('包含"まとめて取引"的按钮有', bundleButtons.length, '个');

// 3. 详细分析每个按钮
bundleButtons.forEach((btn, index) => {
  console.log(`\n--- 按钮 ${index + 1} ---`);
  console.log('tagName:', btn.tagName);
  console.log('type:', btn.type);
  console.log('disabled:', btn.disabled);
  console.log('textContent:', JSON.stringify(btn.textContent));
  console.log('value:', btn.value);
  console.log('title:', btn.title);
  console.log('aria-label:', btn.getAttribute('aria-label'));
  console.log('class:', btn.className);
  
  // 模拟 getClickableText 函数
  const clickableText = [
    btn.textContent,
    btn.value,
    btn.title,
    btn.getAttribute('aria-label')
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  console.log('getClickableText 结果:', JSON.stringify(clickableText));
  
  // 测试正则匹配
  const strictPattern = /^\s*まとめて取引を(?:はじめる|依頼する)\s*$/;
  const loosePattern = /まとめて取引を(?:はじめる|依頼する)/;
  console.log('严格正则匹配:', strictPattern.test(clickableText));
  console.log('宽松正则匹配:', loosePattern.test(clickableText));
  
  // 检查可见性
  const style = window.getComputedStyle(btn);
  console.log('display:', style.display);
  console.log('visibility:', style.visibility);
  console.log('是否可点击:', style.display !== 'none' && style.visibility !== 'hidden' && !btn.disabled);
  
  console.log('按钮元素:', btn);
});

// 4. 测试实际的 findClickableByText 逻辑
console.log('\n=== 模拟 findClickableByText ===');

function getClickableText(el) {
  return [
    el.textContent,
    el.value,
    el.title,
    el.getAttribute?.('aria-label')
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function resolveClickableElement(el) {
  return el.closest?.('button, a, input[type="button"], input[type="submit"]') || el;
}

function isElementClickable(el) {
  const target = resolveClickableElement(el);
  if (!target || target.disabled) return false;
  const style = window.getComputedStyle ? window.getComputedStyle(target) : null;
  return !(style && (style.display === 'none' || style.visibility === 'hidden'));
}

function isNativeClickableElement(el) {
  return /^(BUTTON|A|INPUT)$/i.test(el?.tagName || '');
}

const pattern = /^\s*まとめて取引を(?:はじめる|依頼する)\s*$/;
const priority = [...document.querySelectorAll('button, a, input[type="button"], input[type="submit"]')];
const broad = [...document.querySelectorAll('*')];

console.log('priority 元素数量:', priority.length);
console.log('broad 元素数量:', broad.length);

const step1 = [...priority, ...broad];
console.log('合并后元素数量:', step1.length);

const step2 = step1.filter(el => {
  const text = getClickableText(el);
  const matches = pattern.test(text);
  if (matches) {
    console.log('找到匹配元素:', el, '文本:', JSON.stringify(text));
  }
  return matches && isElementClickable(el);
});
console.log('通过文本和可见性过滤后:', step2.length, '个元素');

const step3 = step2.filter(el => {
  const target = resolveClickableElement(el);
  const isNative = isNativeClickableElement(target);
  const hasOnclick = typeof target.onclick === 'function';
  const hasRole = target.getAttribute?.('role') === 'button';
  const pass = isNative || hasOnclick || hasRole;
  if (!pass) {
    console.log('被第二个过滤器排除:', el, 'isNative:', isNative, 'hasOnclick:', hasOnclick, 'hasRole:', hasRole);
  }
  return pass;
});
console.log('通过原生/onclick/role过滤后:', step3.length, '个元素');

if (step3.length > 0) {
  console.log('最终找到的按钮:', step3[0]);
} else {
  console.log('❌ 没有找到匹配的按钮！');
}

console.log('\n=== 诊断结束 ===');
