import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  apps: [
    {
      name: "backend",
      cwd: path.join(__dirname, 'dist'),
      script: "server/index.js",
      instances: "max",
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 8787
      },
      error_file: "/var/log/backend-error.log",
      out_file: "/var/log/backend-out.log",
      time: true
    }
  ]
};