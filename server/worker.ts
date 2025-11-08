import './env'; // Ensure env vars are loaded first
import { Worker, Job } from 'bullmq';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';

// Add worker startup logging
console.log(`[${new Date().toISOString()}] [Worker] Starting worker process...`);
console.log(`[${new Date().toISOString()}] [Worker] Process ID: ${process.pid}`);
console.log(`[${new Date().toISOString()}] [Worker] Node.js version: ${process.version}`);

// Track worker metrics
const workerMetrics = {
  jobsProcessed: 0,
  jobsFailed: 0,
  lastJobTime: null as Date | null,
  startTime: new Date(),
};

// Log memory usage periodically
setInterval(() => {
  const memory = process.memoryUsage();
  console.log(`[${new Date().toISOString()}] [Worker] Memory: RSS=${Math.round(memory.rss / 1024 / 1024)}MB, ` +
    `Heap=${Math.round(memory.heapUsed / 1024 / 1024)}MB/${Math.round(memory.heapTotal / 1024 / 1024)}MB`);
}, 30000);

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
    const jobStart = Date.now();
    const { walletAddress } = job.data;
    
    workerMetrics.jobsProcessed++;
    workerMetrics.lastJobTime = new Date();
    
    console.log(`[${new Date().toISOString()}] [Worker] Starting job #${workerMetrics.jobsProcessed} for wallet: ${walletAddress}`);
    console.log(`[${new Date().toISOString()}] [Worker] Job data:`, JSON.stringify(job.data, null, 2));

    if (!ai) {
        const errorMsg = 'AI not initialized. Check API_KEY environment variable.';
        console.error(`[${new Date().toISOString()}] [Worker] ${errorMsg}`);
        workerMetrics.jobsFailed++;
        throw new Error(errorMsg);
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

// Initialize and start the worker
const startWorker = async () => {
  try {
    // Close existing worker if any
    if (worker) {
      await worker.close();
      worker = null;
    }
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

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  console.log(`[${new Date().toISOString()}] [Worker] Received ${signal}. Starting graceful shutdown...`);
  
  const shutdownStart = Date.now();
  const shutdownTimeout = 10000; // 10 seconds max for shutdown
  
  const shutdownTimer = setTimeout(() => {
    console.error(`[${new Date().toISOString()}] [Worker] Shutdown timed out after ${shutdownTimeout}ms. Forcing exit.`);
    process.exit(1);
  }, shutdownTimeout);
  
  try {
    // Close worker
    if (worker) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing worker...`);
      try {
        await worker.close(true); // true = wait for active jobs to complete
        console.log(`[${new Date().toISOString()}] [Worker] Worker closed successfully`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [Worker] Error closing worker:`, error);
      }
    }
    
    // Close Redis connection
    if (pubClient) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing Redis connection...`);
      try {
        await pubClient.quit();
        console.log(`[${new Date().toISOString()}] [Worker] Redis connection closed`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [Worker] Error closing Redis connection:`, error);
      }
    }
    
    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing MongoDB connection...`);
      try {
        await mongoose.connection.close();
        console.log(`[${new Date().toISOString()}] [Worker] MongoDB connection closed`);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] [Worker] Error closing MongoDB connection:`, error);
      }
    }
    
    const shutdownTime = Date.now() - shutdownStart;
    console.log(`[${new Date().toISOString()}] [Worker] Shutdown completed in ${shutdownTime}ms`);
    
    // Log final metrics
    console.log(`[${new Date().toISOString()}] [Worker] Final metrics:`, JSON.stringify({
      totalJobs: workerMetrics.jobsProcessed,
      failedJobs: workerMetrics.jobsFailed,
      successRate: ((workerMetrics.jobsProcessed - workerMetrics.jobsFailed) / (workerMetrics.jobsProcessed || 1) * 100).toFixed(2) + '%',
      uptime: Math.round((Date.now() - workerMetrics.startTime.getTime()) / 1000) + 's',
      lastJobTime: workerMetrics.lastJobTime?.toISOString() || 'N/A'
    }, null, 2));
    
    clearTimeout(shutdownTimer);
    process.exit(0);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [Worker] Fatal error during shutdown:`, error);
    clearTimeout(shutdownTimer);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] [Worker] Uncaught Exception:`, error);
  // Don't exit immediately to allow for cleanup
  setTimeout(() => process.exit(1), 5000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] [Worker] Unhandled Rejection at:`, promise, 'reason:', reason);
  workerMetrics.jobsFailed++;
});

// Handle shutdown signals
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => {
  process.on(signal, () => {
    console.log(`[${new Date().toISOString()}] [Worker] Received ${signal}`);
    gracefulShutdown(signal).catch(err => {
      console.error(`[${new Date().toISOString()}] [Worker] Error during shutdown:`, err);
      process.exit(1);
    });
  });
});

// Start the worker
startWorker().catch(err => {
  console.error(`[${new Date().toISOString()}] [Worker] Failed to start:`, err);
  process.exit(1);
});
