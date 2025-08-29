import Redis from 'ioredis';
import { createClient } from 'redis';

// Test Redis clients
export async function createTestRedisClients() {
    // Create ioredis client
    const ioredisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        db: parseInt(process.env.REDIS_TEST_DB || '15'), // Use separate DB for tests
        lazyConnect: true,
    });

    // Create node-redis client
    const nodeRedisClient = createClient({
        socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
        },
        database: parseInt(process.env.REDIS_TEST_DB || '15'),
    });

    // Connect clients
    try {
        await ioredisClient.connect();
        await nodeRedisClient.connect();
    } catch (error) {
        console.error('Failed to connect to Redis:', error);
        throw error;
    }

    return {
        ioredisClient,
        nodeRedisClient,
    };
}

// Clean up test database
export async function cleanupTestData(client: Redis | any, prefix: string = 'test:*') {
    try {
        // 使用 SCAN 找到所有匹配的 key 并删除
        if ('scanStream' in client) {
            // ioredis
            const stream = client.scanStream({ match: prefix });
            stream.on('data', (keys: string[]) => {
                if (keys.length) {
                    client.del(...keys);
                }
            });
            await new Promise((resolve) => stream.on('end', resolve));
        } else if ('keys' in client) {
            // 简单方式：使用 keys 命令（仅测试环境）
            const keys = await client.keys(prefix);
            if (keys.length > 0) {
                await client.del(keys);
            }
        } else if ('flushDb' in client) {
            // node-redis fallback
            await client.flushDb();
        }
    } catch (error) {
        console.error('Failed to cleanup test data:', error);
    }
}

// Close clients
export async function closeClients(ioredis: Redis, nodeRedis: any) {
    try {
        await ioredis.quit();
        await nodeRedis.quit();
    } catch (error) {
        console.error('Failed to close clients:', error);
    }
}

// Test data factory
export function createMockUserData() {
    return {
        userId: 'user-' + Math.random().toString(36).substr(2, 9),
        username: 'testuser',
        email: 'test@example.com',
        role: 'user' as const,
        createdAt: Date.now(),
    };
}

// Wait utility
export function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}