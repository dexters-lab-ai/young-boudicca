import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/',
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
  server: {
    port: 3000,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    minify: true,
    sourcemap: false,
    rollupOptions: {
      input: 'index.html',
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
      target: 'es2020',
    },
  },
});
