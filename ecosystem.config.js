module.exports = {
  apps: [
    {
      name: "backend",
      script: "server/index.ts",
      interpreter: "tsx",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 8787
      },
      error_file: "/var/log/backend-error.log",
      out_file: "/var/log/backend-out.log",
      time: true
    },
    {
      name: "frontend",
      script: "node_modules/vite/bin/vite.js",
      args: "preview --host 0.0.0.0 --port 3000",
      watch: false,
      env: {
        NODE_ENV: "production"
      },
      error_file: "/var/log/frontend-error.log",
      out_file: "/var/log/frontend-out.log",
      time: true
    }
  ]
};