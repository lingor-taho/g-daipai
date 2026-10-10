import { useState } from 'react';
import { Popover } from 'antd';
import { DownOutlined } from '@ant-design/icons';

export default function YahooAccountStatusLights({ accounts, inHeader = false }: { accounts: any[]; inHeader?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  // The API orders backups by priority; always keep the primary first.
  const ordered = [...accounts].sort((a, b) => Number(b.is_primary || 0) - Number(a.is_primary || 0));
  if (!ordered.length) return null;

  function renderLight(account: any) {
    const loggedIn = account.online && account.yahooLogin?.status === 'ok';
    const status = !account.online ? '插件离线' : loggedIn ? '正常登录中' : account.yahooLogin?.status === 'failed' ? '未登录' : '登录待确认';
    const label = `${account.account_name}（${account.yahoo_id || `ID ${account.account_id}`}）：${status}`;
    return <Popover key={account.account_id} content={label} trigger={['hover', 'click']} placement="bottom">
      <button type="button" className="yahoo-status-light" data-yahoo-status-id={account.account_id}
        data-status={loggedIn ? 'green' : 'red'} aria-label={label}>
        <span className={`yahoo-status-dot ${loggedIn ? 'yahoo-status-dot-green' : 'yahoo-status-dot-red'}`} aria-hidden="true" />
      </button>
    </Popover>;
  }

  return <div className={`yahoo-status-lights${inHeader ? ' yahoo-status-lights-header' : ''}`} data-yahoo-status-lights>
    <div className="yahoo-status-lights-row">
      <div className="yahoo-status-lights-grid">{ordered.slice(0, 4).map(renderLight)}</div>
      {ordered.length > 4 && <button type="button" className="yahoo-status-expand"
        aria-label={expanded ? '收起其他账号状态' : '展开其他账号状态'} aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}>
        <DownOutlined rotate={expanded ? 180 : 0} />
      </button>}
    </div>
    {ordered.length > 4 && expanded && <div className="yahoo-status-lights-extra">
      <div className="yahoo-status-lights-grid">{ordered.slice(4).map(renderLight)}</div>
    </div>}
  </div>;
}
