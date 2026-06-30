export default {
  history: { type: 'hash' },
  proxy: {
    '/api': {
      target: 'http://localhost:3034',
      changeOrigin: true,
    },
  },
  routes: [
    { path: '/login', component: '@/pages/Login' },
    {
      path: '/',
      component: '@/layouts/AdminLayout',
      routes: [
        { path: '/', redirect: '/tasks' },
        { path: '/tasks', component: '@/Tasks' },
        { path: '/reports', component: '@/Reports' },
        { path: '/accounts', component: '@/AccountManagement' },
        { path: '/users', redirect: '/accounts' },
        { path: '/server-accounts', redirect: '/accounts' },
        { path: '/multi-bid-settings', component: '@/MultiBidSettings' },
        { path: '/data-cleanup/db-backup', component: '@/DatabaseBackup' },
        { path: '/data-cleanup', component: '@/DataCleanup' },
        { path: '/data-batch', component: '@/DataBatch' },
        { path: '/manual-order-import', component: '@/ManualOrderImport' },
        { path: '/message-read', component: '@/MessageRead' },
        { path: '/shipping-refresh', redirect: '/data-batch' },
        { path: '/product-type-refresh', redirect: '/data-batch' },
        { path: '/orders-resync', redirect: '/data-batch' },
        { path: '/special-user-settings', component: '@/SpecialUserSettings' },
        { path: '/orders', component: '@/Orders' },
        { path: '/online-users', component: '@/OnlineUsers' },
      ],
    },
  ],
}
