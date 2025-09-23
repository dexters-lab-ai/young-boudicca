import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react';

// https://vite.config.js/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProduction = mode === 'production';
    
    return {
      plugins: [react()],
      base: isProduction ? '/' : '/',
      build: {
        outDir: 'dist',
        assetsDir: 'assets',
        emptyOutDir: true,
        sourcemap: !isProduction,
        minify: isProduction ? 'esbuild' : false,
        rollupOptions: {
          external: ['react', 'react-dom', 'react-router-dom'],
          output: {
            globals: {
              'react': 'React',
              'react-dom': 'ReactDOM',
              'react-router-dom': 'ReactRouterDOM',
            },
            manualChunks: (id) => {
              if (id.includes('node_modules/three') || id.includes('@react-three')) {
                return 'three';
              }
              if (id.includes('@solana/')) {
                return 'solana';
              }
              if (id.includes('node_modules')) {
                return 'vendor';
              }
            },
          },
        },
      },
      server: {
        host: true,
        port: 3000,
      },
      preview: {
        host: true,
        port: 3000,
        strictPort: true,
        allowedHosts: [
          'young-boudicca.sliplane.app',
          'localhost',
          '127.0.0.1'
        ]
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.NODE_ENV': JSON.stringify(mode)
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