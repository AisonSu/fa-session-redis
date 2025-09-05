import { SessionStore,sessionMetaDataCtx } from 'farrow-auth-session';
import { ulid } from 'ulid';


export interface RedisLikeClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<string | 'OK' | null>;
    del(key: string | string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<number | boolean>;
    mGet?(keys: string[]): Promise<(string | null)[]>;
    mget?(keys: string[]): Promise<(string | null)[]>;
    scan?(cursor: number | string, ...args: any[]): Promise<[string, string[]]>;
    scanIterator?(options: { MATCH?: string; COUNT?: number }): AsyncIterable<string>;
}

export interface NormalizedRedisClient {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<boolean>;
    setex(key: string, seconds: number, value: string): Promise<boolean>;
    del(keyOrKeys: string | string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<boolean>;
    ttl(key: string): Promise<number>;
    mget(keys: string[]): Promise<(string | null)[]>;
    scanIterator(match: string, count: number): AsyncIterable<string>;
}

function isIoRedisClient(client: any): boolean {
    return typeof client.scan === 'function' && 
           typeof client.mget === 'function' &&
           !client.scanIterator;
}

function isNodeRedisClient(client: any): boolean {
    return typeof client.scanIterator === 'function' && 
           typeof client.mGet === 'function';
}

export function createNormalizedRedisClient(client: RedisLikeClient): NormalizedRedisClient {
    if (isIoRedisClient(client)) {
        return {
            get: async (key: string) => {
                return client.get(key);
            },
            set: async (key: string, value: string) => {
                const result = await client.set(key, value);
                return result === 'OK' || result === '1';
            },
            setex: async (key: string, seconds: number, value: string) => {
                if (typeof (client as any).setex === 'function') {
                    const result = await (client as any).setex(key, seconds, value);
                    return result === 'OK' || result === '1';
                }
                const setResult = await client.set(key, value);
                if (setResult === 'OK' || setResult === '1') {
                    const expireResult = await client.expire(key, seconds);
                    return expireResult === 1 || expireResult === true;
                }
                return false;
            },
            del: async (keyOrKeys: string | string[]) => {
                const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
                if (typeof (client as any).del === 'function') {
                    const result = await (client as any).del(...keys);
                    return result;
                }
                // Fallback for clients without proper del
                let deleted = 0;
                for (const key of keys) {
                    const result = await client.del(key);
                    deleted += result;
                }
                return deleted;
            },
            expire: async (key: string, seconds: number) => {
                const result = await client.expire(key, seconds);
                return result === 1 || result === true;
            },
            ttl: async (key: string) => {
                if (typeof (client as any).ttl === 'function') {
                    return (client as any).ttl(key);
                }
                return -2;
            },
            mget: async (keys: string[]) => {
                if (typeof (client as any).mget === 'function') {
                    return (client as any).mget(...keys);
                }
                const results: (string | null)[] = [];
                for (const key of keys) {
                    results.push(await client.get(key));
                }
                return results;
            },
            scanIterator: async function* (match: string, count: number): AsyncIterable<string> {
                if (typeof (client as any).scan === 'function') {
                    let cursor = '0';
                    do {
                        const [nextCursor, keys] = await (client as any).scan(cursor, 'MATCH', match, 'COUNT', count);
                        for (const key of keys) {
                            yield key;
                        }
                        cursor = nextCursor;
                    } while (cursor !== '0');
                } else {
                    return;
                }
            }
        };
    } else if (isNodeRedisClient(client)) {
        return {
            get: async (key: string) => {
                return client.get(key);
            },
            set: async (key: string, value: string) => {
                const result = await client.set(key, value);
                return result === 'OK';
            },
            setex: async (key: string, seconds: number, value: string) => {
                if (typeof (client as any).setEx === 'function') {
                    const result = await (client as any).setEx(key, seconds, value);
                    return result === 'OK';
                }
                const setResult = await client.set(key, value);
                if (setResult === 'OK') {
                    return client.expire(key, seconds) as Promise<boolean>;
                }
                return false;
            },
            del: async (keyOrKeys: string | string[]) => {
                return client.del(keyOrKeys);
            },
            expire: async (key: string, seconds: number) => {
                const result = await client.expire(key, seconds);
                return result === true || result === 1;
            },
            ttl: async (key: string) => {
                if (typeof (client as any).ttl === 'function') {
                    return (client as any).ttl(key);
                }
                return -2;
            },
            mget: async (keys: string[]) => {
                if (typeof (client as any).mGet === 'function') {
                    return (client as any).mGet(keys);
                }
                const results: (string | null)[] = [];
                for (const key of keys) {
                    results.push(await client.get(key));
                }
                return results;
            },
            scanIterator: async function* (match: string, count: number): AsyncIterable<string> {
                if (typeof (client as any).scanIterator === 'function') {
                    const iterator = (client as any).scanIterator({ MATCH: match, COUNT: count });
                    for await (const batch of iterator) {
                        // node-redis 返回的可能是批次数组
                        if (Array.isArray(batch)) {
                            for (const key of batch) {
                                yield key;
                            }
                        } else {
                            yield batch;
                        }
                    }
                } else {
                    // Fallback for clients without scanIterator
                    return;
                }
            }
        };
    } else {
        throw new Error('Unsupported Redis client type. Please use redis or ioredis.');
    }
}
export interface RedisSessionStoreOptions<UserData> {
    /**
     * Redis key prefix for sessions
     * @default 'session'
     */
    prefix?: string;

    /**
     * Session expiration time in seconds
     * Set to false to disable expiration in Redis (but session may still expire in cookies)
     * @default 86400 (24 hours)
     */
    ttl?: number | false;

    /**
     * If true, session expiration will be reset on each access
     * Only works when ttl is set to a number
     * @default false
     */
    rolling?: boolean;

    /**
     * If true, session expiration will be renewed when close to expiry
     * @default false
     */
    renew?: boolean;

    /**
     * Time in seconds before expiry to trigger renewal
     * Only used when renew is true
     * @default 600 (10 minutes)
     */
    renewBefore?: number;

    /**
     * Custom session ID generator
     * @default () => ulid()
     */
    genSessionId?: () => string;

    /**
     * Initial session data creator
     * @default () => ({} as UserData)
     */
    defaultData?: () => UserData;
}

export function createRedisSessionStore<UserData = any>(
    client: RedisLikeClient | NormalizedRedisClient,
    options: RedisSessionStoreOptions<UserData> = {}
): SessionStore<UserData, string> {
    const normalizedClient = ('setex' in client && typeof client.setex === 'function')
        ? client as NormalizedRedisClient 
        : createNormalizedRedisClient(client as RedisLikeClient);

    const config = {
        prefix: 'session',
        ttl: 86400,
        rolling: false,
        renew: false,
        renewBefore: 600,
        genSessionId: () => ulid(),
        defaultData: () => ({} as UserData),
        ...options
    };

    const getKey = (sessionId: string) => `${config.prefix}:${sessionId}`;

    const store: SessionStore<UserData, string> = {
        async get(sessionId: string): Promise<UserData | null | undefined> {
            if (!sessionId) {
                return null;
            }

            const key = getKey(sessionId);
            const data = await normalizedClient.get(key);
            
            if (!data) {
                return null;
            }

            try {
                const userData = JSON.parse(data) as UserData;

                // Update session metadata in context
                const expiresTime = config.ttl !== false 
                    ? Date.now() + (config.ttl * 1000)
                    : Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year if no TTL
                
                sessionMetaDataCtx.set({
                    sessionId,
                    expiresTime
                });

                // Handle rolling and renew strategies
                if (config.rolling && config.ttl !== false) {
                    await normalizedClient.expire(key, config.ttl);
                } else if (config.renew && config.ttl !== false) {
                    const ttl = await normalizedClient.ttl(key);
                    if (ttl > 0 && ttl < config.renewBefore) {
                        await normalizedClient.expire(key, config.ttl);
                    }
                }

                return userData;
            } catch (error) {
                console.error('Failed to parse session data:', error);
                return undefined;
            }
        },

        async set(userData: UserData): Promise<boolean | undefined> {
            const sessionMeta = sessionMetaDataCtx.get();
            if (!sessionMeta?.sessionId) {
                return undefined;
            }

            const key = getKey(sessionMeta.sessionId);
            
            try {
                const data = JSON.stringify(userData);
                
                if (config.ttl !== false) {
                    const result = await normalizedClient.setex(key, config.ttl, data);
                    return result ? true : false;
                } else {
                    const result = await normalizedClient.set(key, data);
                    return result ? true : false;
                }
            } catch (error) {
                console.error('Failed to save session:', error);
                return undefined;
            }
        },

        async create(userData?: UserData): Promise<UserData | undefined> {
            const sessionId = config.genSessionId();
            const data = userData || config.defaultData();
            const key = getKey(sessionId);

            try {
                const jsonData = JSON.stringify(data);
                let result: boolean;

                if (config.ttl !== false) {
                    result = await normalizedClient.setex(key, config.ttl, jsonData);
                } else {
                    result = await normalizedClient.set(key, jsonData);
                }

                if (result) {
                    // Set session metadata in context for parser to use
                    const expiresTime = config.ttl !== false 
                        ? Date.now() + (config.ttl * 1000)
                        : Date.now() + (365 * 24 * 60 * 60 * 1000); // 1 year if no TTL
                    
                    sessionMetaDataCtx.set({
                        sessionId,
                        expiresTime
                    });
                    
                    return data;
                }
                return undefined;
            } catch (error) {
                console.error('Failed to create session:', error);
                return undefined;
            }
        },

        async destroy(): Promise<boolean | undefined> {
            const sessionMeta = sessionMetaDataCtx.get();
            if (!sessionMeta?.sessionId) {
                return false;
            }

            const key = getKey(sessionMeta.sessionId);
            
            try {
                const result = await normalizedClient.del(key);
                // Clear session metadata regardless of result
                sessionMetaDataCtx.set(undefined);
                return result > 0;
            } catch (error) {
                console.error('Failed to destroy session:', error);
                return undefined;
            }
        },

        async touch(): Promise<boolean | undefined> {
            const sessionMeta = sessionMetaDataCtx.get();
            if (!sessionMeta?.sessionId) {
                return false;
            }

            if (config.ttl === false) {
                return false; // No TTL to update
            }

            const key = getKey(sessionMeta.sessionId);
            
            try {
                const result = await normalizedClient.expire(key, config.ttl);
                if (result) {
                    // Update expiry time in context
                    sessionMetaDataCtx.set({
                        ...sessionMeta,
                        expiresTime: Date.now() + (config.ttl * 1000)
                    });
                    return true;
                }
                return false;
            } catch (error) {
                console.error('Failed to touch session:', error);
                return undefined;
            }
        }
    };

    return store;
}

