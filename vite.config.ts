import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// https://vite.config.js/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProduction = mode === 'production';
    
    return {
      plugins: [
        react(),
        // Copy static files to the dist directory
        viteStaticCopy({
          targets: [
            {
              src: 'public/*',
              dest: './'
            },
            {
              src: 'server/python-tts/models/*',
              dest: 'models/'
            }
          ]
        })
      ],
      base: isProduction ? '/' : '/',
      build: {
        outDir: 'dist',
        assetsDir: 'assets',
        emptyOutDir: true,
        sourcemap: !isProduction,
        minify: isProduction ? 'esbuild' : false,
        chunkSizeWarningLimit: 1000,
        // Ensure all assets are properly hashed for cache busting
        manifest: true,
        // Ensure static assets are properly copied
        assetsInlineLimit: 0,
        rollupOptions: {
          output: {
            // Ensure consistent chunk naming
            entryFileNames: 'assets/[name]-[hash].js',
            chunkFileNames: 'assets/[name]-[hash].js',
            assetFileNames: 'assets/[name]-[hash][extname]',
            manualChunks: {
              vendor: [
                'react',
                'react-dom',
                'react-router-dom',
                'zustand'
              ],
              three: [
                'three',
                '@react-three/fiber',
                '@react-three/drei',
                '@pixiv/three-vrm',
                '@pixiv/three-vrm-animation'
              ],
              solana: [
                '@solana/web3.js',
                '@solana/wallet-adapter-base',
                '@solana/wallet-adapter-react',
                '@solana/wallet-adapter-react-ui',
                '@solana/wallet-adapter-wallets',
                'bs58',
                'tweetnacl'
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