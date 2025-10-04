module.exports = {
  apps: [
    {
      name: "backend",
      cwd: __dirname,
      script: "./server/index.js",  // This will be built by the build process
      interpreter: "node",
      interpreter_args: "--require tsx/register",
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