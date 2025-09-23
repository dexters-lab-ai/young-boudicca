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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// --- Kokoro TTS API & Cache Preloading ---
// Cache for Kokoro voices to avoid spawning the CLI on every request
type KokoroVoice = { value: string; label: string };
let kokoroVoicesCache: KokoroVoice[] = [];
let kokoroVoicesLastLoaded: number | null = null;
const VOICES_CACHE_FILE = path.join(__dirname, 'voices-cache.json');
const VOICES_LIST_TXT = path.join(__dirname, 'voices-list.txt');

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

function preloadKokoroVoicesCache() {
  // Avoid double-load if already cached
  if (kokoroVoicesCache.length > 0) return;
  // Prefer disk cache if present
  loadVoicesCacheFromDisk();
  if (kokoroVoicesCache.length > 0) return;
  const isWindows = process.platform === 'win32';
  const pythonExecutable = isWindows ? path.join(__dirname, '.venv', 'Scripts', 'python.exe') : 'python3';
  const command = fs.existsSync(pythonExecutable) ? pythonExecutable : 'kokoro-tts';
  const args = fs.existsSync(pythonExecutable) ? ['-m', 'kokoro_tts', '--help-voices'] : ['--help-voices'];
  // Choose model directory dynamically (server/ or server/python-tts/)
  const pythonTtsDirH = path.join(__dirname, 'python-tts');
  const modelDir = (fs.existsSync(path.join(__dirname, 'voices-v1.0.bin')) && fs.existsSync(path.join(__dirname, 'kokoro-v1.0.onnx')))
    ? __dirname
    : pythonTtsDirH;
  try {
    const p = spawn(command, args, {
      cwd: modelDir,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8:ignore', PYTHONUTF8: '1' },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (code) => {
      if (code === 0) {
        kokoroVoicesCache = parseVoicesOutput(out);
        kokoroVoicesLastLoaded = Date.now();
        saveVoicesCacheToDisk();
        console.log(`[Server] Preloaded ${kokoroVoicesCache.length} Kokoro voices.`);
      }
    });
  } catch {}
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

// Try to find index.html in any of the found directories
let staticDir: string | null = null;
for (const dir of foundDirs) {
  const indexPath = path.join(dir, 'index.html');
  if (fs.existsSync(indexPath)) {
    staticDir = dir as string;
    console.log(`Found index.html in: ${staticDir}`);
    break;
  } else {
    console.log(`No index.html found in: ${dir}`);
  }
}

if (!staticDir) {
  console.warn('No static directory with index.html found. SPA serving is disabled.');
  console.warn('Searched in:', foundDirs.join(', '));
} else {
  console.log(`[Server] Serving static files from: ${staticDir}`);
  
  // Serve static files with proper caching
  app.use(express.static(staticDir, {
    etag: true,
    maxAge: process.env.NODE_ENV === 'production' ? '1y' : '0',
    immutable: process.env.NODE_ENV === 'production',
    fallthrough: false,
    index: false // Disable automatic index.html serving, we'll handle it manually
  }));

  // SPA Fallback - must be the last route
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/tools/')) {
      return next();
    }
    
    const filePath = path.join(staticDir, req.path);
    const indexPath = path.join(staticDir, 'index.html');
    
    // If the file exists, serve it, otherwise serve index.html for SPA routing
    fs.access(filePath, fs.constants.F_OK, (err) => {
      if (err) {
        console.log(`[SPA] Route ${req.path} not found, serving index.html`);
        res.sendFile(indexPath, (err) => {
          if (err) {
            console.error('Error serving index.html:', err);
            if (!res.headersSent) {
              res.status(500).send('Error loading the application');
            }
          }
        });
      } else {
        res.sendFile(filePath, (err) => {
          if (err) {
            console.error(`Error serving ${filePath}:`, err);
            if (!res.headersSent) {
              res.status(500).send('Error loading resource');
            }
          }
        });
      }
    });
  });
}

// --- Kokoro TTS API Routes ---
registerRoute('get', '/api/tts-voices', (req: express.Request, res: express.Response) => {
  try {
    const wantsRefresh = String((req as any).query?.refresh || '').toLowerCase() === 'true';
    if (!wantsRefresh && kokoroVoicesCache.length > 0) {
      return res.json({ voices: kokoroVoicesCache, lastLoaded: kokoroVoicesLastLoaded });
    }
    // Determine the command based on the environment (local dev vs. Docker)
    const isWindows = process.platform === 'win32';
    const pythonExecutable = isWindows ? path.join(__dirname, '.venv', 'Scripts', 'python.exe') : 'python3';
    const command = fs.existsSync(pythonExecutable) ? pythonExecutable : 'kokoro-tts';
    const args = fs.existsSync(pythonExecutable) ? ['-m', 'kokoro_tts', '--help-voices'] : ['--help-voices'];
    // Compute modelDir (server/ or server/python-tts/) so Kokoro finds models
    const pythonTtsDirH = path.join(__dirname, 'python-tts');
    const modelDir = (fs.existsSync(path.join(__dirname, 'voices-v1.0.bin')) && fs.existsSync(path.join(__dirname, 'kokoro-v1.0.onnx')))
      ? __dirname
      : ((fs.existsSync(path.join(pythonTtsDirH, 'voices-v1.0.bin')) && fs.existsSync(path.join(pythonTtsDirH, 'kokoro-v1.0.onnx')))
          ? pythonTtsDirH
          : __dirname);

    console.log(`[Server] Running TTS voices command: ${command} ${args.join(' ')} (cwd=${modelDir.replace(/\\/g,'/')})`);

    const kokoroProcess = spawn(command, args, {
      cwd: modelDir, // Run where models are located
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8:ignore',
        PYTHONUTF8: '1',
      },
    });

    let voices = '';
    let stderrBuf = '';
    kokoroProcess.stdout.on('data', (data) => {
      voices += data.toString();
    });
    kokoroProcess.stderr.on('data', (data) => {
      const msg = data.toString();
      stderrBuf += msg;
      console.error(`kokoro-tts (voices) stderr: ${msg}`);
    });

    kokoroProcess.on('close', (code) => {
      if (code !== 0) {
        console.error(`kokoro-tts --help-voices process exited with code ${code}`);
        return res.status(500).json({ error: 'Failed to get voices from Kokoro TTS.', detail: stderrBuf.trim() });
      }

      // Parse the output to create a list of voices
      const parsedVoices = parseVoicesOutput(voices);
      kokoroVoicesCache = parsedVoices;
      kokoroVoicesLastLoaded = Date.now();

      res.json({ voices: parsedVoices, lastLoaded: kokoroVoicesLastLoaded });
    });

    kokoroProcess.on('error', (err) => {
      console.error('Failed to start kokoro-tts process.', err);
      res.status(500).json({ error: 'Kokoro TTS command not found or failed to start.' });
    });
  } catch (error) {
    console.error('Error fetching TTS voices:', error);
    res.status(500).json({ error: 'Failed to fetch TTS voices' });
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
