import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button, List, Popup, SearchBar, Toast } from 'antd-mobile';
import { getActingUsers, getClientSiteConfig, getAgentProductPolicy, saveAgentProductPolicy } from '../utils/api';
import { agentPolicyOptions } from '../utils/agentProductPolicy';
import { getBatchClientContext, isBatchContextCurrent } from '../utils/batchSubmit';
import { runDeduped } from '../utils/requestDedupe';
import { applyClientTheme, colors, getClientTheme, themeOptions } from '../styles';

const items = [
  { to: '/submit', label: '提交任务' },
  { to: '/bidding', label: '入札中' },
  { to: '/won', label: '成交商品' },
  { to: '/stats', label: '统计页面' }
];

const levelLabels = {
  1: '普通用户',
  2: '代理用户',
  3: '管理员'
};

function emitActingUserChange(user) {
  window.dispatchEvent(new CustomEvent('acting-user-change', { detail: user }));
}

function saveActingUser(user) {
  localStorage.setItem('actingUserId', String(user.id));
  localStorage.setItem('actingUsername', user.username);
  localStorage.setItem('actingUserBidStrategyScope', user.bid_strategy_scope || 'all');
}

export default function UserNav() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [selectedId, setSelectedId] = useState(localStorage.getItem('actingUserId') || '');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [siteConfig, setSiteConfig] = useState({ noticeText: '', noticeMarquee: false });
  const [themeName, setThemeName] = useState(getClientTheme());
  const [policySettings, setPolicySettings] = useState(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyAnchor, setPolicyAnchor] = useState({ left: 20, top: 0 });
  const policyGeneration = useRef(0);

  useEffect(() => {
    const generation = ++policyGeneration.current;
    setPolicyOpen(false);
    setPolicySettings(null);
    setPolicySaving(false);
    if (!users.length) return;
    const context = getBatchClientContext();
    getAgentProductPolicy(context).then(res => {
      if (generation === policyGeneration.current && isBatchContextCurrent(context)) setPolicySettings(res.data);
    }).catch(() => {});
    return () => { policyGeneration.current += 1; };
  }, [selectedId, users.length]);

  async function changePolicy(policy) {
    if (policySaving || policy === policySettings?.policy) return;
    const generation = policyGeneration.current;
    const context = getBatchClientContext();
    setPolicySaving(true);
    try {
      await saveAgentProductPolicy(policy, context);
      if (generation !== policyGeneration.current || !isBatchContextCurrent(context)) return;
      setPolicySettings(current => ({ ...current, policy }));
      Toast.show({ content: '代理组策略已保存' });
    } catch (error) {
      if (generation === policyGeneration.current && isBatchContextCurrent(context)) Toast.show({ content: error.response?.data?.error || '策略保存失败，请重试' });
    } finally { if (generation === policyGeneration.current) setPolicySaving(false); }
  }

  async function loadActingUsers() {
    try {
      const res = await runDeduped('UserNav:getActingUsers', getActingUsers);
      const list = res.data?.data || [];
      setUsers(list);
      if (!list.length) return;

      const savedId = localStorage.getItem('actingUserId');
      const selected = list.find(user => String(user.id) === String(savedId)) || list[0];
      saveActingUser(selected);
      setSelectedId(String(selected.id));
      emitActingUserChange(selected);
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '账号列表加载失败' });
    }
  }

  useEffect(() => {
    loadActingUsers();
    getClientSiteConfig()
      .then(res => {
        setSiteConfig({
          noticeText: res.data?.noticeText || '',
          noticeMarquee: Boolean(res.data?.noticeMarquee)
        });
      })
      .catch(() => {});
  }, []);

  const selectedUser = users.find(user => String(user.id) === String(selectedId));
  const showSwitcher = users.length > 1 || Number(selectedUser?.user_level || localStorage.getItem('userLevel') || 1) >= 3;
  const normalizedKeyword = searchKeyword.trim().toLowerCase();
  const filteredUsers = normalizedKeyword
    ? users.filter(user => {
      const label = `${user.username || ''} ${levelLabels[user.user_level] || ''}`.toLowerCase();
      return label.includes(normalizedKeyword);
    })
    : users;

  function selectUser(nextId) {
    const user = users.find(item => String(item.id) === String(nextId));
    if (!user || String(user.id) === String(selectedId)) return;
    policyGeneration.current += 1;
    setPolicyOpen(false);
    setPolicySettings(null);
    saveActingUser(user);
    setSelectedId(String(user.id));
    emitActingUserChange(user);
  }

  function closeUserPicker() {
    setPickerVisible(false);
    setSearchKeyword('');
  }

  function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('username');
    localStorage.removeItem('userLevel');
    localStorage.removeItem('actingUserId');
    localStorage.removeItem('actingUsername');
    localStorage.removeItem('actingUserBidStrategyScope');
    navigate('/login', { replace: true });
  }

  function changeTheme(nextTheme) {
    const applied = applyClientTheme(nextTheme);
    setThemeName(applied);
  }

  return (
    <>
      <style>
        {`
          @keyframes clientNoticeMarquee {
            0% { transform: translateX(100%); }
            100% { transform: translateX(-100%); }
          }
        `}
      </style>

      <div
        style={{
          margin: '-20px -20px 14px',
          padding: siteConfig.noticeText ? '16px 20px 14px' : '10px 20px 0',
          background: colors.card,
          borderBottom: `1px solid ${colors.border}`,
          boxShadow: `0 6px 18px ${colors.shadow}`
        }}
      >
        {siteConfig.noticeText && (
          <div
            style={{
              border: `1px solid ${colors.border}`,
              background: colors.noticeBg,
              color: colors.accent,
              borderRadius: 8,
              minHeight: 38,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              boxShadow: `0 3px 10px ${colors.shadow}`
            }}
          >
            <div style={{ width: '100%', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 600, textAlign: 'center' }}>
              <span
                style={{
                  display: 'inline-block',
                  padding: '0 16px',
                  animation: siteConfig.noticeMarquee ? 'clientNoticeMarquee 14s linear infinite' : 'none'
                }}
              >
                {siteConfig.noticeText}
              </span>
            </div>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          padding: '0 2px',
          gap: 10,
          whiteSpace: 'nowrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', minWidth: 0, fontSize: 14, color: colors.muted }}>
            <span style={{ flexShrink: 0 }}>登录用户：</span>
            <span title={localStorage.getItem('username') || '-'} style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 700, color: colors.text }}>{localStorage.getItem('username') || '-'}</span>
          </div>
          <Button size="mini" fill="outline" color="primary" style={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={logout}>退出</Button>
          {policySettings?.canConfigure && (
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <button type="button" aria-label="代理组设置" aria-expanded={policyOpen} onClick={async event => {
                if (policyOpen) { setPolicyOpen(false); return; }
                const rect = event.currentTarget.getBoundingClientRect();
                setPolicyAnchor({ left: Math.max(20, Math.min(rect.left, window.innerWidth - 250)), top: rect.bottom + 6 });
                const generation = policyGeneration.current;
                const context = getBatchClientContext();
                try {
                  const res = await getAgentProductPolicy(context);
                  if (generation !== policyGeneration.current || !isBatchContextCurrent(context)) return;
                  setPolicySettings(res.data);
                  setPolicyOpen(Boolean(res.data.canConfigure));
                } catch (_) { Toast.show({ content: '策略加载失败，请重试' }); }
              }} style={{ position: 'relative', zIndex: policyOpen ? 101 : undefined, display: 'flex', alignItems: 'center', border: 0, background: 'transparent', color: colors.accent, padding: 3, cursor: 'pointer' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.5 1.7 1.7v2.4l-1.7 1.7 2 3.5 2.3-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.5-1.7-1.7v-2.4l1.7-1.7-2-3.5-2.3.7-2-.9L13 3Z"/><circle cx="11" cy="12" r="3"/></svg>
              </button>
              {policyOpen && <>
                <div onClick={() => setPolicyOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
                <div role="radiogroup" aria-label="代理组同商品策略" style={{ position: 'fixed', ...policyAnchor, zIndex: 100, width: 230, boxSizing: 'border-box', maxWidth: 'calc(100vw - 40px)', padding: 10, border: `1px solid ${colors.border}`, borderRadius: 8, background: colors.card, boxShadow: `0 4px 16px ${colors.shadow}` }}>
                  {agentPolicyOptions.map(option => <label key={option.value} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', fontSize: 13, color: colors.text }}>
                    <input type="radio" name="agent-product-policy" value={option.value} checked={policySettings.policy === option.value} disabled={policySaving} onChange={() => changePolicy(option.value)} />{option.label}
                  </label>)}
                </div>
              </>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: colors.muted }}>
            <span>风格</span>
            <select
              value={themeName}
              onChange={event => changeTheme(event.target.value)}
              style={{
                height: 28,
                minWidth: 82,
                border: `1px solid ${colors.borderStrong}`,
                borderRadius: 7,
                color: colors.text,
                background: colors.card,
                padding: '0 6px',
                fontSize: 13,
                outline: 'none'
              }}
            >
              {themeOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {showSwitcher && (
        <div
          onClick={() => {
            setSearchKeyword('');
            setPickerVisible(true);
          }}
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: colors.card,
            border: `1px solid ${colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 14,
            boxShadow: `0 3px 12px ${colors.shadow}`
          }}
        >
          <span style={{ color: colors.muted }}>当前账号</span>
          <span style={{ fontWeight: 700, color: colors.accent }}>{selectedUser?.username || localStorage.getItem('actingUsername') || '-'}</span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
        {items.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            style={({ isActive }) => ({
              textAlign: 'center',
              textDecoration: 'none',
              borderRadius: 8,
              padding: '9px 6px',
              fontSize: 14,
              fontWeight: 600,
              color: isActive ? '#fff' : colors.text,
              background: isActive ? colors.accent : colors.card,
              border: `1px solid ${isActive ? colors.accent : colors.border}`,
              boxShadow: isActive ? `0 6px 14px ${colors.buttonShadow}` : `0 3px 10px ${colors.shadow}`
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <Popup
        visible={pickerVisible}
        onMaskClick={closeUserPicker}
        bodyStyle={{
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          maxHeight: '70vh',
          overflow: 'hidden'
        }}
      >
        <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
          <SearchBar
            placeholder="搜索用户"
            value={searchKeyword}
            onChange={setSearchKeyword}
          />
        </div>
        <div style={{ maxHeight: '58vh', overflowY: 'auto' }}>
          {filteredUsers.length ? (
            <List>
              {filteredUsers.map(user => {
                const active = String(user.id) === String(selectedId);
                return (
                  <List.Item
                    key={user.id}
                    clickable
                    extra={active ? '✓' : null}
                    onClick={() => {
                      selectUser(user.id);
                      closeUserPicker();
                    }}
                  >
                    <div style={{ fontWeight: active ? 700 : 500 }}>{user.username}</div>
                    <div style={{ fontSize: 12, color: '#999', marginTop: 3 }}>
                      {levelLabels[user.user_level] || '用户'}
                    </div>
                  </List.Item>
                );
              })}
            </List>
          ) : (
            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>未找到用户</div>
          )}
        </div>
      </Popup>
    </>
  );
}
