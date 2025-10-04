import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
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
          ],
        },
        manifest: {
          name: 'AI Dreams',
          short_name: 'AIDreams',
          description: 'Create, own, and monetize unique 3D AI companions as NFTs',
          theme_color: '#ffffff',
          icons: [
            {
              src: '/android-chrome-192x192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/android-chrome-512x512.png',
              sizes: '512x512',
              type: 'image/png',
            },
          ],
        },
      }),
    ],
    define: {
      'process.env': { ...process.env },
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    server: {
      port: 3000,
      strictPort: true,
      host: true,
      origin: 'http://0.0.0.0:3000',
      watch: {
        usePolling: true,
      },
    },
    preview: {
      port: 3000,
      strictPort: true,
    },
    build: {
      target: 'esnext',
      outDir: 'dist',
      sourcemap: !isProduction,
      minify: isProduction ? 'esbuild' : false,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom', 'react-router-dom'],
            three: ['three', '@react-three/fiber', '@react-three/drei'],
          },
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'es2020',
      },
    },
  };
});
