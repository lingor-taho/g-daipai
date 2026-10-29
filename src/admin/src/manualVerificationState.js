function getManualVerificationDisplayState(challenge, options = {}) {
  const submittedChallengeId = String(options.submittedChallengeId || '');
  const passedChallengeType = String(options.passedChallengeType || '');

  if (!challenge) {
    if (passedChallengeType === 'captcha') {
      return {
        visible: true,
        status: 'passed',
        showInput: false,
        title: '验证通过！'
      };
    }
    return {
      visible: false,
      status: 'none',
      showInput: false,
      title: ''
    };
  }

  const answered = Boolean(challenge.answeredAt) || (submittedChallengeId && submittedChallengeId === challenge.id);
  if (answered) {
    return {
      visible: true,
      status: 'confirming',
      showInput: false,
      title: '服务器确认中'
    };
  }

  const isPin = challenge.type === 'pin';
  if (challenge.type === 'login') {
    return { visible: true, status: challenge.phase === 'error' ? 'error' : 'confirming',
      showInput: false, showContinue: false, title: challenge.message || '正在选择 Yahoo 登录方式' };
  }
  if (challenge.type === 'email') {
    return {
      visible: true,
      status: challenge.phase === 'error' ? 'error' : 'continue',
      showInput: false,
      showContinue: challenge.message !== '邮箱跳第三次验证，请人工处理！',
      continueLabel: challenge.message === '第二次邮箱验证' ? '第二次邮箱验证 继续' : '继续',
      title: challenge.message || '需要邮箱验证码。'
    };
  }
  return {
    visible: true,
    status: 'input',
    showInput: true,
    title: isPin ? 'Yahoo 需要 PIN 码验证，请输入 PIN 后继续任务' : 'Yahoo 需要文字验证码，请人工输入后继续任务'
  };
}

module.exports = {
  getManualVerificationDisplayState
};
