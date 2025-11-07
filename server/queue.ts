import { Queue, QueueScheduler } from 'bullmq';
import { createClient } from 'redis';

// Create Redis client with the recommended configuration from your Redis provider
export const createRedisClient = () => {
    const client = createClient({
        username: process.env.REDIS_USERNAME || 'default',
        password: process.env.REDIS_PASSWORD || 'UXmJv2kSrN38JGvO1KkYpm30xhiT0Wvb',
        socket: {
            host: process.env.REDIS_HOST || 'redis-10026.crce219.us-east-1-4.ec2.redns.redis-cloud.com',
            port: Number(process.env.REDIS_PORT || 10026),
            tls: false, // Set to true if using TLS/SSL
            reconnectStrategy: (retries) => {
                if (retries > 10) {
                    console.log('Too many attempts to connect to Redis. Terminating...');
                    return new Error('Too many retries.');
                }
                // Reconnect after this time (in ms)
                return Math.min(retries * 100, 5000);
            }
        }
    });

    client.on('error', (err) => {
        console.error('Redis Client Error:', err);
    });

    client.on('connect', () => {
        console.log('Redis Client: Connected');
    });

    client.on('reconnecting', () => {
        console.log('Redis Client: Reconnecting...');
    });

    return client;
};

// Create Redis clients
const redis = createRedisClient();
const pubClient = createRedisClient();
const subClient = createRedisClient();

// Connect all clients
Promise.all([
    redis.connect(),
    pubClient.connect(),
    subClient.connect()
]).catch(err => {
    console.error('Failed to connect to Redis:', err);
    process.exit(1);
});

// Create a Redis client specifically for BullMQ
const bullMqClient = createRedisClient();
await bullMqClient.connect();

export { redis, pubClient, subClient };

// For BullMQ, we need to use a compatible client
// You might need to adjust this part based on your BullMQ version
export const agentQueue = new Queue('agent-jobs', { 
    connection: {
        host: process.env.REDIS_HOST || 'redis-10026.crce219.us-east-1-4.ec2.redns.redis-cloud.com',
        port: Number(process.env.REDIS_PORT || 10026),
        username: process.env.REDIS_USERNAME || 'default',
        password: process.env.REDIS_PASSWORD || 'UXmJv2kSrN38JGvO1KkYpm30xhiT0Wvb',
    }
});

// Add queue scheduler for BullMQ
const queueScheduler = new QueueScheduler('agent-jobs', {
    connection: {
        host: process.env.REDIS_HOST || 'redis-10026.crce219.us-east-1-4.ec2.redns.redis-cloud.com',
        port: Number(process.env.REDIS_PORT || 10026),
        username: process.env.REDIS_USERNAME || 'default',
        password: process.env.REDIS_PASSWORD || 'UXmJv2kSrN38JGvO1KkYpm30xhiT0Wvb',
    }
});

console.log('[Queue] BullMQ Agent Queue initialized.');