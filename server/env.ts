/**
 * Ensures environment variables are loaded BEFORE any other server modules execute.
 * ESM runs imported modules before top-level code, so import this file first.
 */
// FIX: Explicitly import `process` to ensure the correct Node.js types are used.
import process from 'process';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../');

// Load environment variables based on NODE_ENV
const envPath = process.env.NODE_ENV === 'production' 
  ? '/app/.env.production' 
  : path.resolve(__dirname, '../../.env');

try {
  dotenv.config({ path: envPath });
} catch (error) {
  console.log(`[env] No .env file found at ${envPath}, using environment variables from system`);
}

// Respect existing NODE_ENV; default to development
const envName = process.env.NODE_ENV === 'production' ? 'production' : (process.env.NODE_ENV || 'development');
const envSpecificPath = path.resolve(root, `.env.${envName}`);

// Load base first (no override)
const baseEnvPath = path.resolve(root, '.env');
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
// DOC: Use API_KEY for Gemini API key
console.log(`[env] API_KEY present: ${process.env.API_KEY ? 'YES' : 'NO'}`);
// eslint-disable-next-line no-console
console.log(`[env] SOLSCAN_API_KEY present: ${process.env.SOLSCAN_API_KEY ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
// eslint-disable-next-line no-console
console.log(`[env] MONGODB_URI present: ${process.env.MONGODB_URI ? 'YES' : 'NO'} (${redact(process.env.MONGODB_URI)})`);
// eslint-disable-next-line no-console
console.log(`[env] MERCHANT_WALLET_ADDRESS present: ${process.env.MERCHANT_WALLET_ADDRESS ? 'YES' : 'NO'}`);
// eslint-disable-next-line no-console
console.log(`[env] FACILITATOR_URL present: ${process.env.FACILITATOR_URL ? 'YES' : 'NO'}`);

// Redis connection logging
if (process.env.REDIS_URL) {
    // eslint-disable-next-line no-console
    console.log('[env] Redis configured via REDIS_URL: YES');
} else if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
    // eslint-disable-next-line no-console
    console.log('[env] Redis configured via REDIS_HOST/PORT: YES');
    // eslint-disable-next-line no-console
    console.log(`[env]   - REDIS_USERNAME present: ${process.env.REDIS_USERNAME ? 'YES' : 'NO'}`);
    // eslint-disable-next-line no-console
    console.log(`[env]   - REDIS_PASSWORD present: ${process.env.REDIS_PASSWORD ? 'YES' : 'NO'}`);
} else {
    // eslint-disable-next-line no-console
    console.log('[env] Redis configured: NO');
}

// eslint-disable-next-line no-console
console.log('[env] Backblaze configuration is optional');