/// <reference types="node" />
import { defineConfig, loadEnv, ConfigEnv, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.config.js/config/
export default defineConfig(({ mode }: ConfigEnv): UserConfig => {
  const env = loadEnv(mode, '.', '');
  const isProduction = mode === 'production';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'robots.txt', 'apple-touch-icon.png'],
        workbox: {
          maximumFileSizeToCacheInBytes: 30 * 1024 * 1024, // 30MB
          globPatterns: [
            '**/*.{js,css,html,ico,png,svg,json,woff2}',
            '!**/images/environments/*',
            '!**/textures/*'
          ]
        },
        manifest: {
          name: 'AI Dreams',
          short_name: 'AIDreams',
          description: 'Create, own, and monetize unique 3D AI companions',
          theme_color: '#ffffff',
          icons: [
            {
              src: 'pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: 'pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
      }),
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    server: {
      port: 3000,
      strictPort: true,
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
        },
      },
    },
    build: {
      target: 'esnext',
      minify: isProduction ? 'esbuild' : false,
      sourcemap: !isProduction,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            three: ['three', '@react-three/fiber', '@react-three/drei'],
            solana: ['@solana/web3.js', '@solana/wallet-adapter-react'],
          },
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        // Enable bigint support
        target: 'es2020',
      },
    },
    };
});