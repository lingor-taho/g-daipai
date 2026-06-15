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
