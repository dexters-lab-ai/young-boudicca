/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// Load environment variables BEFORE anything else
import './env';

// FIX: Add import for process to provide Node.js types for 'process.platform'.
import process from 'process';
// FIX: Use express.Request and express.Response to avoid type conflicts with global DOM types.
// Correctly import Request, Response, and NextFunction to avoid conflicts with global DOM types.
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import mongoose from 'mongoose';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as fs from 'fs';

import { spawn } from 'child_process';
import { solscanService } from './services/solscan.js';
import Agent from './models/Agent.js';
import './env.js';

// Type for HTTP methods
type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch';

// Create a module-level function factory that takes the app instance
const createRouteRegistrar = (app: Express.Application) => {
  /**
   * Helper function to safely register routes with consistent error handling
   * @param method HTTP method (get, post, put, delete, etc.)
   * @param path Route path
   * @param handlers Array of route handler functions
   */
  return function registerRoute(
    method: HttpMethod,
    path: string,
    ...handlers: express.RequestHandler[]
  ): void {
    try {
      const routeMethod = (app as any)[method].bind(app);
      routeMethod(path, ...handlers);
      console.log(`[Route] Registered ${method.toUpperCase()} ${path}`);
    } catch (error) {
      console.error(`[Route] Failed to register ${method.toUpperCase()} ${path}:`, error);
      throw error;
    }
  };
};

// Get current file's directory in a way that works with both ES modules and CommonJS
const getCurrentDir = () => {
  try {
    // @ts-ignore - __filename is defined in CommonJS
    if (typeof __filename !== 'undefined') return path.dirname(__filename);
  } catch (e) {
    // Ignore error if __filename is not defined
  }
  return path.dirname(fileURLToPath(import.meta.url));
};

const __dirname = getCurrentDir();

// Initialize Express app
const app = express();
const registerRoute = createRouteRegistrar(app);

app.use(cors());
app.use(express.json({ limit: '25mb' }));

// Health check endpoint - must be before other routes
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    env: process.env.NODE_ENV || 'development',
    node_env: process.env.NODE_ENV,
    cwd: process.cwd(),
    __dirname: __dirname,
    files: fs.readdirSync(process.cwd())
  });
});

// Debug endpoint to check static files
app.get('/debug/static', (req, res) => {
  try {
    const staticPath = path.join(process.cwd(), 'dist');
    const files = fs.existsSync(staticPath) 
      ? fs.readdirSync(staticPath)
      : [];
      
    res.json({
      staticPath,
      exists: fs.existsSync(staticPath),
      files,
      env: process.env.NODE_ENV,
      cwd: process.cwd(),
      __dirname: __dirname
    });
  } catch (error) {
    console.error('Debug error:', error);
    res.status(500).json({ error: 'Debug error', details: String(error) });
  }
});

// --- Agent Management Endpoints ---

// Create a new agent
registerRoute('post', '/api/agents', async (req: Request, res: Response) => {
  try {
    const { name, description, walletAddress } = req.body;
    
    if (!name || !description || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const agent = new Agent({
      name,
      description,
      walletAddress,
      createdAt: new Date()
    });

    await agent.save();
    res.status(201).json(agent);
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// List all agents
registerRoute('get', '/api/agents', async (req: Request, res: Response) => {
  try {
    const agents = await Agent.find().sort({ createdAt: -1 });
    res.json(agents);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// Get agent by ID
registerRoute('get', '/api/agents/:id', async (req: Request, res: Response) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// --- Token Management Endpoints ---

// Get token metadata
registerRoute('get', '/api/tokens/:address/metadata', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const metadata = await solscanService.getTokenMetadata(address);
    
    if (!metadata) {
      return res.status(404).json({ error: 'Token metadata not found' });
    }
    
    res.json(metadata);
  } catch (error) {
    console.error('Error fetching token metadata:', error);
    res.status(500).json({ error: 'Failed to fetch token metadata' });
  }
});

// Get token price
registerRoute('get', '/api/tokens/:address/price', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;
    const marketInfo = await solscanService.getMarketInfo(address);
    
    if (!marketInfo) {
      return res.status(404).json({ error: 'Price information not available' });
    }
    
    res.json({
      price: marketInfo.price,
      priceChange24h: marketInfo.priceChange24h,
      volume24h: marketInfo.volume24h,
      marketCap: marketInfo.marketCap
    });
  } catch (error) {
    console.error('Error fetching token price:', error);
    res.status(500).json({ error: 'Failed to fetch token price' });
  }
});

// Set Content Security Policy headers
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "img-src 'self' data: https:; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "connect-src 'self' https://api.gemini.ai https://api.solscan.io; " +
    "media-src 'self' data: blob:; " +
    "frame-src 'self' https://www.youtube.com;"
  );
  next();
});

// --- Configuration ---
const TTS_CONFIG = {
  serviceUrl: process.env.TTS_SERVICE_URL || 'http://localhost:8899',
  cacheTtl: 24 * 60 * 60 * 1000, // 24 hours
  requestTimeout: 10000, // 10 seconds
};

// --- Kokoro TTS API & Cache Preloading ---
// Cache for Kokoro voices to avoid spawning the CLI on every request
type KokoroVoice = { value: string; label: string };
let kokoroVoicesCache: KokoroVoice[] = [];
let kokoroVoicesLastLoaded: number | null = null;
const VOICES_CACHE_FILE = path.join(__dirname, 'voices-cache.json');
const VOICES_LIST_TXT = path.join(__dirname, 'voices-list.txt');

// Ensure cache directory exists
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Normalize a voice value into a Kokoro-compatible id (e.g., "29. ef_dora" -> "ef_dora")
function sanitizeVoice(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  // Strip surrounding quotes if any
  const unquoted = s.replace(/^"|"$/g, '').replace(/^'|'$/g, '');
  // Remove any leading numbering like "29. "
  const cleaned = unquoted.replace(/^\s*\d+\.?\s*/, '').trim();
  // Basic allowlist of valid characters (letters, digits, underscore, comma, colon)
  return cleaned.replace(/[^a-zA-Z0-9_,:]/g, '');
}

function parseVoicesOutput(raw: string): KokoroVoice[] {
  try {
    // Try to parse as JSON first (for API responses)
    if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.voices)) {
        return data.voices.map((voice: string) => ({
          value: voice,
          label: voice
        }));
      }
    }

    // Fall back to line-based parsing
    const lines = raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('Languages') && !line.startsWith('Voices') && !line.startsWith('───'));
    
    const out: KokoroVoice[] = [];
    for (const label of lines) {
      const value = sanitizeVoice(label) || label;
      out.push({ value, label });
    }
    return out;
  } catch (error) {
    console.error('[Server] Failed to parse voices:', error);
    return [];
  }
}

function saveVoicesCacheToDisk() {
  try {
    const payload = JSON.stringify({ voices: kokoroVoicesCache, lastLoaded: kokoroVoicesLastLoaded }, null, 2);
    fs.writeFileSync(VOICES_CACHE_FILE, payload, 'utf-8');
  } catch (e) {
    console.warn('[Server] Failed to write voices cache file:', e);
  }
}

function loadVoicesCacheFromDisk() {
  try {
    if (fs.existsSync(VOICES_CACHE_FILE)) {
      const txt = fs.readFileSync(VOICES_CACHE_FILE, 'utf-8');
      const json = JSON.parse(txt);
      if (Array.isArray(json?.voices)) {
        kokoroVoicesCache = json.voices as KokoroVoice[];
        kokoroVoicesLastLoaded = typeof json.lastLoaded === 'number' ? json.lastLoaded : Date.now();
        console.log(`[Server] Loaded ${kokoroVoicesCache.length} voices from cache file.`);
      }
    } else if (fs.existsSync(VOICES_LIST_TXT)) {
      const raw = fs.readFileSync(VOICES_LIST_TXT, 'utf-8');
      kokoroVoicesCache = parseVoicesOutput(raw);
      kokoroVoicesLastLoaded = Date.now();
      saveVoicesCacheToDisk();
      console.log(`[Server] Built voices cache from voices-list.txt (${kokoroVoicesCache.length} voices).`);
    }
  } catch (e) {
    console.warn('[Server] Failed to load voices cache file:', e);
  }
}

async function fetchVoicesFromService(): Promise<KokoroVoice[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TTS_CONFIG.requestTimeout);

  try {
    console.log(`[Server] Fetching TTS voices from ${TTS_CONFIG.serviceUrl}/voices...`);
    
    const response = await fetch(`${TTS_CONFIG.serviceUrl}/voices`, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'success' && Array.isArray(data.voices)) {
      return data.voices.map((voice: string) => ({
        value: voice,
        label: voice
      }));
    } else {
      throw new Error('Invalid response format from TTS service');
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error) {
      if ('name' in error && error.name === 'AbortError') {
        throw new Error(`Request to TTS service timed out after ${TTS_CONFIG.requestTimeout}ms`);
      }
    }
    throw error;
  }
}

async function preloadKokoroVoicesCache() {
  // Skip if already loaded and cache is still fresh
  const now = Date.now();
  if (kokoroVoicesCache.length > 0 && 
      kokoroVoicesLastLoaded && 
      (now - kokoroVoicesLastLoaded) < TTS_CONFIG.cacheTtl) {
    return;
  }
  
  // Try to load from disk cache first if in-memory cache is empty
  if (kokoroVoicesCache.length === 0) {
    loadVoicesCacheFromDisk();
    
    // If disk cache is still fresh, use it
    if (kokoroVoicesCache.length > 0 && 
        kokoroVoicesLastLoaded && 
        (now - kokoroVoicesLastLoaded) < TTS_CONFIG.cacheTtl) {
      return;
    }
  }

  try {
    const voices = await fetchVoicesFromService();
    if (voices.length > 0) {
      kokoroVoicesCache = voices;
      kokoroVoicesLastLoaded = now;
      saveVoicesCacheToDisk();
      console.log(`[Server] Loaded ${voices.length} voices from TTS service.`);
    } else {
      throw new Error('No voices returned from TTS service');
    }
  } catch (error) {
    console.error('[Server] Failed to load voices from TTS service:', error);
    
    // Fallback to default voice if the service is not available and we have no cache
    if (kokoroVoicesCache.length === 0) {
      kokoroVoicesCache = [{ value: 'default', label: 'Default' }];
      console.log('[Server] Using default voice');
    }
  }
}
preloadKokoroVoicesCache();

// --- Request Logging Middleware ---
// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// Enhanced request logging middleware
app.use((req: express.Request, res: express.Response, next: NextFunction) => {
  const start = Date.now();
  const { method, originalUrl, ip, headers } = req;
  
  // Log request start
  console.log(`[${new Date().toISOString()}] ${method} ${originalUrl} from ${ip}`);
  console.log(`[Request Headers] ${JSON.stringify(headers, null, 2)}`);
  
  // Log request body for POST/PUT/PATCH
  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    console.log(`[Request Body] ${JSON.stringify(req.body, null, 2)}`);
  }
  
  // Log query parameters
  if (Object.keys(req.query).length > 0) {
    console.log(`[Query Params] ${JSON.stringify(req.query, null, 2)}`);
  }
  
  // Log environment info for debugging
  if (originalUrl === '/health') {
    console.log('[Health Check] Environment:', {
      NODE_ENV: process.env.NODE_ENV,
      PORT: process.env.PORT,
      MONGODB_URI: process.env.MONGODB_URI ? '***' : 'NOT SET',
      SOLSCAN_API_KEY: process.env.SOLSCAN_API_KEY ? '***' : 'NOT SET'
    });
  }
  
  // Log response time
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${method} ${originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// --- Database Connection ---
if (process.env.MONGODB_URI) {
  mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));
} else {
  console.warn('MONGODB_URI not found in .env file. Agent creation features will be disabled.');
}

// --- File Uploads (Multer) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsPath = path.join(__dirname, '..', 'public', 'uploads');
    // Ensure the directory exists
    fs.mkdirSync(uploadsPath, { recursive: true });
    cb(null, uploadsPath);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.vrm') {
      return cb(new Error('Only .vrm files are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB limit
});

// Serve uploaded files statically
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Helper function to safely add routes
function addRoute(method: string, path: string, handler: express.RequestHandler) {
  try {
    console.log(`[Route] Registering ${method.toUpperCase()} ${path}`);
    (app as any)[method.toLowerCase()](path, (req: express.Request, res: express.Response, next: NextFunction) => {
      console.log(`[Route] Handling ${method.toUpperCase()} ${path}`);
      return handler(req, res, next);
    });
  } catch (error) {
    console.error(`[Route] Error registering ${method.toUpperCase()} ${path}:`, error);
    throw error;
  }
}

// Determine possible static file locations with explicit type
const possibleDirs: readonly string[] = [
  // Production paths (Docker)
  '/app/dist',
  // Local development paths
  path.join(__dirname, '..', 'dist'),
  '/app/public',
  // Relative paths (development)
  path.join(__dirname, '..', 'dist'),
  path.join(__dirname, '..', 'public'),
  path.join(process.cwd(), 'dist'),
  path.join(process.cwd(), 'public')
] as const;

// Log available directories for debugging
console.log('Checking for static directories:');
const foundDirs: Array<string> = [];
for (const dir of possibleDirs) {
  try {
    const dirPath = dir as string; // Ensure dir is treated as string
    const exists = fs.existsSync(dirPath);
    console.log(`- ${dirPath}: ${exists ? 'Found' : 'Not found'}`);
    if (exists) {
      foundDirs.push(dirPath);
      const contents = fs.readdirSync(dirPath);
      console.log(`  Contents of ${dirPath}:`, contents.join(', '));
    }
  } catch (error) {
    console.error(`Error checking directory ${dir}:`, error);
  }
}

// Try to find// Serve static files from the first existing directory
let staticDirFound = false;
let staticPath = '';

for (const dir of possibleDirs) {
  try {
    const fullPath = path.resolve(dir);
    if (fs.existsSync(fullPath)) {
      console.log(`[Server] Found static files at: ${fullPath}`);
      console.log(`[Server] Directory contents:`, fs.readdirSync(fullPath));
      
      // Serve static files
      app.use(express.static(fullPath, {
        etag: true,
        maxAge: '1y',
        immutable: true,
        index: false,
        fallthrough: true,
      }));
      
      // Special handling for SPA fallback - serve index.html for all other routes
      app.get('*', (req, res) => {
        const indexPath = path.join(fullPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('Not Found');
        }
      });
      
      staticDirFound = true;
      staticPath = fullPath;
      
      // SPA Fallback - must be the last route
      app.get('*', (req, res, next) => {
        // Skip API routes
        if (req.path.startsWith('/api/') || req.path.startsWith('/tools/')) {
          return next();
        }
        
        const indexPath = path.join(fullPath, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('Not Found');
        }
      });
      
      break;
    }
  } catch (error) {
    console.error(`[Server] Error setting up static file serving for ${dir}:`, error);
    continue; // Try the next directory
  }
}

// If we've gone through all directories and didn't find any static files
if (!staticDirFound) {
  console.error('[Server] No static directory found to serve files from');
  // We'll log an error but continue starting the server
  // as some API routes might still work without static files
  console.error('[Server] Tried the following directories:', possibleDirs.join(', '));
}

// --- Kokoro TTS API Routes ---
registerRoute('get', '/api/tts-voices', async (req: express.Request, res: express.Response) => {
  try {
    const wantsRefresh = String((req as any).query?.refresh || '').toLowerCase() === 'true';
    if (!wantsRefresh && kokoroVoicesCache.length > 0) {
      return res.json({ voices: kokoroVoicesCache, lastLoaded: kokoroVoicesLastLoaded });
    }

    // Use a Python script to get voices
    const pythonScript = `
import json
import sys
import os

# Add the Python path to find kokoro_tts
sys.path.append('${__dirname.replace(/\\/g, '\\\\')}')

try:
    from kokoro_tts import list_voices
    
    # Get voices using the Python API
    voices = list_voices()
    
    # Format the output as expected by the frontend
    result = {
        voices: [
            {
                'value': voice['id'],
                'label': voice.get('name', voice['id']),
                'language': voice.get('language', 'en'),
                'gender': voice.get('gender', 'unknown')
            }
            for voice in voices
        ]
    }
    print(json.dumps(result))
    
except Exception as e:
    print(f"Error: {str(e)}", file=sys.stderr)
    sys.exit(1)
`;

    console.log('[Server] Fetching TTS voices using Python API...');
    
    // Create a temporary Python script
    const tempScriptPath = path.join(__dirname, 'get_voices.py');
    fs.writeFileSync(tempScriptPath, pythonScript);
    
    // Execute the Python script
    const pythonProcess = spawn('python3', [tempScriptPath], {
      env: {
        ...process.env,
        PYTHONPATH: process.env.PYTHONPATH ? 
          `${process.env.PYTHONPATH}:${__dirname}` : 
          __dirname,
        PYTHONIOENCODING: 'utf-8:ignore',
        PYTHONUTF8: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      stderr += msg;
      console.error(`Python script error: ${msg}`);
    });

    pythonProcess.on('close', (code) => {
      // Clean up the temporary script
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        console.error('Failed to clean up temporary script:', e);
      }

      if (code !== 0) {
        console.error(`Python script exited with code ${code}: ${stderr}`);
        return res.status(500).json({ 
          error: 'Failed to get voices from Kokoro TTS', 
          detail: stderr.trim() || 'Unknown error occurred'
        });
      }

      try {
        const result = JSON.parse(stdout);
        const parsedVoices = result.voices || [];
        kokoroVoicesCache = parsedVoices;
        kokoroVoicesLastLoaded = Date.now();
        
        // Save the cache to disk for future use
        saveVoicesCacheToDisk();
        
        res.json({ voices: parsedVoices, lastLoaded: kokoroVoicesLastLoaded });
      } catch (e) {
        console.error('Error parsing Python script output:', e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        res.status(500).json({ 
          error: 'Failed to parse voices data',
          detail: errorMessage
        });
      }
    });

    pythonProcess.on('error', (err: Error) => {
      console.error('Failed to start Python process:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      res.status(500).json({ 
        error: 'Failed to start Python process',
        detail: errorMessage
      });
    });
  } catch (error) {
    console.error('Error fetching TTS voices:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    res.status(500).json({ 
      error: 'Failed to fetch TTS voices',
      detail: errorMessage 
    });
  }
});

// --- Agent Creator API ---
registerRoute('post', '/api/agents/create', upload.single('vrmFile'), async (req: express.Request, res: express.Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No VRM file uploaded' });
    }
    
    const { name, description, walletAddress } = req.body;
    if (!name || !description || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save agent to database
    const agent = new Agent({
      name,
      description,
      walletAddress,
      vrmFile: req.file.filename,
      createdAt: new Date()
    });

    await agent.save();
    res.status(201).json({ success: true, agent });
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(500).json({ 
      error: 'Failed to create agent',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// --- Solana Tools (Solscan-backed) ---
registerRoute('post', '/tools/fetchTokenList', async (req: express.Request, res: express.Response) => {
  try {
    const { type = 'trending', platform = 'pumpfun' } = req.body ?? {};
    let data;

    console.log(`[Server] Fetching token list type: ${type}, platform: ${platform}`);
    
    if (type === 'trending') {
      data = await solscanService.fetchTrendingTokens(40);
    } else if (type === 'bonding') {
      data = await solscanService.fetchLaunchpadTokens(40, platform);
    } else {
      return res.status(400).json({ error: 'Invalid token list type' });
    }
    
    if (data) {
      res.json({ data });
    } else {
      res.status(500).json({ error: `Failed to fetch ${type} tokens` });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /tools/fetchTokenList:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to fetch token list', 
      details: errorMessage 
    });
  }
});


// Fetch trending tokens endpoint
registerRoute('post', '/tools/fetchTrendingTokens', async (req: express.Request, res: express.Response) => {
  try {
    const { limit = 9 } = req.body ?? {};
    console.log(`[Server] Fetching trending tokens with limit: ${limit}`);
    const data = await solscanService.fetchTrendingTokens(Number(limit));
        if (data) {
            console.log(`[Server] Responding with ${data.length} trending tokens.`);
            res.json({ data });
        } else {
            console.error('[Server] solscanService.fetchTrendingTokens returned null.');
            res.status(500).json({ error: 'Failed to fetch trending tokens from Solscan service.' });
        }
    } catch (err: any) {
        console.error('fetchTrendingTokens route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch trending tokens', details: err.message });
    }
});

// List all agents
registerRoute('get', '/api/agents/list', async (req: express.Request, res: express.Response) => {
    try {
        const agents = await Agent.find().exec();
        res.json({ agents });
    } catch (err: any) {
        console.error('listAgents route error:', err.message);
        res.status(500).json({ error: 'Failed to list agents', details: err.message });
    }
});

// Get agents by creator wallet address
registerRoute('get', '/api/agents/creator/:walletAddress', async (req: express.Request, res: express.Response) => {
    try {
        const walletAddress = req.params.walletAddress;
        const agents = await Agent.find({ walletAddress }).exec();
        res.json({ agents });
    } catch (err: any) {
        console.error('getAgentsByCreator route error:', err.message);
        res.status(500).json({ error: 'Failed to get agents by creator', details: err.message });
    }
});

// Fetch bonding tokens endpoint
registerRoute('post', '/tools/fetchBondingTokens', async (req: express.Request, res: express.Response) => {
  try {
    const { limit = 20, platform } = req.body ?? {};
    console.log(`[Server] Fetching bonding tokens with limit: ${limit}, platform: ${platform}`);
    
    const data = await solscanService.fetchLaunchpadTokens(Number(limit), platform);
    if (data) {
      console.log(`[Server] Responding with ${data.length} bonding tokens`);
      res.json({ data });
    } else {
      console.error('[Server] Failed to fetch bonding tokens: No data returned');
      res.status(500).json({ error: 'Failed to fetch bonding tokens' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /tools/fetchBondingTokens:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to fetch bonding tokens',
      details: errorMessage
    });
  }
});

// Fetch latest tokens endpoint
registerRoute('get', '/api/tokens/latest', async (req: express.Request, res: express.Response) => {
  try {
    console.log('[Server] Fetching latest tokens');
    const data = await solscanService.getLatestTokens();
    
    if (data) {
      console.log(`[Server] Responding with ${data.length} latest tokens`);
      res.json({ data });
    } else {
      console.error('[Server] Failed to fetch latest tokens: No data returned');
      res.status(500).json({ error: 'Failed to fetch latest tokens' });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in /api/tokens/latest:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to fetch latest tokens',
      details: errorMessage
    });
  }
});

// Get token metadata by address
registerRoute('post', '/tools/getTokenMetadata', async (req: express.Request, res: express.Response) => {
  try {
    const { address } = req.body ?? {};
    if (!address) {
      return res.status(400).json({ error: 'Missing token address' });
    }
    
    console.log(`[Server] Fetching metadata for token: ${address}`);
    const data = await solscanService.getTokenMetadata(String(address));
        if (data) {
            console.log(`[Server] Responding with metadata for ${address}.`);
            res.json({ data });
        } else {
            console.error(`[Server] solscanService.getTokenMetadata for ${address} returned null.`);
            res.status(404).json({ error: 'Metadata not found.' });
        }
    } catch (err: any) {
        console.error('getTokenMetadata route error:', err.message);
        res.status(500).json({ error: 'Failed to get token metadata', details: err.message });
    }
});

// Get token market info by address
registerRoute('post', '/tools/getTokenPrice', async (req: express.Request, res: express.Response) => {
  try {
    const { address } = req.body ?? {};
    if (!address) {
      return res.status(400).json({ error: 'Missing token address' });
    }
    
    console.log(`[Server] Fetching market info for token: ${address}`);
    const data = await solscanService.getMarketInfo(String(address));
    if (data) {
      console.log(`[Server] Responding with market info for ${address}.`);
      res.json({ data });
    } else {
      console.error(`[Server] solscanService.getMarketInfo for ${address} returned null.`);
      res.status(404).json({ error: 'Market info not found.' });
    }
    } catch (err: any) {
        console.error('getTokenPrice route error:', err.message);
        res.status(500).json({ error: 'Failed to get token price', details: err.message });
    }
});

registerRoute('post', '/tools/getMarketInfo', async (req: express.Request, res: express.Response) => {
    try {
        const { address } = req.body ?? {};
        if (!address) return res.status(400).json({ error: 'Missing address' });
        console.log(`[Server] Calling solscanService.getMarketInfo for address: ${address}`);
        const data = await solscanService.getMarketInfo(String(address));
        if (data) {
            console.log(`[Server] Responding with market info for ${address}.`);
            res.json({ data });
        } else {
            console.error(`[Server] solscanService.getMarketInfo for ${address} returned null.`);
            res.status(404).json({ error: 'Market info not found.' });
        }
    } catch (err: any) {
        console.error('getMarketInfo route error:', err.message);
        res.status(500).json({ error: 'Failed to get market info' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchCandles', async (req: express.Request, res: express.Response) => {
    try {
        const { address, time_from, time_to } = req.body ?? {};
        if (!address || !time_from || !time_to) return res.status(400).json({ error: 'Missing fields' });
        console.log(`[Server] Calling solscanService.fetchTokenCandles for address: ${address}`);
        const data = await solscanService.fetchTokenCandles({
            address: String(address),
            time_from: Number(time_from),
            time_to: Number(time_to),
        });
        if (data) {
            console.log(`[Server] Responding with ${data.length} candles for ${address}.`);
            res.json({ data });
        } else {
            console.error(`[Server] solscanService.fetchTokenCandles for ${address} returned null.`);
            res.status(500).json({ error: 'Failed to fetch candles.' });
        }
    } catch (err: any) {
        console.error('fetchCandles route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch candles' });
    }
});

const PORT = process.env.SERVER_PORT || 8787;
// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Add error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const server = http.createServer(app);

// Add error handling for server errors
server.on('error', (error: NodeJS.ErrnoException) => {
  console.error('Server Error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else if (error.code === 'EACCES') {
    console.error(`Port ${PORT} requires elevated privileges`);
    process.exit(1);
  } else {
    console.error('Unhandled server error:', error);
  }
});

server.listen(PORT, () => {
    const redact = (v?: string) => (v ? `${v.slice(0, 6)}...(${v.length})` : 'undefined');
    console.log(`[server] Startup. NODE_ENV=${process.env.NODE_ENV || 'development'}`);
    console.log(`[server] SOLSCAN_API_KEY present: ${process.env.SOLSCAN_API_KEY ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
    console.log(`[server] Server is listening on http://localhost:${PORT}`);
});
