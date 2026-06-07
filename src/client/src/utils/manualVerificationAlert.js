export function buildManualVerificationAlert(userLevel, challenge) {
  if (Number(userLevel || 1) < 3) return { show: false, message: '' };
  if (challenge?.type !== 'pin') return { show: false, message: '' };
  return { show: true, message: '后端有事情要处理！' };
}
