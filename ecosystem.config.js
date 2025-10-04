import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  apps: [
    {
      name: "backend",
      cwd: path.join(__dirname, 'server'),
      script: "index.ts",
      interpreter: "tsx",
      interpreter_args: "--import tsx",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 8787
      },
      error_file: "/var/log/backend-error.log",
      out_file: "/var/log/backend-out.log",
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      instance_var: 'INSTANCE_ID',
      exec_mode: 'cluster',
      instances: 'max',
      autorestart: true,
      max_memory_restart: '1G',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: "frontend",
      cwd: __dirname,
      script: "npx",
      args: "vite preview --host 0.0.0.0 --port 3000",
      interpreter: "none",
      watch: false,
      env: {
        NODE_ENV: "production",
        HOST: "0.0.0.0",
        PORT: 3000
      },
      error_file: "/var/log/frontend-error.log",
      out_file: "/var/log/frontend-out.log",
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
      instance_var: 'INSTANCE_ID',
      autorestart: true,
      wait_ready: true,
      listen_timeout: 10000
    }
  ]
};