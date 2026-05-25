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
        { path: '/users', component: '@/Users' },
        { path: '/server-accounts', component: '@/Accounts' },
        { path: '/multi-bid-settings', component: '@/MultiBidSettings' },
        { path: '/data-cleanup', component: '@/DataCleanup' },
        { path: '/orders', component: '@/Orders' },
      ],
    },
    { path: '/accounts', redirect: '/server-accounts' },
  ],
}
