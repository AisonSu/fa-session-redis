import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createContainer, runWithContainer } from 'farrow-pipeline';
import { sessionMetaDataCtx, createAuthCtx } from 'farrow-auth';
import { createTestRedisClients, cleanupTestData, closeClients, createMockUserData, wait } from './setup';
import { createRedisSessionStore, createNormalizedRedisClient } from '../src';
import type { AuthStore } from 'farrow-auth';

type UserData = {
    userId: string;
    username: string;
    email: string;
    role: 'admin' | 'user';
    createdAt: number;
};

describe('fa-session-redis', () => {
    let ioredisClient: any;
    let nodeRedisClient: any;

    beforeAll(async () => {
        const clients = await createTestRedisClients();
        ioredisClient = clients.ioredisClient;
        nodeRedisClient = clients.nodeRedisClient;
    });

    afterAll(async () => {
        await closeClients(ioredisClient, nodeRedisClient);
    });

    beforeEach(async () => {
        await cleanupTestData(ioredisClient, 'test:*');
        await cleanupTestData(nodeRedisClient, 'test:*');
    });

    /**
     * Core Session Store Tests
     */
    describe('Redis Session Store', () => {
        describe('with ioredis client', () => {
            let store: AuthStore<UserData, string>;

            beforeEach(() => {
                store = createRedisSessionStore<UserData>(ioredisClient, {
                    prefix: 'test:session',
                    ttl: 3600,
                });
            });

            it('should create and retrieve sessions', async () => {
                const userData = createMockUserData();
                
                const container = createContainer();
                const sessionId = await runWithContainer(async () => {
                    const created = await store.create(userData);
                    expect(created).toEqual(userData);
                    
                    const meta = sessionMetaDataCtx.get();
                    expect(meta?.sessionId).toBeDefined();
                    expect(meta?.expiresTime).toBeGreaterThan(Date.now());
                    
                    return meta?.sessionId;
                }, container);

                // Verify in new context
                const container2 = createContainer();
                await runWithContainer(async () => {
                    const retrieved = await store.get(sessionId!);
                    expect(retrieved).toEqual(userData);
                }, container2);
            });

            it('should update session data', async () => {
                const userData = createMockUserData();
                
                const container = createContainer();
                await runWithContainer(async () => {
                    await store.create(userData);
                    
                    const updated = { ...userData, username: 'updateduser' };
                    
                    const saved = await store.set(updated);
                    expect(saved).toBe(true);
                    
                    const sessionId = sessionMetaDataCtx.get()?.sessionId;
                    const retrieved = await store.get(sessionId!);
                    expect(retrieved?.username).toBe('updateduser');
                }, container);
            });

            it('should destroy sessions', async () => {
                const userData = createMockUserData();
                
                const container = createContainer();
                const sessionId = await runWithContainer(async () => {
                    await store.create(userData);
                    const meta = sessionMetaDataCtx.get();
                    
                    const destroyed = await store.destroy();
                    expect(destroyed).toBe(true);
                    
                    return meta?.sessionId;
                }, container);

                // Verify destroyed
                const container2 = createContainer();
                await runWithContainer(async () => {
                    const retrieved = await store.get(sessionId!);
                    expect(retrieved).toBeNull();
                }, container2);
            });

            it('should handle TTL strategies', async () => {
                // Rolling sessions
                const rollingStore = createRedisSessionStore<UserData>(ioredisClient, {
                    prefix: 'test:rolling',
                    ttl: 3,
                    rolling: true,
                });

                const container = createContainer();
                await runWithContainer(async () => {
                    await rollingStore.create(createMockUserData());
                    const sessionId = sessionMetaDataCtx.get()?.sessionId;
                    
                    await wait(2000);
                    await rollingStore.get(sessionId!); // Should reset TTL
                    
                    await wait(2000);
                    const retrieved = await rollingStore.get(sessionId!);
                    expect(retrieved).not.toBeNull(); // Should still exist
                }, container);
            });

            it('should handle sessions without TTL', async () => {
                const store = createRedisSessionStore<UserData>(ioredisClient, {
                    prefix: 'test:no-ttl',
                    ttl: false,
                });

                const container = createContainer();
                await runWithContainer(async () => {
                    const userData = createMockUserData();
                    await store.create(userData);
                    
                    const sessionId = sessionMetaDataCtx.get()?.sessionId;
                    const ttl = await ioredisClient.ttl(`test:no-ttl:${sessionId}`);
                    expect(ttl).toBe(-1); // No expiration
                }, container);
            });
        });

        describe('with node-redis client', () => {
            it('should work with node-redis client', async () => {
                const store = createRedisSessionStore<UserData>(nodeRedisClient, {
                    prefix: 'test:noderedis',
                    ttl: 3600,
                });

                const container = createContainer();
                await runWithContainer(async () => {
                    const userData = createMockUserData();
                    const created = await store.create(userData);
                    expect(created).toEqual(userData);
                    
                    const sessionId = sessionMetaDataCtx.get()?.sessionId;
                    const retrieved = await store.get(sessionId!);
                    expect(retrieved).toEqual(userData);
                }, container);
            });
        });
    });

    /**
     * Normalized Redis Client Tests
     */
    describe('Normalized Redis Client', () => {
        describe('ioredis adapter', () => {
            let normalized: any;
            
            beforeEach(() => {
                normalized = createNormalizedRedisClient(ioredisClient);
            });

            it('should handle basic operations', async () => {
                const key = 'test:key';
                const value = 'test-value';
                
                const setResult = await normalized.set(key, value);
                expect(setResult).toBe(true);
                
                const retrieved = await normalized.get(key);
                expect(retrieved).toBe(value);
                
                const deleted = await normalized.del(key);
                expect(deleted).toBe(1);
                
                const afterDelete = await normalized.get(key);
                expect(afterDelete).toBeNull();
            });

            it('should handle TTL operations', async () => {
                const key = 'test:ttl';
                const value = 'ttl-value';
                
                const setexResult = await normalized.setex(key, 10, value);
                expect(setexResult).toBe(true);
                
                const ttl = await normalized.ttl(key);
                expect(ttl).toBeGreaterThan(0);
                expect(ttl).toBeLessThanOrEqual(10);
                
                const expireResult = await normalized.expire(key, 5);
                expect(expireResult).toBe(true);
                
                const newTtl = await normalized.ttl(key);
                expect(newTtl).toBeLessThanOrEqual(5);
            });

            it('should handle batch operations', async () => {
                await normalized.set('test:mget1', 'value1');
                await normalized.set('test:mget2', 'value2');
                
                const results = await normalized.mget(['test:mget1', 'test:mget2', 'test:mget3']);
                expect(results).toEqual(['value1', 'value2', null]);
            });

            it('should handle scan operations', async () => {
                // Set up test data
                for (let i = 0; i < 5; i++) {
                    await normalized.set(`test:scan:${i}`, `value${i}`);
                }
                
                // Scan for keys
                const keys: string[] = [];
                for await (const key of normalized.scanIterator('test:scan:*', 10)) {
                    keys.push(key);
                }
                
                expect(keys).toHaveLength(5);
                expect(keys.every(k => k.startsWith('test:scan:'))).toBe(true);
            });
        });

        describe('node-redis adapter', () => {
            let normalized: any;
            
            beforeEach(() => {
                normalized = createNormalizedRedisClient(nodeRedisClient);
            });

            it('should handle basic operations', async () => {
                const key = 'test:node:key';
                const value = 'test-value';
                
                const setResult = await normalized.set(key, value);
                expect(setResult).toBe(true);
                
                const retrieved = await normalized.get(key);
                expect(retrieved).toBe(value);
                
                const deleted = await normalized.del(key);
                expect(deleted).toBe(1);
            });

            it('should handle scan operations', async () => {
                // Set up test data
                for (let i = 0; i < 3; i++) {
                    await normalized.set(`test:node:scan:${i}`, `value${i}`);
                }
                
                // Scan for keys
                const keys: string[] = [];
                for await (const key of normalized.scanIterator('test:node:scan:*', 10)) {
                    keys.push(key);
                }
                
                expect(keys).toHaveLength(3);
                expect(keys.every(k => k.startsWith('test:node:scan:'))).toBe(true);
            });
        });

        describe('error handling', () => {
            it('should throw error for unsupported client', () => {
                const unsupportedClient = {
                    get: () => Promise.resolve(null),
                    set: () => Promise.resolve('OK'),
                };
                
                expect(() => createNormalizedRedisClient(unsupportedClient as any))
                    .toThrow('Unsupported Redis client type');
            });
        });
    });

    /**
     * Edge Cases and Error Handling
     */
    describe('Edge Cases', () => {
        let store: AuthStore<UserData, string>;

        beforeEach(() => {
            store = createRedisSessionStore<UserData>(ioredisClient, {
                prefix: 'test:edge',
                ttl: 3600,
            });
        });

        it('should handle operations without session context', async () => {
            const container = createContainer();
            await runWithContainer(async () => {
                const userData = createMockUserData();
                
                // Set without session context
                const setResult = await store.set(userData);
                expect(setResult).toBeUndefined();
                
                // Destroy without session context
                const destroyResult = await store.destroy();
                expect(destroyResult).toBe(false);
                
                // Touch without session context
                const touchResult = await store.touch();
                expect(touchResult).toBe(false);
            }, container);
        });

        it('should handle invalid session data', async () => {
            const key = 'test:edge:invalid';
            await ioredisClient.set(key, 'not-json{');
            
            const container = createContainer();
            await runWithContainer(async () => {
                const result = await store.get('invalid');
                expect(result).toBeUndefined();
            }, container);
        });

        it('should handle null/empty session IDs', async () => {
            const result1 = await store.get('');
            expect(result1).toBeNull();
            
            const result2 = await store.get(null as any);
            expect(result2).toBeNull();
        });
    });
});