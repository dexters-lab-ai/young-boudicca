module.exports = {
  apps: [{
    name: "backend",
    cwd: __dirname,
    script: "npx",
    args: "tsx server/index.ts",
    interpreter: "node",
    instances: 1,
    exec_mode: "fork",
    env: {
      NODE_ENV: "production",
      HOST: "0.0.0.0",
      PORT: process.env.PORT || 3000
    },
    error_file: "./logs/error.log",
    out_file: "./logs/out.log",
    merge_logs: true,
    time: true,
    // Add these health check settings
    watch: false,
    max_memory_restart: '1G',
    // Health check configuration
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};