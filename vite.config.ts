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
        chunkSizeWarningLimit: 1000,
        rollupOptions: {
          output: {
            manualChunks: {
              vendor: [
                'react',
                'react-dom',
                'react-router-dom'
              ],
              three: [
                'three',
                '@react-three/fiber',
                '@react-three/drei'
              ],
              solana: [
                '@solana/web3.js',
                '@solana/wallet-adapter-base',
                '@solana/wallet-adapter-react',
                '@solana/wallet-adapter-react-ui',
                '@solana/wallet-adapter-wallets'
              ]
            }
          }
        }
      },
      server: {
        host: true,
        port: 3000,
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
      }
    };
});