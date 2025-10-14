/**
 * Ensures environment variables are loaded BEFORE any other server modules execute.
 * ESM runs imported modules before top-level code, so import this file first.
 */
// FIX: Explicitly import `process` to ensure the correct Node.js types are used.
import process from 'process';
import path from 'path';
import dotenv from 'dotenv';

const root = process.cwd();
const baseEnvPath = path.resolve(root, '.env');
// Respect existing NODE_ENV; default to development
const envName = process.env.NODE_ENV === 'production' ? 'production' : (process.env.NODE_ENV || 'development');
const envSpecificPath = path.resolve(root, `.env.${envName}`);

// Load base first (no override)
const base = dotenv.config({ path: baseEnvPath, override: false });
// Then environment-specific (override base)
const specific = dotenv.config({ path: envSpecificPath, override: true });

// Minimal, safe diagnostics (do not print secrets)
const redact = (v?: string) => (v ? `${v.slice(0, 6)}...(${v.length})` : 'undefined');
// eslint-disable-next-line no-console
console.log(`[env] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
// eslint-disable-next-line no-console
console.log(`[env] Loaded base: ${base.error ? 'NO' : 'YES'} (${baseEnvPath})`);
// eslint-disable-next-line no-console
console.log(`[env] Loaded specific: ${specific.error ? 'NO' : 'YES'} (${envSpecificPath})`);
// eslint-disable-next-line no-console
console.log(`[env] SOLSCAN_API_KEY present: ${process.env.SOLSCAN_API_KEY ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
// eslint-disable-next-line no-console
console.log(`[env] MONGODB_URI present: ${process.env.MONGODB_URI ? 'YES' : 'NO'} (${redact(process.env.MONGODB_URI)})`);
// eslint-disable-next-line no-console
console.log(`[env] Backblaze configured: ${process.env.BACKBLAZE_KEY_ID && process.env.BACKBLAZE_APPLICATION_KEY && process.env.BACKBLAZE_BUCKET_ID ? 'YES' : 'NO'}`);