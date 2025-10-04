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
import mongoose from 'mongoose';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import * as fs from 'fs';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
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
  const { text, voiceId = ELEVENLABS_VOICE_ID } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required.' });
  }

  try {
    const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
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

// --- File Uploads (Multer) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsPath = path.join(__dirname, '..', 'public', 'uploads');
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
app.post('/api/agents/create', upload.single('vrmFile'), async (req: ExpressRequest, res: ExpressResponse) => {
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

    // --- SIMULATED NFT MINTING ---
    const simulatedMintAddress = new PublicKey(crypto.randomBytes(32)).toBase58();
    const randomBytes = crypto.randomBytes(32);
const metadataUri = `https://arweave.net/${bs58.encode(new Uint8Array(randomBytes.buffer, randomBytes.byteOffset, randomBytes.length)).slice(0, 43)}`;
    const nftDetails = {
        mintAddress: simulatedMintAddress,
        metadataUri: metadataUri,
        tokenStandard: 'Metaplex',
    };
    // --- END SIMULATION ---

    const newAgent = new Agent({
      name,
      description,
      systemInstruction,
      creatorWalletAddress,
      vrmUrl,
      nftDetails, // Add the simulated NFT details
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
initProgram().catch(console.error);

app.get('/api/monaco/markets', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const allMarkets = await monacoProgram.account.market.all();
        const openMarkets = allMarkets.filter(m => 'open' in m.account.marketStatus);
        const markets = openMarkets.map(m => ({
            id: m.publicKey.toBase58(),
            title: m.account.title,
            ...m.account,
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
        const allOrders = await monacoProgram.account.order.all();
        const orderAccounts = allOrders.filter(o => o.account.purchaser.toBase58() === walletAddress);

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
        const marketDetailsPromises = marketPks.map(marketPk => 
            getMarket(monacoProgram, marketPk)
        );
        const marketPricesPromises = marketPks.map(marketPk => 
            getMarketPrices(monacoProgram, marketPk)
        );

        const marketDetailsResponses = await Promise.all(marketDetailsPromises);
        const marketPricesResponses = await Promise.all(marketPricesPromises);
        
        const marketsMap = new Map<string, any>();
        marketDetailsResponses.forEach((response, index) => {
            if (response.success) {
                const pk = response.data.publicKey.toBase58();
                const pricesResponse = marketPricesResponses[index];
                const prices = pricesResponse.success ? pricesResponse.data.marketPrices : [];
                marketsMap.set(pk, { account: response.data.account, prices });
            }
        });

        // Enrich orders with market details
        const enrichedBets = orderAccounts.map(order => {
            const marketPk = order.account.market.toBase58();
            const marketData = marketsMap.get(marketPk);
            
            if (!marketData) {
                return null;
            }

            const { account: market, prices } = marketData;

            const outcome = prices.find((p: any) => p.marketOutcomeIndex === order.account.marketOutcomeIndex);
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
        const openMarkets = allMarkets.filter(m => marketStatus in m.account.marketStatus);
        const markets = openMarkets.map(m => ({
            id: m.publicKey.toBase58(),
            title: m.account.title,
            ...m.account,
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
        const userOrders = allOrders.filter(o => o.account.purchaser.toBase58() === walletAddress);
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
