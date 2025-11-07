import { Queue } from 'bullmq';
import IORedis, { RedisOptions } from 'ioredis';

const getRedisConnectionConfig = (): string | RedisOptions => {
    if (process.env.REDIS_URL) {
        return process.env.REDIS_URL;
    }
    if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
        const options: RedisOptions = {
            host: process.env.REDIS_HOST,
            port: Number(process.env.REDIS_PORT),
        };
        if (process.env.REDIS_USERNAME) options.username = process.env.REDIS_USERNAME;
        if (process.env.REDIS_PASSWORD) options.password = process.env.REDIS_PASSWORD;
        return options;
    }
    throw new Error('Redis connection not configured. Please set REDIS_URL or REDIS_HOST and REDIS_PORT in your environment variables.');
};

const connectionConfig = getRedisConnectionConfig();
const commonOptions = { maxRetriesPerRequest: null };

/**
 * Creates a new IORedis instance with the application's configuration.
 * It's crucial to create separate instances for different roles (e.g., commands, pub, sub, queues)
 * as recommended by IORedis and BullMQ documentation.
 */
export const createRedisInstance = () => {
    if (typeof connectionConfig === 'string') {
        // IORedis constructor can take (url, options)
        return new IORedis(connectionConfig, commonOptions);
    }
    // Or it can take a single options object
    return new IORedis({ ...connectionConfig, ...commonOptions });
};

// Create separate clients for different purposes to avoid conflicts
export const redis = createRedisInstance();
export const pubClient = createRedisInstance();
export const subClient = createRedisInstance();

// For BullMQ, it's recommended to pass a new connection instance
export const agentQueue = new Queue('agent-jobs', { connection: createRedisInstance() });

console.log('[Queue] BullMQ Agent Queue initialized.');