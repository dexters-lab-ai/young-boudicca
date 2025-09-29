/// <reference types="node" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react';

// https://vite.config.js/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      server: {
        proxy: {
          '/tools': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
          },
          '/api': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
          },
          '/uploads': {
            target: 'http://127.0.0.1:8787',
            changeOrigin: true,
          }
        }
      }
    };
});