import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
  apps: [
    {
      name: "backend",
      cwd: __dirname,
      script: "./dist/server/index.js",  // Updated path
      instances: 1,                      // Changed from "max" to 1 for debugging
      exec_mode: "fork",                 // Changed from "cluster" to "fork"
      env: {
        NODE_ENV: "production",
        PORT: 3000
      },
      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss"
    }
  ]
};