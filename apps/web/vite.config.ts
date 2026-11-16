import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
      '/docs': 'http://localhost:3001',
      '/openapi.json': 'http://localhost:3001',
    },
  },
});
