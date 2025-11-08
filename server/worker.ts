import './env'; // Ensure env vars are loaded first
import { Worker, Job, QueueEvents } from 'bullmq';
import mongoose from 'mongoose';
import { GoogleGenAI } from '@google/genai';
import { redis as redisConnection, pubClient, agentQueue } from './queue';

// Track worker metrics
let worker: Worker | null = null;
let queueEvents: QueueEvents | null = null;

const workerMetrics = {
  jobsProcessed: 0,
  jobsFailed: 0,
  lastJobTime: null as Date | null,
  startTime: new Date(),
  isShuttingDown: false,
};

// Add worker startup logging
console.log(`[${new Date().toISOString()}] [Worker] Starting worker process...`);
console.log(`[${new Date().toISOString()}] [Worker] Process ID: ${process.pid}`);
console.log(`[${new Date().toISOString()}] [Worker] Node.js version: ${process.version}`);
console.log(`[${new Date().toISOString()}] [Worker] NODE_ENV: ${process.env.NODE_ENV || 'development'}`);

// Log memory usage periodically
const memoryInterval = setInterval(() => {
  if (workerMetrics.isShuttingDown) return;
  
  const memory = process.memoryUsage();
  console.log(`[${new Date().toISOString()}] [Worker] Memory: ` +
    `RSS=${Math.round(memory.rss / 1024 / 1024)}MB, ` +
    `Heap=${Math.round(memory.heapUsed / 1024 / 1024)}MB/${Math.round(memory.heapTotal / 1024 / 1024)}MB, ` +
    `External=${Math.round(memory.external / 1024 / 1024)}MB`
  );
}, 30000);
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

const processJob = async (job: Job): Promise<void> => {
    if (workerMetrics.isShuttingDown) {
        console.log(`[${new Date().toISOString()}] [Worker] Skipping job ${job.id} - worker is shutting down`);
        throw new Error('Worker is shutting down');
    }
    
    const jobStart = Date.now();
    console.log(`[${new Date().toISOString()}] [Worker] Starting job ${job.id} (attempt ${job.attemptsMade + 1})`);
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
const startWorker = async (): Promise<void> => {
  try {
    // Close existing worker if any
    if (worker) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing existing worker...`);
      await worker.close();
    }

    console.log(`[${new Date().toISOString()}] [Worker] Connecting to MongoDB...`);
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
    });
    
    console.log(`[${new Date().toISOString()}] [Worker] MongoDB connected successfully`);

    // Initialize QueueEvents for monitoring
    queueEvents = new QueueEvents('agent-jobs', {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 10026),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
      }
    });

    // Create the worker
    worker = new Worker('agent-jobs', processJob, {
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT || 10026),
        username: process.env.REDIS_USERNAME,
        password: process.env.REDIS_PASSWORD,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      concurrency: 5, // Process up to 5 jobs concurrently
      removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
      removeOnFail: { count: 1000 },    // Keep last 1000 failed jobs
      lockDuration: 30000, // 30 seconds to process a job
      lockRenewTime: 10000, // Renew lock every 10 seconds
    });

    // Worker event handlers
    worker.on('completed', (job) => {
      if (workerMetrics.isShuttingDown) return;
      
      workerMetrics.jobsProcessed++;
      workerMetrics.lastJobTime = new Date();
      const duration = job.processedOn ? Date.now() - job.processedOn : 0;
      console.log(`[${new Date().toISOString()}] [Worker] Job ${job.id} completed in ${duration}ms`);
    });

    worker.on('failed', (job, err) => {
      if (workerMetrics.isShuttingDown) return;
      
      workerMetrics.jobsFailed++;
      const jobId = job?.id || 'unknown';
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${new Date().toISOString()}] [Worker] Job ${jobId} failed:`, errorMsg);
      
      if (job && job.attemptsMade >= (job.opts?.attempts || 3)) {
        console.error(`[${new Date().toISOString()}] [Worker] Job ${jobId} failed after ${job.attemptsMade} attempts`);
      }
    });

    worker.on('error', (err) => {
      if (workerMetrics.isShuttingDown) return;
      console.error(`[${new Date().toISOString()}] [Worker] Worker error:`, err);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`[${new Date().toISOString()}] [Worker] Job ${jobId} stalled and will be reprocessed`);
    });

    console.log(`[${new Date().toISOString()}] [Worker] Worker started and listening for jobs`);
    
    // Emit ready event
    if (process.send) {
      process.send('ready');
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [Worker] Failed to start worker:`, error);
    await gracefulShutdown('startup-failure');
    process.exit(1);
  }
};

const gracefulShutdown = async (signal: string): Promise<void> => {
  if (workerMetrics.isShuttingDown) {
    console.log(`[${new Date().toISOString()}] [Worker] Shutdown already in progress, ignoring signal: ${signal}`);
    return;
  }
  
  workerMetrics.isShuttingDown = true;
  console.log(`[${new Date().toISOString()}] [Worker] Received ${signal}. Starting graceful shutdown...`);
  
  // Clear intervals
  clearInterval(memoryInterval);
  
  const shutdownPromises: Promise<unknown>[] = [];
  const shutdownTimeout = setTimeout(() => {
    console.error(`[${new Date().toISOString()}] [Worker] Forcing shutdown after timeout`);
    process.exit(1);
  }, 30000); // Force exit after 30 seconds
  
  try {
    // Close the worker first to stop accepting new jobs
    if (worker) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing worker...`);
      shutdownPromises.push(
        worker.close(true) // Force close any active jobs
          .then(() => {
            console.log(`[${new Date().toISOString()}] [Worker] Worker closed`);
            worker = null;
          })
          .catch((err) => {
            console.error(`[${new Date().toISOString()}] [Worker] Error closing worker:`, err);
          })
      );
    }
    
    // Close QueueEvents
    if (queueEvents) {
      shutdownPromises.push(
        queueEvents.close()
          .then(() => {
            console.log(`[${new Date().toISOString()}] [Worker] Queue events closed`);
            queueEvents = null;
          })
          .catch((err) => {
            console.error(`[${new Date().toISOString()}] [Worker] Error closing queue events:`, err);
          })
      );
    }
    
    // Close MongoDB connection
    if (mongoose.connection.readyState === 1) {
      console.log(`[${new Date().toISOString()}] [Worker] Closing MongoDB connection...`);
      shutdownPromises.push(
        mongoose.connection.close(false) // Don't force close to allow in-progress operations to complete
          .then(() => {
            console.log(`[${new Date().toISOString()}] [Worker] MongoDB connection closed`);
          })
          .catch((err) => {
            console.error(`[${new Date().toISOString()}] [Worker] Error closing MongoDB connection:`, err);
          })
      );
    }
    
    // Wait for all shutdown operations to complete or timeout
    await Promise.allSettled(shutdownPromises);
    
    console.log(`[${new Date().toISOString()}] [Worker] Shutdown complete`);
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [Worker] Error during shutdown:`, error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] [Worker] Uncaught Exception:`, error);
  // Don't exit immediately to allow for cleanup
  gracefulShutdown('uncaught-exception').catch(() => {
    process.exit(1);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] [Worker] Unhandled Rejection at:`, promise, 'reason:', reason);
  // Convert unhandled rejections to exceptions to be caught by uncaughtException
  throw reason instanceof Error ? reason : new Error(String(reason));
});

// Handle process signals
const handleSignal = (signal: string) => {
  console.log(`[${new Date().toISOString()}] [Worker] Received ${signal} signal`);
  gracefulShutdown(signal).catch((error) => {
    console.error(`[${new Date().toISOString()}] [Worker] Error during ${signal} shutdown:`, error);
    process.exit(1);
  });
};

process.on('SIGTERM', () => handleSignal('SIGTERM'));
process.on('SIGINT', () => handleSignal('SIGINT'));

// Handle PM2 graceful shutdown (listen for the shutdown message)
process.on('message', (msg) => {
  if (msg === 'shutdown') {
    console.log(`[${new Date().toISOString()}] [Worker] Received shutdown message`);
    handleSignal('pm2-shutdown');
  }
});

// Start the worker
startWorker().catch(err => {
  console.error(`[${new Date().toISOString()}] [Worker] Failed to start:`, err);
  process.exit(1);
});
