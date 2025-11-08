import { Queue, QueueScheduler, Worker, QueueEvents } from 'bullmq';
import { createClient, RedisClientType, RedisDefaultModules } from 'redis';

type RedisClient = RedisClientType<RedisDefaultModules, any>;

// Configuration
const REDIS_CONFIG = {
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD || 'UXmJv2kSrN38JGvO1KkYpm30xhiT0Wvb',
    host: process.env.REDIS_HOST || 'redis-10026.crce219.us-east-1-4.ec2.redns.redis-cloud.com',
    port: Number(process.env.REDIS_PORT || 10026),
    tls: process.env.REDIS_TLS === 'true',
    maxRetriesPerRequest: null, // Disable retries for BullMQ
    enableReadyCheck: false // Disable ready check for BullMQ
};

// Create Redis client with enhanced error handling and reconnection logic
export const createRedisClient = (clientName: string): RedisClient => {
    const client = createClient({
        ...REDIS_CONFIG,
        name: clientName,
        socket: {
            host: REDIS_CONFIG.host,
            port: REDIS_CONFIG.port,
            tls: REDIS_CONFIG.tls,
            reconnectStrategy: (retries: number): number | Error => {
                const delay = Math.min(retries * 100, 5000);
                console.log(`[Redis:${clientName}] Connection lost. Reconnecting in ${delay}ms... (attempt ${retries + 1})`);
                return delay;
            }
        }
    }) as RedisClient;

    // Event handlers
    client.on('error', (err) => {
        console.error(`[Redis:${clientName}] Error:`, err);
    });

    client.on('connect', () => {
        console.log(`[Redis:${clientName}] Connected`);
    });

    client.on('ready', () => {
        console.log(`[Redis:${clientName}] Ready`);
    });

    client.on('reconnecting', () => {
        console.log(`[Redis:${clientName}] Reconnecting...`);
    });

    client.on('end', () => {
        console.log(`[Redis:${clientName}] Connection closed`);
    });

    return client;
};

// Create Redis clients with different purposes
const redis: RedisClient = createRedisClient('main');
const pubClient: RedisClient = createRedisClient('pub');
const subClient: RedisClient = createRedisClient('sub');

// Connection manager
let isConnecting = false;
let connectionPromise: Promise<void> | null = null;

const connectClients = async (): Promise<void> => {
    if (isConnecting && connectionPromise) {
        return connectionPromise;
    }

    isConnecting = true;
    
    connectionPromise = (async () => {
        try {
            console.log('[Redis] Connecting clients...');
            await Promise.all([
                redis.connect().catch(err => 
                    console.error('Failed to connect main Redis client:', err)
                ),
                pubClient.connect().catch(err => 
                    console.error('Failed to connect pub client:', err)
                ),
                subClient.connect().catch(err => 
                    console.error('Failed to connect sub client:', err)
                )
            ]);
            console.log('[Redis] All clients connected');
        } catch (error) {
            console.error('[Redis] Failed to connect clients:', error);
            throw error;
        } finally {
            isConnecting = false;
        }
    })();

    return connectionPromise;
};

// Initialize connection
connectClients().catch((error) => {
    console.error('Failed to initialize Redis clients:', error);
    process.exit(1);
});

// Export clients
export { redis, pubClient, subClient };

// BullMQ queue for agent jobs
export const agentQueue = new Queue('agent-jobs', {
    connection: {
        host: REDIS_CONFIG.host,
        port: REDIS_CONFIG.port,
        username: REDIS_CONFIG.username,
        password: REDIS_CONFIG.password,
        tls: REDIS_CONFIG.tls ? {}
            : undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false
    }
});

console.log('[Queue] BullMQ Agent Queue initialized.');