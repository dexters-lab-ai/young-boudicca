import './env'; // Ensure env vars are loaded
import { Worker, Job } from 'bullmq';
import mongoose from 'mongoose';
// DOC: Use GoogleGenAI instead of GoogleGenerativeAI
import { GoogleGenAI } from '@google/genai';

import { redis as redisConnection, pubClient } from './queue';
import User from './models/User';
import Agent from './models/Agent';
import AutonomyLog from './models/AutonomyLog';
import ChatHistory from './models/ChatHistory';

const MONOLOGUE_PROMPT = `
You are an AI companion. The user you are talking to has been idle for a while.
Based on the last few messages of your conversation history below, generate a short, proactive, and engaging monologue (1-2 sentences) to re-engage the user.
Your monologue should be in character and relevant to the ongoing conversation. It could be a thought, a question, or a new idea.
Do not greet the user or say anything like "Are you still there?". Just continue the conversation naturally.

Conversation History:
---
`;

// DOC: Use GoogleGenAI instead of GoogleGenerativeAI
const ai = process.env.API_KEY ? new GoogleGenAI({ apiKey: process.env.API_KEY }) : null;

const IDLE_THRESHOLD_SECONDS = 30; // 30 seconds
const ONLINE_THRESHOLD_MINUTES = 2;

const processJob = async (job: Job) => {
    const { walletAddress } = job.data;
    console.log(`[Worker] Processing job for wallet: ${walletAddress}`);

    if (!ai) {
        console.error('[Worker] AI not initialized. Skipping job.');
        return;
    }

    try {
        const user = await User.findOne({ walletAddress });
        if (!user || !user.autonomyEnabled) {
            console.log(`[Worker] Autonomy disabled for ${walletAddress}. Skipping.`);
            return;
        }

        const lastInteractionTime = await redisConnection.get(`lastInteraction:${walletAddress}`);
        const now = Date.now();

        if (lastInteractionTime && (now - parseInt(lastInteractionTime, 10)) < (IDLE_THRESHOLD_SECONDS * 1000)) {
            console.log(`[Worker] User ${walletAddress} is not idle. Skipping monologue.`);
            return;
        }

        // --- Generate Monologue ---
        const agent = await Agent.findOne({ isPublic: true }).sort({ subscriptionCount: -1 }); // simplistic: pick most popular agent
        if (!agent) {
            console.log('[Worker] No agent found to generate monologue.');
            return;
        }
        
        const chatHistory = await ChatHistory.findOne({ walletAddress });
        const historyText = chatHistory?.history.slice(-10).map(m => `${m.role}: ${m.text}`).join('\n') || 'User: Hi there!\nAssistant: Hello! How can I help you today?';

        const monologueResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: MONOLOGUE_PROMPT + historyText,
             config: {
                systemInstruction: agent.systemInstruction,
            },
        });

        const monologueText = monologueResponse.text;
        if (!monologueText) {
            console.log('[Worker] Generated empty monologue. Skipping.');
            return;
        }
        
        console.log(`[Worker] Generated monologue for ${walletAddress}: "${monologueText}"`);

        // --- Check if user is online and deliver ---
        const isOnline = (now - user.lastSeen.getTime()) < (ONLINE_THRESHOLD_MINUTES * 60 * 1000);

        if (isOnline) {
            console.log(`[Worker] User ${walletAddress} is online. Publishing to Redis.`);
            await pubClient.publish('agent-monologues', JSON.stringify({
                walletAddress,
                text: monologueText,
                agentName: agent.name
            }));
        } else {
            console.log(`[Worker] User ${walletAddress} is offline. Saving to AutonomyLog.`);
            const log = new AutonomyLog({
                walletAddress,
                agentId: agent._id,
                actionType: 'MONOLOGUE',
                text: monologueText,
            });
            await log.save();
        }

    } catch (error) {
        console.error(`[Worker] Error processing job for ${walletAddress}:`, error);
    }
};

const startWorker = async () => {
    if (process.env.MONGODB_URI) {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('[Worker] MongoDB connected.');
    } else {
        console.error('[Worker] MONGODB_URI not found. Worker cannot start.');
        process.exit(1);
    }

    const worker = new Worker('agent-jobs', processJob, {
        connection: redisConnection,
        concurrency: 5, // Process up to 5 jobs concurrently
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
    });

    worker.on('completed', job => {
        if(job) {
            console.log(`[Worker] Job ${job.id} has completed for ${job.data.walletAddress}`);
        }
    });

    worker.on('failed', (job, err) => {
        if (job) {
            console.error(`[Worker] Job ${job.id} for ${job.data.walletAddress} failed with error: ${err.message}`);
        }
    });

    console.log('[Worker] Agent worker started and listening for jobs...');
};

startWorker().catch(err => {
    console.error('[Worker] Failed to start:', err);
    process.exit(1);
});