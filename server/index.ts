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
import { solscanService } from './services/solscan';
import Agent from './models/Agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

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
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.use((req: express.Request, res: express.Response, next: NextFunction) => {
  if (req.originalUrl.startsWith('/tools') || req.originalUrl.startsWith('/api')) {
    console.log(`[Server] Incoming Request -> ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
      console.log(`[Server] Request Body: ${JSON.stringify(req.body)}`);
    }
    if (req.originalUrl.startsWith('/tools')) {
      const present = Boolean(process.env.SOLSCAN_API_KEY);
      console.log(`[Server] SOLSCAN_API_KEY present: ${present ? 'YES' : 'NO'}`);
    }
  }
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

// In production, serve static files from the dist directory
if (process.env.NODE_ENV === 'production') {
  const staticDir = path.join(__dirname, '..', 'dist');
  
  // Serve static files
  app.use(express.static(staticDir, {
    etag: true,
    maxAge: '1y',  // Cache for 1 year
    immutable: true
  }));

  // Serve index.html for any other route that hasn't been matched by now
  app.get('*', (req, res, next) => {
    // Skip API routes
    if (req.path.startsWith('/api/') || req.path.startsWith('/tools/')) {
      return next();
    }
    res.sendFile('index.html', { root: staticDir });
  });
}

// --- Kokoro TTS API Routes ---

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.get('/api/tts-voices', (req: express.Request, res: express.Response) => {
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
});

// --- Agent Creator API ---
// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/api/agents/create', upload.single('vrmFile'), async (req: express.Request, res: express.Response) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }
  try {
    const { name, description, systemInstruction, creatorWalletAddress, signature, message, vrmUrl: vrmUrlFromText } = req.body;
    
    if (!name || !description || !systemInstruction || !creatorWalletAddress || !signature || !message) {
      return res.status(400).json({ error: 'Missing required text fields or signature.' });
    }

    // --- Signature Verification ---
    const publicKey = new PublicKey(creatorWalletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);

    const isVerified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());

    if (!isVerified) {
// FIX: Cast req to any to access multer's `file` property.
      if ((req as any).file) fs.unlinkSync((req as any).file.path); // Clean up uploaded file on auth failure
      return res.status(403).json({ error: 'Invalid signature. Wallet ownership could not be verified.' });
    }
    // --- End Signature Verification ---

    let finalVrmUrl = '';
    if ((req as any).file) {
        finalVrmUrl = `/uploads/${(req as any).file.filename}`;
    } else if (vrmUrlFromText && typeof vrmUrlFromText === 'string' && vrmUrlFromText.trim() !== '') {
        const url = vrmUrlFromText.trim();
        if (!url.startsWith('http') || !url.endsWith('.vrm')) {
            return res.status(400).json({ error: 'Invalid VRM URL. It must be a direct link to a .vrm file.' });
        }
        finalVrmUrl = url;
    } else {
        return res.status(400).json({ error: 'A VRM file upload or a direct URL is required.' });
    }

    const newAgent = new Agent({
      name,
      description,
      systemInstruction,
      creatorWalletAddress,
      vrmUrl: finalVrmUrl
    });
    await newAgent.save();
    res.status(201).json(newAgent);
  } catch (err: any) {
    console.error('Agent creation error', err);
// FIX: Cast req to any to access multer's `file` property.
    if ((req as any).file) fs.unlinkSync((req as any).file.path); // Clean up uploaded file on any error
    res.status(500).json({ error: 'Failed to create agent', details: err.message });
  }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.get('/api/agents/list', async (req: express.Request, res: express.Response) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }
  try {
    const agents = await Agent.find().sort({ createdAt: -1 });
    res.json(agents);
  } catch (err) {
    console.error('List agents error', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.get('/api/agents/creator/:walletAddress', async (req: express.Request, res: express.Response) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }
  try {
    const { walletAddress } = req.params;
    const agents = await Agent.find({ creatorWalletAddress: walletAddress }).sort({ createdAt: -1 });
    res.json(agents);
  } catch (err) {
    console.error('Fetch creator agents error', err);
    res.status(500).json({ error: 'Failed to fetch creator agents' });
  }
});


// --- Solana Tools (Solscan-backed) ---

// NEW: Flexible endpoint for the token ticker UI
// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchTokenList', async (req: express.Request, res: express.Response) => {
    try {
        const { type = 'trending', platform = 'pumpfun' } = req.body ?? {};
        let data;
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
            res.status(500).json({ error: `Failed to fetch ${type} tokens.` });
        }
    } catch (err: any) {
        console.error('fetchTokenList route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch token list' });
    }
});


// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchTrendingTokens', async (req: express.Request, res: express.Response) => {
    try {
        const { limit = 9 } = req.body ?? {};
        console.log(`[Server] Calling solscanService.fetchTrendingTokens with limit: ${limit}`);
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
        res.status(500).json({ error: 'Failed to fetch trending tokens' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchToken', async (req: express.Request, res: express.Response) => {
    try {
        const { mint } = req.body ?? {};
        if (!mint) return res.status(400).json({ error: 'Missing mint' });
        console.log(`[Server] Calling solscanService.fetchTokenDetails for mint: ${mint}`);
        const data = await solscanService.fetchTokenDetails(String(mint));
        if (data) {
            console.log(`[Server] Responding with details for token ${mint}.`);
            res.json({ data });
        } else {
            console.error(`[Server] solscanService.fetchTokenDetails for ${mint} returned null.`);
            res.status(404).json({ error: 'Token details not found.' });
        }
    } catch (err: any) {
        console.error('fetchToken route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch token' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchBondingTokens', async (req: express.Request, res: express.Response) => {
    try {
        const { limit = 20, platform } = req.body ?? {};
        console.log(`[Server] Calling solscanService.fetchLaunchpadTokens (bonding) with limit: ${limit} on platform: ${platform}`);
        const data = await solscanService.fetchLaunchpadTokens(Number(limit), platform);
        if (data) {
            console.log(`[Server] Responding with ${data.length} bonding tokens.`);
            res.json({ data });
        } else {
            console.error('[Server] solscanService.fetchLaunchpadTokens (bonding) returned null.');
            res.status(500).json({ error: 'Failed to fetch bonding tokens.' });
        }
    } catch (err: any) {
        console.error('fetchBondingTokens route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch bonding tokens' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/fetchLatestTokens', async (req: express.Request, res: express.Response) => {
    try {
        const { limit = 50 } = req.body ?? {};
        console.log(`[Server] Calling solscanService.getLatestTokens with limit: ${limit}`);
        const data = await solscanService.getLatestTokens(Number(limit));
        if (data) {
            console.log(`[Server] Responding with ${data.length} latest tokens.`);
            res.json({ data });
        } else {
            console.error('[Server] solscanService.getLatestTokens returned null.');
            res.status(500).json({ error: 'Failed to fetch latest tokens.' });
        }
    } catch (err: any) {
        console.error('fetchLatestTokens route error:', err.message);
        res.status(500).json({ error: 'Failed to fetch latest tokens' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/getTokenMetadata', async (req: express.Request, res: express.Response) => {
    try {
        const { address } = req.body ?? {};
        if (!address) return res.status(400).json({ error: 'Missing address' });
        console.log(`[Server] Calling solscanService.getTokenMetadata for address: ${address}`);
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
        res.status(500).json({ error: 'Failed to get token metadata' });
    }
});

// FIX: Use explicit Request, Response types from express to avoid global DOM type conflicts.
// FIX: Use express.Request and express.Response to prevent type conflicts with global DOM types.
app.post('/tools/getMarketInfo', async (req: express.Request, res: express.Response) => {
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

const PORT = process.env.PORT || 8787;
const server = http.createServer(app);

server.listen(PORT, () => {
    const redact = (v?: string) => (v ? `${v.slice(0, 6)}...(${v.length})` : 'undefined');
    console.log(`[server] Startup. NODE_ENV=${process.env.NODE_ENV || 'development'}`);
    console.log(`[server] SOLSCAN_API_KEY present: ${process.env.SOLSCAN_API_KEY ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
    console.log(`[server] Server is listening on http://localhost:${PORT}`);
});
