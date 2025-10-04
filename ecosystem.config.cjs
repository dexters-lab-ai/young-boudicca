module.exports = {
  apps: [
    {
      name: "backend",
      cwd: __dirname,
      script: "npx",
      args: "tsx server/index.ts",
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      time: true
    }
  ]
};