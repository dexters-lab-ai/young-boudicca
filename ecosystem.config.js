module.exports = {
    apps: [
      {
        name: "backend",
        script: "server/index.ts",
        interpreter: "tsx",
        env: {
          NODE_ENV: "production"
        }
      },
      {
        name: "frontend",
        script: "node_modules/.bin/vite",
        args: "preview --host 0.0.0.0 --port 3000",
        env: {
          NODE_ENV: "production"
        }
      }
    ]
  };