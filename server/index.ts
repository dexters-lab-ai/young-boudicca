/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
// Load environment variables BEFORE anything else
import './env';

// FIX: Aliased Request and Response to avoid type conflicts.
import express, { Request as ExpressRequest, Response as ExpressResponse, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import crypto from 'crypto';
// Monaco Protocol client imports
import { AnchorProvider, Program, Wallet, setProvider } from '@coral-xyz/anchor';
import { 
  getMarket,
  getMarketPrices,
  createOrderUiStake
} from '@monaco-protocol/client';

import { solscanService } from './services/solscan';
import Agent from './models/Agent';
import User from './models/User';
import Asset, { IAsset } from './models/Asset';
import { BackblazeService, createBackblazeServiceFromEnv } from './services/backblaze';
import { ArweavePublisher, createArweavePublisherFromEnv } from './services/arweave';
import { createCandyMachineConfigFromEnv, CandyMachineService } from './services/candyMachine';
import { createImageToVideoTask, getImageToVideoTask } from './services/sora';
import { buildAgentMetadata } from './utils/agentMetadata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const backblazeService = createBackblazeServiceFromEnv();
const arweavePublisher = createArweavePublisherFromEnv();
const candyMachineConfig = createCandyMachineConfigFromEnv();

const elevenlabs = process.env.ELEVENLABS_API_KEY
  ? new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
  : null;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';

const soraConfig = {
  apiKey: process.env.SORA_API_KEY,
  maxGenerationsPerHour: Number(process.env.SORA_MAX_PER_HOUR ?? '3'),
  cooldownMs: 60 * 60 * 1000,
};

if (!soraConfig.apiKey) {
  console.warn('[Server] SORA_API_KEY not set. Image-to-video endpoint disabled.');
}

const soraUsageMap = new Map<string, number[]>();

function registerSoraUsage(clientKey: string): { allowed: boolean; release: () => void } {
  const now = Date.now();
  const cutoff = now - soraConfig.cooldownMs;
  const timestamps = (soraUsageMap.get(clientKey) ?? []).filter(ts => ts > cutoff);

  if (timestamps.length >= soraConfig.maxGenerationsPerHour) {
    soraUsageMap.set(clientKey, timestamps);
    return { allowed: false, release: () => {} };
  }

  timestamps.push(now);
  soraUsageMap.set(clientKey, timestamps);

  const release = () => {
    const current = soraUsageMap.get(clientKey) ?? [];
    const next = current.filter(ts => ts !== now);
    if (next.length) {
      soraUsageMap.set(clientKey, next);
    } else {
      soraUsageMap.delete(clientKey);
    }
  };

  return { allowed: true, release };
}

const assetUploadMiddleware = express.raw({ type: '*/*', limit: '100mb' });

let candyMachineServicePromise: Promise<CandyMachineService> | null = null;

async function getCandyMachineService(): Promise<CandyMachineService> {
  if (!candyMachineConfig) {
    throw new Error('Candy Machine configuration missing.');
  }
  if (!candyMachineServicePromise) {
    candyMachineServicePromise = CandyMachineService.fromEnv(candyMachineConfig);
  }
  return candyMachineServicePromise;
}

// Health check endpoint
app.get('/health', (req: ExpressRequest, res: ExpressResponse) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: dbStatus,
      environment: process.env.NODE_ENV || 'development'
    });
  });
  
app.use(cors());
app.use(express.json({ limit: '25mb' }));
// --- Request Logging Middleware ---
app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
  if (req.originalUrl.startsWith('/tools') || req.originalUrl.startsWith('/api')) {
    console.log(`[Server] Incoming Request -> ${req.method} ${req.originalUrl}`);
    if (req.method === 'POST' && req.body && Object.keys(req.body).length > 0) {
      console.log(`[Server] Request Body: ${JSON.stringify(req.body)}`);
    }
  }
  next();
});

function inferImageExtension(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

async function ensureHostedImageUrls(imageUrls: string[]): Promise<string[]> {
  const hostedUrls: string[] = [];

  for (const url of imageUrls) {
    if (!url?.startsWith('data:')) {
      console.log('[Server][Sora] Using hosted image URL:', url);
      hostedUrls.push(url);
      continue;
    }

    if (!backblazeService) {
      throw new Error('Sora image-to-video requires BACKBLAZE storage when using data URLs. Configure Backblaze env vars or supply publicly accessible image URLs.');
    }

    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid data URL provided for Sora image input.');
    }

    const [, mimeType, base64Payload] = match;
    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer.length) {
      throw new Error('Empty image payload provided for Sora image input.');
    }

    const extension = inferImageExtension(mimeType);
    const fileName = `sora-inputs/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    console.log('[Server][Sora] Uploading data URL to Backblaze bucket:', fileName, 'size=', buffer.length);
    const upload = await backblazeService.uploadFile({
      fileName,
      data: buffer,
      contentType: mimeType,
      info: {
        'x-origin': 'sora-data-url',
      },
    });

    console.log('[Server][Sora] Upload successful:', upload.downloadUrl);
    hostedUrls.push(upload.downloadUrl);
  }

  console.log('[Server][Sora] Hosted image URLs prepared:', hostedUrls);
  return hostedUrls;
}

// --- Sora Endpoints ---
app.post('/api/sora/image-to-video', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!soraConfig.apiKey) {
    return res.status(503).json({ error: 'Sora integration is not configured on the server.' });
  }

  const { prompt, imageUrls, aspectRatio, removeWatermark = true } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required.' });
  }
  if (!Array.isArray(imageUrls) || !imageUrls.length) {
    return res.status(400).json({ error: 'imageUrls must be a non-empty array of URLs.' });
  }
  if (aspectRatio && !['portrait', 'landscape'].includes(aspectRatio)) {
    return res.status(400).json({ error: 'aspectRatio must be "portrait" or "landscape" if provided.' });
  }

  const clientKey = req.ip ?? req.headers['x-forwarded-for']?.toString() ?? 'unknown';
  const { allowed, release } = registerSoraUsage(clientKey);
  if (!allowed) {
    return res.status(429).json({ error: 'Hourly generation limit reached. Please try again later.' });
  }

  try {
    const hostedImageUrls = await ensureHostedImageUrls(imageUrls);
    const task = await createImageToVideoTask({
      apiKey: soraConfig.apiKey,
      prompt: prompt.trim(),
      imageUrls: hostedImageUrls,
      aspectRatio,
      removeWatermark,
    });

    res.status(202).json({ taskId: task.taskId });
  } catch (error: any) {
    release();
    console.error('[Server] Sora task creation failed:', error);
    res.status(502).json({ error: 'Failed to create Sora task.', details: error?.message ?? 'Unknown error' });
  }
});

app.get('/api/sora/image-to-video/:taskId', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!soraConfig.apiKey) {
    return res.status(503).json({ error: 'Sora integration is not configured on the server.' });
  }

  const { taskId } = req.params;
  if (!taskId) {
    return res.status(400).json({ error: 'taskId is required.' });
  }

  try {
    const record = await getImageToVideoTask({ apiKey: soraConfig.apiKey, taskId });
    res.json({ task: record });
  } catch (error: any) {
    console.error('[Server] Sora task query failed:', error);
    res.status(502).json({ error: 'Failed to fetch Sora task status.', details: error?.message ?? 'Unknown error' });
  }
});

// TTS voice interface
interface Voice {
  value: string;
  label: string;
}

// Simple TTS voices endpoint that returns a fixed set of voices
app.get('/api/tts-voices', (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/api/tts', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!elevenlabs) {
    return res.status(503).json({ error: 'TTS service not configured on the server.' });
  }
  const { text, voiceId } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }

  try {
    const voiceToUse: string = typeof voiceId === 'string' && voiceId.trim() ? voiceId : ELEVENLABS_VOICE_ID;
    const audioStream = await elevenlabs.textToSpeech.convert(voiceToUse, {
      text,
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

app.post('/api/music/compose', async (req: ExpressRequest, res: ExpressResponse) => {
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


// --- Asset Upload API ---
interface SignedPayloadRequest {
  message: string;
  signature: string;
  walletAddress: string;
}

function verifySignedPayload({ message, signature, walletAddress }: SignedPayloadRequest) {
  const publicKey = new PublicKey(walletAddress);
  const signatureBytes = bs58.decode(signature);
  const messageBytes = new TextEncoder().encode(message);
  const isVerified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());
  if (!isVerified) {
    throw new Error('Invalid signature. Wallet ownership could not be verified.');
  }
}

app.post('/api/assets/upload', assetUploadMiddleware, async (req: ExpressRequest, res: ExpressResponse) => {
  if (!backblazeService) {
    return res.status(503).json({ error: 'Asset storage not configured.' });
  }

  try {
    const { type, fileName, contentType, signature, message, walletAddress } = req.query as Record<string, string>;

    if (!type || !fileName || !contentType || !signature || !message || !walletAddress) {
      return res.status(400).json({ error: 'Missing required query parameters.' });
    }

    verifySignedPayload({ message, signature, walletAddress });

    const allowedTypes = new Set(['model', 'animation', 'background']);
    if (!allowedTypes.has(type)) {
      return res.status(400).json({ error: `Invalid asset type: ${type}` });
    }

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: 'Request body must be a binary payload.' });
    }

    const buffer = req.body as Buffer;
    if (!buffer.length) {
      return res.status(400).json({ error: 'Empty payload.' });
    }

    const safeFileName = `${Date.now()}-${crypto.randomUUID()}-${fileName}`;

    const backblazeResult = await backblazeService.uploadFile({
      fileName: safeFileName,
      data: buffer,
      contentType,
      info: {
        'x-wallet-address': walletAddress,
        'x-asset-type': type,
      },
    });

    const asset = new Asset({
      ownerWallet: walletAddress,
      type,
      fileName: backblazeResult.fileName,
      originalName: fileName,
      contentType,
      size: buffer.length,
      bucketFileId: backblazeResult.fileId,
      downloadUrl: backblazeResult.downloadUrl,
    });
    await asset.save();

    res.status(201).json({ assetId: asset._id, downloadUrl: asset.downloadUrl });
  } catch (error: any) {
    console.error('Asset upload error:', error);
    res.status(500).json({ error: error.message || 'Asset upload failed.' });
  }
});

// --- Candy Machine API ---
app.post('/api/candy-machine/create', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!candyMachineConfig) {
    return res.status(503).json({ error: 'Candy Machine not configured.' });
  }

  const { itemsAvailable, startDate } = req.body;

  if (!itemsAvailable || Number.isNaN(Number(itemsAvailable))) {
    return res.status(400).json({ error: 'itemsAvailable must be a positive number.' });
  }

  try {
    const service = await getCandyMachineService();
    const candyMachine = await service.createCandyMachine({
      itemsAvailable: Number(itemsAvailable),
      startDate: startDate ? new Date(startDate) : undefined,
    });

    res.status(201).json({
      address: candyMachine.address.toBase58(),
      itemsAvailable: Number(candyMachine.itemsAvailable),
      itemsLoaded: Number(candyMachine.itemsLoaded),
    });
  } catch (error: any) {
    console.error('Candy machine creation failed:', error);
    res.status(500).json({ error: 'Failed to create candy machine', details: error.message });
  }
});

app.post('/api/candy-machine/:address/items', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!candyMachineConfig) {
    return res.status(503).json({ error: 'Candy Machine not configured.' });
  }

  const { address } = req.params;
  const { items, walletAddress, signature, message } = req.body;

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'items array is required.' });
  }

  if (!walletAddress || !signature || !message) {
    return res.status(400).json({ error: 'walletAddress, signature, and message are required.' });
  }

  try {
    verifySignedPayload({ walletAddress, signature, message });

    const formattedItems = items.map((item: any) => ({
      name: item.name,
      uri: item.uri,
    })).filter((item: any) => item.name && item.uri);

    if (!formattedItems.length) {
      return res.status(400).json({ error: 'At least one valid item is required.' });
    }

    const service = await getCandyMachineService();
    const candyMachineAddress = new PublicKey(address);
    await service.addItems(candyMachineAddress, formattedItems);

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Candy machine add items failed:', error);
    res.status(500).json({ error: 'Failed to insert items into candy machine', details: error.message });
  }
});

app.post('/api/candy-machine/:address/mint', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!candyMachineConfig) {
    return res.status(503).json({ error: 'Candy Machine not configured.' });
  }

  const { address } = req.params;
  const { ownerWalletAddress, signature, message } = req.body;

  if (!ownerWalletAddress || !signature || !message) {
    return res.status(400).json({ error: 'ownerWalletAddress, signature, and message are required.' });
  }

  try {
    verifySignedPayload({ walletAddress: ownerWalletAddress, signature, message });

    const service = await getCandyMachineService();
    const candyMachineAddress = new PublicKey(address);
    const candyMachine = await service.loadCandyMachine(candyMachineAddress);

    if (!candyMachine) {
      return res.status(404).json({ error: 'Candy machine not found.' });
    }

    const owner = new PublicKey(ownerWalletAddress);
    const mintAddress = await service.mint(candyMachine, owner);

    res.status(200).json({ mintAddress });
  } catch (error: any) {
    console.error('Candy machine mint failed:', error);
    res.status(500).json({ error: 'Failed to mint from candy machine', details: error.message });
  }
});

// --- Agent Creator API ---
app.post('/api/agents/create', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }

  const {
    name,
    description,
    systemInstruction,
    creatorWalletAddress,
    signature,
    message,
    vrmUrl,
    vrmAssetId,
    animationGreetingUrl,
    animationDanceUrl,
    animationSpinUrl,
    animationPoseUrl,
    animationPumpedUrl,
    environmentUrl,
  } = req.body;

  if (!name || !description || !systemInstruction || !creatorWalletAddress || !signature || !message) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!vrmUrl) {
    return res.status(400).json({ error: 'VRM URL is required.' });
  }

  try {
    verifySignedPayload({ message, signature, walletAddress: creatorWalletAddress });

    const animations: Record<string, string> = {
      greeting: animationGreetingUrl,
      dance: animationDanceUrl,
      spin: animationSpinUrl,
      pose: animationPoseUrl,
      pumped: animationPumpedUrl,
    };

    let linkedAsset: IAsset | null = null;
    if (vrmAssetId) {
      linkedAsset = await Asset.findById(vrmAssetId);
      if (!linkedAsset) {
        return res.status(400).json({ error: 'Referenced VRM asset not found.' });
      }
      if (linkedAsset.ownerWallet !== creatorWalletAddress) {
        return res.status(403).json({ error: 'Asset owner mismatch.' });
      }
    }

    let metadataUri: string | undefined;
    if (arweavePublisher) {
      const metadataPayload = buildAgentMetadata({
        name,
        description,
        systemInstruction,
        creatorWalletAddress,
        vrmSource: {
          url: vrmUrl,
          contentType: linkedAsset?.contentType || 'application/octet-stream',
          asset: linkedAsset || undefined,
        },
        animations,
        environmentUrl,
      });

      metadataUri = await arweavePublisher.uploadJson(metadataPayload);
    } else {
      console.warn('Arweave publisher not configured; skipping metadata upload.');
    }

    const simulatedMintAddress = new PublicKey(crypto.randomBytes(32)).toBase58();

    const agent = new Agent({
      name,
      description,
      systemInstruction,
      creatorWalletAddress,
      vrmUrl,
      vrmAssetId: linkedAsset?._id,
      animationGreetingUrl,
      animationDanceUrl,
      animationSpinUrl,
      animationPoseUrl,
      animationPumpedUrl,
      environmentUrl,
      nftDetails: {
        mintAddress: simulatedMintAddress,
        metadataUri: metadataUri || '',
        tokenStandard: 'Metaplex',
      },
    });

    await agent.save();

    res.status(201).json(agent);
  } catch (error: any) {
    console.error('Agent creation error:', error);
    res.status(500).json({ error: 'Failed to create agent', details: error.message });
  }
});

app.put('/api/agents/:agentId/visibility', async (req: ExpressRequest, res: ExpressResponse) => {
    const { agentId } = req.params;
    const { isPublic, creatorWalletAddress, signature, message } = req.body;

    if (isPublic === undefined || !creatorWalletAddress || !signature || !message) {
        return res.status(400).json({ error: 'Missing required fields for visibility toggle.' });
    }

    try {
        const agent = await Agent.findById(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found.' });
        }

        const publicKey = new PublicKey(creatorWalletAddress);
        const signatureBytes = bs58.decode(signature);
        const messageBytes = new TextEncoder().encode(message);
        const isVerified = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey.toBytes());

        if (!isVerified || agent.creatorWalletAddress !== creatorWalletAddress) {
            return res.status(403).json({ error: 'Wallet ownership could not be verified or does not match creator.' });
        }

        agent.isPublic = !!isPublic;
        await agent.save();
        res.status(200).json(agent);

    } catch (err: any) {
        console.error('Visibility toggle error:', err);
        res.status(500).json({ error: 'Failed to update agent visibility.' });
    }
});


app.get('/api/agents/list', async (req: ExpressRequest, res: ExpressResponse) => {
  if (!process.env.MONGODB_URI) {
    return res.status(503).json({ error: 'Database not configured.' });
  }
  try {
    const agents = await Agent.find({ isPublic: true }).sort({ createdAt: -1 });
    res.json(agents);
  } catch (err) {
    console.error('List agents error', err);
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

app.get('/api/agents/creator/:walletAddress', async (req: ExpressRequest, res: ExpressResponse) => {
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

// --- User & Subscription API ---

const findOrCreateUser = async (walletAddress: string) => {
    let user = await User.findOne({ walletAddress });
    if (!user) {
        user = new User({ walletAddress });
        await user.save();
    }
    return user;
};

app.get('/api/users/wallet-balance', async (req: ExpressRequest, res: ExpressResponse) => {
    const { walletAddress } = req.query;
    if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ isSufficient: false, error: 'Wallet address is required.' });
    }

    try {
        // This is a placeholder/simulation. In a real app, you would query the Solana blockchain.
        const balance = await solscanService.getAccountTokenBalance(walletAddress);
        // Gate is $10 USDC. Tokens have 6 decimals.
        const isSufficient = balance >= 10 * 1_000_000; 
        res.json({ isSufficient });
    } catch (error: any) {
        console.error("Failed to get wallet balance:", error);
        res.status(500).json({ error: 'Failed to fetch wallet balance.' });
    }
});

app.get('/api/users/subscription-status/:agentId', async (req: ExpressRequest, res: ExpressResponse) => {
    const { agentId } = req.params;
    const { walletAddress } = req.query;

    if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ isSubscribed: false, error: 'Wallet address is required.' });
    }

    try {
        const user = await User.findOne({ walletAddress });
        if (!user) {
            return res.json({ isSubscribed: false });
        }

        const subscription = user.subscribedAgents.find(sub => sub.agent.toString() === agentId);
        
        if (subscription && subscription.expiresAt > new Date()) {
            return res.json({ isSubscribed: true, expiresAt: subscription.expiresAt });
        }
        
        // Clean up expired subscriptions
        user.subscribedAgents = user.subscribedAgents.filter(sub => sub.expiresAt > new Date());
        await user.save();

        return res.json({ isSubscribed: false });
    } catch (err: any) {
        console.error('Subscription status error:', err);
        res.status(500).json({ error: 'Failed to check subscription status.' });
    }
});

app.post('/api/subscribe/:agentId', async (req: ExpressRequest, res: ExpressResponse) => {
    const { agentId } = req.params;
    const { walletAddress, txSignature } = req.body;

    if (!walletAddress || !txSignature) {
        return res.status(400).json({ error: 'Wallet address and transaction signature are required.' });
    }
    
    // In a real application, you would use the txSignature to query the Solana RPC
    // and verify the transaction details (sender, receiver, amount, token).
    // For this simulation, we assume the transaction is valid.
    console.log(`[Server] Simulating verification for tx: ${txSignature}`);
    const isTxVerified = true; 
    
    if (!isTxVerified) {
        return res.status(400).json({ error: 'Transaction could not be verified.' });
    }

    try {
        const agent = await Agent.findById(agentId);
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found.' });
        }

        const user = await findOrCreateUser(walletAddress);
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7); // 1 week subscription

        const existingSubIndex = user.subscribedAgents.findIndex(sub => sub.agent.toString() === agentId);

        if (existingSubIndex > -1) {
            // Extend existing subscription
            user.subscribedAgents[existingSubIndex].expiresAt = expiresAt;
        } else {
            // Add new subscription
            user.subscribedAgents.push({ agent: agent._id as mongoose.Types.ObjectId, expiresAt });
            // Increment the agent's subscriber count
            agent.subscriptionCount = (agent.subscriptionCount || 0) + 1;
            await agent.save();
        }

        await user.save();
        res.status(200).json({ success: true, message: 'Subscribed successfully.', expiresAt });
    } catch (err: any) {
        console.error('Subscription error:', err);
        res.status(500).json({ error: 'Failed to process subscription.' });
    }
});

// --- Monaco Protocol ---

const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

// Initialize the Monaco program
const wallet = new Wallet(Keypair.generate()); // Using a dummy wallet for read-only operations
const provider = new AnchorProvider(connection, wallet, {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed'
});
setProvider(provider);

// Monaco program ID (mainnet)
const MONACO_PROGRAM_ID = new PublicKey('monacoUXKtUi6vKsQwaLyxmXKSievfNWEcYXTgkbCih');

// Type definitions for Monaco Protocol
interface MarketAccount {
    marketStatus: {
        open?: {};
        [key: string]: any;
    };
    title: string;
    [key: string]: any;
}

interface Market {
    publicKey: PublicKey;
    account: MarketAccount;
}

interface OrderAccount {
    publicKey: PublicKey;
    account: {
        purchaser: PublicKey;
        market: PublicKey;
        marketOutcomeIndex: number;
        orderStatus: {
            [key: string]: any;
        };
        stake: { toNumber: () => number };
        payout: { toNumber: () => number };
        [key: string]: any;
    };
}

// Import Monaco Protocol's MarketPrice type
import type { MarketPrice } from '@monaco-protocol/client/types/market';

// Extend the MarketPrice interface with any additional properties we need
interface CustomMarketPrice extends MarketPrice {
    // Add any additional properties here if needed
    [key: string]: any;
}

// Initialize the program using Program.at() which fetches the IDL from the chain
let monacoProgram: any;

// Initialize the program in an async function
const initProgram = async () => {
  try {
    monacoProgram = await Program.at(MONACO_PROGRAM_ID, provider);
    console.log('Monaco program initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Monaco program:', error);
    throw error;
  }
};

// Call the initialization
initProgram().catch((error: Error) => {
    console.error('Error initializing Monaco program:', error);
});

app.get('/api/monaco/markets', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const allMarkets: Market[] = await monacoProgram.account.market.all();
        const openMarkets = allMarkets.filter((market) => 'open' in market.account.marketStatus);
        const markets = openMarkets.map((market: Market) => ({
            id: market.publicKey.toBase58(),
            ...market.account
        }));
        res.json({ markets });
    } catch (error) {
        console.error('Failed to fetch Monaco markets:', error);
        res.status(500).json({ error: 'Failed to fetch markets from Monaco Protocol.' });
    }
});

app.get('/api/monaco/market/:marketPk', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { marketPk } = req.params;
        const marketPublicKey = new PublicKey(marketPk);

        const marketPromise = getMarket(monacoProgram, marketPublicKey);
        const pricesPromise = getMarketPrices(monacoProgram, marketPublicKey);

        const [marketResponse, pricesResponse] = await Promise.all([marketPromise, pricesPromise]);

        if (!marketResponse.success || !pricesResponse.success) {
            throw new Error('Failed to fetch market details or prices.');
        }

        const { title, ...accountWithoutTitle } = marketResponse.data.account;
        const market = {
            id: marketResponse.data.publicKey.toBase58(),
            title,  // This is the same as title: title
            ...accountWithoutTitle,
        };

        const outcomes = pricesResponse.data.marketPrices.map((priceInfo) => ({
            id: priceInfo.marketOutcomeIndex,
            title: priceInfo.marketOutcome,
            odds: (priceInfo as any).againstPrices[0]?.price || 0,
        }));
        
        res.json({ market, outcomes });
    } catch (error: any) {
        console.error(`Failed to fetch Monaco market details for ${req.params.marketPk}:`, error);
        res.status(500).json({ error: 'Failed to fetch market details from Monaco Protocol.', details: error.message });
    }
});


const placeOrderHandler = async (req: ExpressRequest, res: ExpressResponse) => {
    const { marketPk, outcomeIndex, forAgainst, amount, walletAddress } = req.body;
    if (marketPk === undefined || outcomeIndex === undefined || forAgainst === undefined || amount === undefined || !walletAddress) {
        return res.status(400).json({ error: 'Missing required fields for placing an order.' });
    }

    try {
        const marketPublicKey = new PublicKey(marketPk);
        const purchaserPublicKey = new PublicKey(walletAddress);
        const stake = amount;
        
        const marketPrices = await getMarketPrices(monacoProgram, marketPublicKey);
        const price = forAgainst === 'for' 
            ? (marketPrices.data.marketPrices[outcomeIndex] as any).againstPrices[0]?.price || 1.1
            : (marketPrices.data.marketPrices[outcomeIndex] as any).forPrices[0]?.price || 1.1;

        const orderTx = await createOrderUiStake(monacoProgram, marketPublicKey, outcomeIndex, forAgainst === 'for', stake, price, purchaserPublicKey);

        const { blockhash } = await connection.getLatestBlockhash();
        (orderTx.data as any).transaction.recentBlockhash = blockhash;
        (orderTx.data as any).transaction.feePayer = purchaserPublicKey;

        const serializedTransaction = (orderTx.data as any).transaction
            .serialize({ requireAllSignatures: false, verifySignatures: false })
            .toString('base64');
        
        res.json({ serializedTransaction });

    } catch (error: any) {
        console.error("Order placement error:", error);
        res.status(500).json({ error: 'Failed to create order transaction.', details: error.message });
    }
};

app.post('/api/monaco/orders/place', placeOrderHandler);

app.get('/api/monaco/orders/user/:walletAddress', async (req: ExpressRequest, res: ExpressResponse) => {
    const { walletAddress } = req.params;
    try {
        const allOrders: OrderAccount[] = await monacoProgram.account.order.all();
        const orderAccounts = allOrders.filter((o: OrderAccount) => o.account.purchaser.toBase58() === walletAddress);

        if (orderAccounts.length === 0) {
            return res.json({ bets: [] });
        }

        // Get unique market PKs to fetch market details efficiently
        const marketPks: PublicKey[] = Array.from(
            new Set(
                orderAccounts
                    .map(o => o.account.market)
                    .filter((market): market is PublicKey => market instanceof PublicKey)
            )
        );
        
        // Create promises for market details and prices with proper type safety
        const marketDetailsPromises = marketPks.map((marketPk: PublicKey) => 
            getMarket(monacoProgram, marketPk)
        );
        const marketPricesPromises = marketPks.map((marketPk: PublicKey) => 
            getMarketPrices(monacoProgram, marketPk)
        );

        const marketDetailsResponses = await Promise.all(marketDetailsPromises);
        const marketPricesResponses = await Promise.all(marketPricesPromises);
        
        interface MarketData {
            account: {
                title: string;
                [key: string]: any;
            };
prices: CustomMarketPrice[];
        }
        
        const marketsMap = new Map<string, MarketData>();
        marketDetailsResponses.forEach((response: { success: boolean; data: { publicKey: { toBase58: () => string; }; account: any; }; }, index: number) => {
            if (response.success) {
                const pk = response.data.publicKey.toBase58();
                const pricesResponse = marketPricesResponses[index];
                const prices = pricesResponse.success ? pricesResponse.data.marketPrices : [];
                marketsMap.set(pk, { account: response.data.account, prices });
            }
        });

        // Enrich orders with market details
        const enrichedBets = orderAccounts.map((order: OrderAccount) => {
            const marketPk = order.account.market.toBase58();
            const marketData = marketsMap.get(marketPk);
            
            if (!marketData) {
                return null;
            }

            const { account: market, prices } = marketData;

            const outcome = prices.find((p: MarketPrice) => p.marketOutcomeIndex === order.account.marketOutcomeIndex);
            const outcomeTitle = outcome ? outcome.marketOutcome : `Outcome #${order.account.marketOutcomeIndex}`;
            
            const stake = order.account.stake.toNumber() / 1_000_000; // Assuming 6 decimals for USDC
            const payout = order.account.payout.toNumber() / 1_000_000;
            
            return {
                id: order.publicKey.toBase58(),
                marketTitle: market.title,
                outcomeTitle: outcomeTitle,
                stake: stake,
                payout: payout,
                status: Object.keys(order.account.orderStatus)[0], // e.g., 'matched', 'open'
            };
        }).filter(Boolean);

        res.json({ bets: enrichedBets });

    } catch (err: any) {
        console.error('Failed to fetch user orders:', err);
        res.status(500).json({ error: 'Failed to fetch user orders.', details: err.message });
    }
});


// --- Solana Tools (Solscan-backed) ---

app.post('/tools/fetchTokenList', async (req: ExpressRequest, res: ExpressResponse) => {
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


app.post('/tools/fetchTrendingTokens', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/fetchToken', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/fetchBondingTokens', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/fetchLatestTokens', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/getTokenMetadata', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/getMarketInfo', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/fetchCandles', async (req: ExpressRequest, res: ExpressResponse) => {
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

app.post('/tools/listMonacoMarkets', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { marketStatus = 'open' } = req.body ?? {};
        const allMarkets = await monacoProgram.account.market.all();
        const openMarkets = allMarkets.filter((market: Market) => 'open' in market.account.marketStatus);
        const markets = openMarkets.map((market: Market) => ({
            id: market.publicKey.toBase58(),
            ...market.account
        }));
        res.json({ data: markets });
    } catch (err: any) {
        console.error('listMonacoMarkets tool error:', err);
        res.status(500).json({ error: 'Failed to fetch markets.' });
    }
});

app.post('/tools/getMonacoMarketDetails', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { marketPk } = req.body ?? {};
        if (!marketPk) return res.status(400).json({ error: 'Missing marketPk' });
        
        const marketPublicKey = new PublicKey(marketPk);

        const marketPromise = getMarket(monacoProgram, marketPublicKey);
        const pricesPromise = getMarketPrices(monacoProgram, marketPublicKey);

        const [marketResponse, pricesResponse] = await Promise.all([marketPromise, pricesPromise]);

        if (!marketResponse.success || !pricesResponse.success) {
            throw new Error('Failed to fetch market details or prices.');
        }

        const { title, ...accountWithoutTitle } = marketResponse.data.account;
        const market = {
            id: marketResponse.data.publicKey.toBase58(),
            title,  // This is the same as title: title
            ...accountWithoutTitle,
        };

        const outcomes = pricesResponse.data.marketPrices.map((priceInfo) => ({
            id: priceInfo.marketOutcomeIndex,
            title: priceInfo.marketOutcome,
            odds: (priceInfo as any).againstPrices[0]?.price || 0,
        }));
        
        res.json({ data: { market, outcomes } });

    } catch (err: any) {
        console.error('getMonacoMarketDetails tool error:', err);
        res.status(500).json({ error: 'Failed to fetch market details' });
    }
});

// This endpoint is for AI tool-based betting
app.post('/tools/placeMonacoOrder', placeOrderHandler);

app.post('/tools/listUserMonacoOrders', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const { walletAddress } = req.body ?? {};
        if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
        
        const allOrders = await monacoProgram.account.order.all();
        const userOrders = allOrders.filter((o: OrderAccount) => o.account.purchaser.toBase58() === walletAddress);
        res.json({ data: userOrders });
    } catch (err: any) {
        console.error('listUserMonacoOrders tool error:', err);
        res.status(500).json({ error: 'Failed to fetch user orders.' });
    }
});

const PORT = process.env.PORT || 8787;
const server = http.createServer(app);

server.listen(PORT, () => {
    const redact = (v?: string) => (v ? `${v.slice(0, 6)}...(${v.length})` : 'undefined');
    console.log(`[server] Startup. NODE_ENV=${process.env.NODE_ENV || 'development'}`);
    console.log(`[server] SOLSCAN_API_KEY present: ${process.env.SOLSCAN_API_KEY ? 'YES' : 'NO'} (${redact(process.env.SOLSCAN_API_KEY)})`);
    console.log(`[server] Server is listening on http://0.0.0.0:${PORT}`);
});

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });
  
  // Add error handling for unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
  });
  
  // Add error handling for the server
  server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
  });

  
// Serve static files from the 'dist' directory (Vite's default output directory)
// Serve static files from the 'dist' directory (Vite's default output directory)
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  try {
    // Serve static files
    app.use(express.static(distPath));
    
    // Handle SPA routing - return index.html for all other routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'), (err) => {
        if (err) {
          console.error('Error sending file:', err);
          res.status(500).send('Error loading the application');
        }
      });
    });
  } catch (error) {
    console.error('Error setting up static file serving:', error);
    // Don't exit, let the server continue running
  }
} else {
  console.warn('Frontend build not found. Run `npm run build` in the frontend directory.');
}  