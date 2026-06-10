import { Tabs } from 'antd';
import UsersPage from './Users';
import ServerAccountsPage from './Accounts';

export default function AccountManagementPage() {
  return (
    <Tabs
      className="admin-data-batch-tabs"
      defaultActiveKey="users"
      items={[
        {
          key: 'users',
          label: '用户账号',
          children: <UsersPage />
        },
        {
          key: 'serverAccounts',
          label: '服务器账号',
          children: <ServerAccountsPage />
        }
      ]}
    />
  );
}
