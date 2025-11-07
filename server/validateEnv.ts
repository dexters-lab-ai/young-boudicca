import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env file if it exists (for local development)
const envPath = process.env.NODE_ENV === 'production' 
  ? '/app/.env.production' 
  : path.resolve(__dirname, '../../.env');

try {
  dotenv.config({ path: envPath });
} catch (error) {
  console.log(`[env] No .env file found at ${envPath}, using environment variables from system`);
}

// List of required environment variables
const requiredEnvVars = [
  'MONGODB_URI',
  'SOLSCAN_API_KEY',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'BACKBLAZE_APPLICATION_KEY_ID',
  'BACKBLAZE_APPLICATION_KEY',
  'BACKBLAZE_BUCKET_ID',
  'FACILITATOR_URL',
  'MERCHANT_WALLET_ADDRESS',
  'REDIS_URL'
];

// Validate required environment variables
export function validateEnv() {
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`  - ${varName}`));
    
    if (process.env.NODE_ENV === 'production') {
      console.error('\nPlease add these variables to your Sliplane environment variables.');
    } else {
      console.error('\nPlease add them to your .env file and restart the server.');
    }
    
    // Only exit in production to prevent deployment loops
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }

  // Log environment status
  console.log('✅ Environment variables validated successfully');
  
  // Log environment info (without sensitive data)
  console.log('\nEnvironment Configuration:');
  console.log(`- NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
  console.log(`- MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Set' : '❌ Missing'}`);
  console.log(`- REDIS_URL: ${process.env.REDIS_URL ? '✅ Set' : '❌ Missing'}`);
  console.log(`- FACILITATOR_URL: ${process.env.FACILITATOR_URL || '❌ Missing'}`);
  console.log(`- MERCHANT_WALLET_ADDRESS: ${process.env.MERCHANT_WALLET_ADDRESS ? '✅ Set' : '❌ Missing'}\n`);
}

// Run validation if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateEnv();
}
