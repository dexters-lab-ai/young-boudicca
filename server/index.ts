/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// Load environment variables BEFORE anything else
import './env';

// FIX: Explicitly import express types to avoid conflict with global DOM types.
// FIX: Aliased Request and Response to avoid conflict with global DOM types.
// FIX: Refactore'd to use express namespace to prevent type conflicts with global DOM types.
// FIX: Import Request, Response, and NextFunction types directly from express to resolve conflicts with global DOM types.
import express from 'express';
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
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import { solscanService } from './services/solscan';
import Agent from './models/Agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// --- Request Logging Middleware ---
// FIX: Use express namespace for types to avoid conflict with global DOM types.
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.originalUrl.startsWith('/tools') || req.originalUrl.startsWith('/api')) {
    console.log(`[Server] Incoming Request -> ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
      console.log(`[Server] Request Body: ${JSON.stringify(req.body)}`);
    }
  }
  next();
});

// ElevenLabs TTS configuration
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default voice ID

let elevenlabs: ElevenLabsClient | null = null;
if (ELEVENLABS_API_KEY) {
  elevenlabs = new ElevenLabsClient({ apiKey: ELEVENLABS_API_KEY });
  console.log('[Server] ElevenLabs client initialized.');
} else {
  console.warn('ELEVENLABS_API_KEY not found. TTS and Music endpoints will be disabled.');
}


// TTS voice interface
interface Voice {
  value: string;
  label: string;
}

// Simple TTS voices endpoint that returns a fixed set of voices
// FIX: Use express namespace for types to avoid conflict with global DOM types.
app.get('/api/tts-voices', (req: express.Request, res: express.Response) => {
  const voices: Voice[] = [
    { value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel' },
    { value: 'AZnzlk1XvdvUeBnXmlld', label: 'Domi' },
    { value: 'EXAVITQu4vr4xnSDxMaL', label: 'Bella' },
    { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
    { value: 'MF3mGyEYCl7XYWbV9V6O', label: 'Elli' },
    { value: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
    { value: 'VR6AewLTigWG4xSOukaG', label: 'Arnold' },
    { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
    { value: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
  ];
  
  res.json({ voices, lastLoaded: Date.now() });
});

// FIX: Use express namespace for types to avoid conflict with global DOM types.
app.post('/api/tts', async (req: express.Request, res: express.Response) => {
  if (!elevenlabs) {
    return res.status(503).json({ error: 'TTS service not configured on the server.' });
  }
  const { text, voiceId = ELEVENLABS_VOICE_ID } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }

  try {
    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
      text,
      // FIX: Corrected property name from model_id to modelId
      modelId: 'eleven_multilingual_v2',
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    
    // Pipe the stream to the response
    const reader = audioStream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (error: any) {
    console.error('ElevenLabs API error:', error);
    res.status(500).json({ error: 'Failed to synthesize speech', details: error.message });
  }
});

// FIX: Use express namespace for types to avoid conflict with global DOM types.
app.post('/api/music/compose', async (req: express.Request, res: express.Response) => {
    if (!elevenlabs) {
        return res.status(503).json({ error: 'Music service not configured on the server.' });
    }
    const { prompt } = req.body;
    if (!prompt) {
        return res.status(400).json({ error: 'A music prompt is required.' });
    }

    try {
        const audioStream = await elevenlabs.music.compose({
            prompt,
            musicLengthMs: 60000, // Generate 60 seconds of music
        });

        res.setHeader('Content-Type', 'audio/mpeg');

        const reader = audioStream.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();
    } catch (error: any) {
        console.error('ElevenLabs Music API error:', error);
        res.status(500).json({ error: 'Failed to generate music', details: error.message });
    }
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




// --- Agent Creator API ---
// FIX: Use express namespace for types to avoid conflict with global DOM types.
app.post('/api/agents/create', upload.single('vrmFile'), async (req: express.Request, res: express.Response) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }
  try {
    const { 
        name, description, systemInstruction, creatorWalletAddress, signature, message, 
        vrmUrl: bodyVrmUrl,
        animationGreetingUrl,
        animationDanceUrl,
        animationSpinUrl,
        animationPoseUrl,
        animationPumpedUrl,
        environmentUrl,
    } = req.body;
    
    if (!name || !description || !systemInstruction || !creatorWalletAddress || !signature || !message) {
      return res.status(400).json({ error: 'Missing required text fields or signature.' });
    }
    
    const vrmUrl = req.file ? `/uploads/${req.file.filename}` : bodyVrmUrl;

    if (!vrmUrl) {
      return res.status(400).json({ error: 'A VRM model file or URL is required.' });
    }

    // --- Signature Verification ---
    const publicKey = new PublicKey(creatorWalletAddress);
    const signatureBytes = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);

    const isVerified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());

    if (!isVerified) {
      return res.status(403).json({ error: 'Invalid signature. Wallet ownership could not be verified.' });
    }
    // --- End Signature Verification ---

    const newAgent = new Agent({
      name,
      description,
      systemInstruction,
      creatorWalletAddress,
      vrmUrl,
      animationGreetingUrl: animationGreetingUrl || undefined,
      animationDanceUrl: animationDanceUrl || undefined,
      animationSpinUrl: animationSpinUrl || undefined,
      animationPoseUrl: animationPoseUrl || undefined,
      animationPumpedUrl: animationPumpedUrl || undefined,
      environmentUrl: environmentUrl || undefined,
    });
    await newAgent.save();
    res.status(201).json(newAgent);
  } catch (err: any) {
    console.error('Agent creation error', err);
    res.status(500).json({ error: 'Failed to create agent', details: err.message });
  }
});

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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
// FIX: Use express namespace for types to avoid conflict with global DOM types.
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


// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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

// FIX: Use express namespace for types to avoid conflict with global DOM types.
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