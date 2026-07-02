import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3035,
    strictPort: true,
    allowedHosts: [
      'kumohiro.com',
      'www.kumohiro.com',
      'buy.kumohiro.com'
    ],
    proxy: {
      '/api': 'http://localhost:3034'
    }
  }
});
