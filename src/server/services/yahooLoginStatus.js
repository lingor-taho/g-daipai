function buildYahooLoginStatus(loginStatus, loginMessage) {
  const value = loginStatus?.value || 'unknown';
  return {
    status: value === 'ok' ? 'ok' : value === 'failed' ? 'failed' : 'unknown',
    message: loginMessage?.value || '',
    updatedAt: loginStatus?.updated_at || null
  };
}

function isYahooLoginError(message) {
  return /需要登录\s*Yahoo|Yahoo.*登录|ログイン.*必要|ログインしてください|ログインが必要/i.test(String(message || ''));
}

module.exports = {
  buildYahooLoginStatus,
  isYahooLoginError
};
