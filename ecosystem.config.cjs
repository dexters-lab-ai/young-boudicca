// PM2 Configuration for TypeScript
require('ts-node/register');

module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'server/index.ts',
      interpreter: './node_modules/.bin/node',
      interpreter_args: '-r ts-node/register --loader tsx',
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=4096 --unhandled-rejections=strict',
        TS_NODE_PROJECT: './tsconfig.json',
        TS_NODE_TRANSPILE_ONLY: 'true'
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      time: true,
      watch: false,
      max_restarts: 3,
      min_uptime: '5s',
      listen_timeout: 10000,
      kill_timeout: 5000,
      wait_ready: true,
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      kill_timeout: 5000,
      wait_ready: true,
    },
    {
      name: 'worker',
      script: 'server/worker.ts',
      interpreter: './node_modules/.bin/node',
      interpreter_args: '-r ts-node/register --loader tsx',
      watch: false,
      autorestart: true,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      min_uptime: '5s',
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        NODE_OPTIONS: '--max-old-space-size=1024 --unhandled-rejections=warn',
        TS_NODE_PROJECT: './tsconfig.json',
        TS_NODE_TRANSPILE_ONLY: 'true'
      },
      error_file: './logs/worker-error.log',
      out_file: './logs/worker-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      time: true,
    },
  ],
};