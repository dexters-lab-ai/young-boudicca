module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'npx',
      args: 'tsx server/index.ts',
      watch: false,
      autorestart: true,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      name: 'worker',
      script: 'npx',
      args: 'tsx server/worker.ts',
      watch: false,
      autorestart: true,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};