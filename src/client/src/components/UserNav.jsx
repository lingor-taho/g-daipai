import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Button, Picker, Toast } from 'antd-mobile';
import { getActingUsers } from '../utils/api';
import { runDeduped } from '../utils/requestDedupe';

const items = [
  { to: '/submit', label: '提交任务' },
  { to: '/bidding', label: '入札中' },
  { to: '/won', label: '落札商品' },
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
  }, []);

  const selectedUser = users.find(user => String(user.id) === String(selectedId));
  const showSwitcher = users.length > 1 || Number(selectedUser?.user_level || localStorage.getItem('userLevel') || 1) >= 3;
  const pickerColumns = [
    users.map(user => ({
      label: `${user.username}（${levelLabels[user.user_level] || '用户'}）`,
      value: String(user.id)
    }))
  ];

  function selectUser(nextId) {
    const user = users.find(item => String(item.id) === String(nextId));
    if (!user) return;
    saveActingUser(user);
    setSelectedId(String(user.id));
    emitActingUserChange(user);
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

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 14, color: '#666' }}>
          登录用户：<span style={{ fontWeight: 700, color: '#333' }}>{localStorage.getItem('username') || '-'}</span>
        </div>
        <Button size="mini" fill="outline" onClick={logout}>退出</Button>
      </div>

      {showSwitcher && (
        <div
          onClick={() => setPickerVisible(true)}
          style={{
            marginBottom: 10,
            padding: '10px 12px',
            borderRadius: 8,
            background: '#fff',
            border: '1px solid #e5e7eb',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 14
          }}
        >
          <span style={{ color: '#666' }}>当前账号</span>
          <span style={{ fontWeight: 700, color: '#1677ff' }}>{selectedUser?.username || localStorage.getItem('actingUsername') || '-'}</span>
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
              color: isActive ? '#fff' : '#333',
              background: isActive ? '#1677ff' : '#fff',
              border: `1px solid ${isActive ? '#1677ff' : '#eee'}`
            })}
          >
            {item.label}
          </NavLink>
        ))}
      </div>

      <Picker
        columns={pickerColumns}
        visible={pickerVisible}
        value={[selectedId]}
        onClose={() => setPickerVisible(false)}
        onConfirm={value => selectUser(value[0])}
      />
    </>
  );
}
