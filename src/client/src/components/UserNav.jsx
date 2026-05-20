import { NavLink } from 'react-router-dom';

const items = [
  { to: '/submit', label: '提交任务' },
  { to: '/tasks', label: '任务列表' },
  { to: '/bidding', label: '入札中' },
  { to: '/won', label: '落札商品' }
];

export default function UserNav() {
  return (
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
  );
}
