import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
// FIX: Add imports for 'url' and 'process' to support ESM and provide Node.js types.
import { fileURLToPath } from 'url';
import process from 'process';

// Get current file's directory in a way that works with both ES modules and CommonJS
const getCurrentDir = () => {
  try {
    // @ts-ignore - __dirname is defined in CommonJS
    if (typeof __dirname !== 'undefined') return __dirname;
  } catch (e) {
    // Ignore error if __dirname is not defined
  }
  return path.dirname(fileURLToPath(import.meta.url));
};

const __dirname = getCurrentDir();

// Build-time helper: fetch Kokoro voices and write to server/voices-list.txt
// This reduces runtime latency and lets the server preload voices from disk.

const SERVER_DIR = path.join(__dirname, '..');
const OUT_TXT = path.join(SERVER_DIR, 'voices-list.txt');

function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const pythonExecutable = isWindows
      ? path.join(SERVER_DIR, '.venv', 'Scripts', 'python.exe')
      : 'python3';
    const command = fs.existsSync(pythonExecutable) ? pythonExecutable : 'kokoro-tts';
    const args = fs.existsSync(pythonExecutable)
      ? ['-m', 'kokoro_tts', '--help-voices']
      : ['--help-voices'];

    console.log(`[voices:build] Running: ${command} ${args.join(' ')}`);

    const p = spawn(command, args, {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8:ignore',
        PYTHONUTF8: '1',
      },
    });

    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));

    p.on('close', (code) => {
      if (code !== 0) {
        console.error('[voices:build] Failed to get voices. stderr=\n' + err);
        reject(new Error(`kokoro voices exited with code ${code}`));
        return;
      }
      try {
        fs.writeFileSync(OUT_TXT, out, 'utf-8');
        console.log(`[voices:build] Wrote ${OUT_TXT} (${out.split('\n').length} lines).`);
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    p.on('error', (e) => reject(e));
  });
}

run().catch((e) => {
  console.error('[voices:build] Error:', e?.message || e);
  process.exitCode = 1;
});
