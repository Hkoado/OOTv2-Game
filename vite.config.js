import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_TARGET = process.env.OOTV2_API_URL || 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    // Proxy /api -> API tournament local để client dùng URL tương đối, không cần CORS.
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true
      }
    }
  }
});

