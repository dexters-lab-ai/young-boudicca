// FIX: Removed reference to "vite/client" as it was causing a type definition error.
// Types for defineConfig and loadEnv are imported directly from 'vite'.
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
// FIX: Import 'process' to provide correct types for process.cwd().
import process from 'process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isProduction = mode === 'production';

  const localServerOrigin = (env.NODE_ENV ?? '').toLowerCase() === 'production'
    ? 'http://0.0.0.0:8787'
    : 'http://localhost:8787';

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
      'process.env': { ...process.env, ...env },
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
      proxy: {
        '/api': {
          target: localServerOrigin,
          changeOrigin: true,
          secure: false,
        },
        '/tools': {
          target: localServerOrigin,
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: localServerOrigin,
          changeOrigin: true,
          secure: false,
        },
      },
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