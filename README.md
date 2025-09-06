# fa-session-redis

Redis session store for [farrow-auth-session](https://github.com/AisonSu/farrow-auth-session) with support for both [redis](https://github.com/redis/node-redis) and [ioredis](https://github.com/luin/ioredis) clients.

[中文文档](./README_CN.md)

## Features
- 🔄 **Universal Redis Support** - Works with both `redis` and `ioredis` clients through function overloads and normalized adapter
- 🎯 **Type-Safe** - Full TypeScript support with function overloads for compile-time type checking
- ⚡ **Performance** - Efficient session management with configurable TTL strategies
- 🔒 **Secure** - Server-side session storage with ULID-based session IDs
- 🎨 **Flexible** - Multiple session expiration strategies (rolling, renewing, fixed)

## Installation

```bash
npm install fa-session-redis farrow-auth-session

# Install one of the Redis clients
npm install redis
# or
npm install ioredis
```

## Quick Start

```typescript
import { Http, Response } from 'farrow-http';
import { ObjectType, String } from 'farrow-schema';
import { createSession, createSessionCtx, cookieSessionParser } from 'farrow-auth-session';
import { createRedisSessionStore } from 'fa-session-redis';
import Redis from 'ioredis';

// Create Redis client
const redis = new Redis();

// Define user data type
type UserData = {
  userId?: string;
  username?: string;
  role?: string;
};

// Create session context
const sessionUserDataCtx = createSessionCtx<UserData>({});

// Create Redis session store
const redisStore = createRedisSessionStore<UserData>(redis, {
  prefix: 'session',
  ttl: 86400, // 24 hours in seconds
  rolling: true, // Reset expiration on each access
});

// Setup session middleware
const sessionMiddleware = createSession({
  sessionUserDataCtx,
  sessionParser: cookieSessionParser(),
  sessionStore: redisStore,
  autoSave: true,
  autoCreateOnMissing: true,
});

// Define request schema
class LoginRequest extends ObjectType {
  username = String;
  password = String;
}

// Create HTTP app
const app = Http();
app.use(sessionMiddleware);

// Login endpoint
app.post('/login', { body: LoginRequest }).use(async (request) => {
  const { username, password } = request.body;
  
  // Your authentication logic here
  sessionUserDataCtx.set({
    userId: 'user-123',
    username: username,
  });
  
  return Response.json({ success: true });
});

// Protected endpoint
app.get('/profile').use(() => {
  const userData = sessionUserDataCtx.get();
  
  if (!userData?.userId) {
    return Response.status(401).json({ error: 'Not authenticated' });
  }
  
  return Response.json(userData);
});

// Logout endpoint
app.post('/logout').use(async () => {
  await sessionUserDataCtx.destroy();
  return Response.json({ success: true });
});

app.listen(3000);
```

## Redis Client Examples

The function overloads provide compile-time type safety for different Redis clients:

### With ioredis

```typescript
import Redis from 'ioredis';
import { createRedisSessionStore } from 'fa-session-redis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  db: 0,
});

// TypeScript automatically infers the correct overload
const store = createRedisSessionStore(redis, {
  prefix: 'app-session',
  ttl: 3600,
});
```

### With node-redis

```typescript
import { createClient } from 'redis';
import { createRedisSessionStore } from 'fa-session-redis';

const redis = createClient({
  url: 'redis://localhost:6379'
});

await redis.connect();

// TypeScript automatically infers the correct overload
const store = createRedisSessionStore(redis, {
  prefix: 'app-session',
  ttl: 3600,
});
```

### Type Safety

```typescript
// ✅ This works - valid Redis client
const validStore = createRedisSessionStore(redisClient, options);

// ❌ This fails at compile time - not a Redis client
const invalidStore = createRedisSessionStore({}, options);
// Error: Argument of type '{}' is not assignable to parameter of type 'IoRedisLike | NodeRedisLike | RedisLikeClient'
```

## Configuration Options

### `createRedisSessionStore(client, options)`

Creates a Redis-backed session store for farrow-auth-session. This function uses TypeScript function overloads to provide compile-time type safety for different Redis client types.

#### Function Overloads

```typescript
// For ioredis clients
function createRedisSessionStore<UserData>(
  client: IoRedisLike,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;

// For node-redis clients  
function createRedisSessionStore<UserData>(
  client: NodeRedisLike,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;

// For generic Redis clients
function createRedisSessionStore<UserData>(
  client: RedisLikeClient,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;
```

#### Parameters

- `client` - Redis client instance (from `redis`, `ioredis`, or compatible package)
- `options` - Configuration options (optional)

#### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `prefix` | `string` | `'session'` | Redis key prefix for sessions |
| `ttl` | `number \| false` | `86400` | Session TTL in seconds. Set to `false` to disable expiration |
| `rolling` | `boolean` | `false` | Reset expiration on each access |
| `renew` | `boolean` | `false` | Renew session when close to expiry |
| `renewBefore` | `number` | `600` | Seconds before expiry to trigger renewal (when `renew` is true) |
| `genSessionId` | `() => string` | `() => ulid()` | Custom session ID generator |
| `defaultData` | `() => UserData` | `() => ({})` | Initial session data creator |

## Session Expiration Strategies

### Rolling Sessions
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 1800, // 30 minutes
  rolling: true,
});
```

### Renewing Sessions
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 3600, // 1 hour
  renew: true,
  renewBefore: 600, // Renew 10 minutes before expiry
});
```

### Fixed Sessions
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 28800, // 8 hours
  rolling: false,
  renew: false,
});
```

### No Expiration
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: false, // No expiration in Redis
});
```

## API Reference

### `createRedisSessionStore<UserData>(client, options)`

Creates a Redis-backed session store implementing the `SessionStore` interface from farrow-auth-session.

**Returns:** `SessionStore<UserData, string>`

### `createNormalizedRedisClient(client)`

Creates a normalized Redis client that provides a consistent API regardless of the underlying Redis client library.

**Returns:** `NormalizedRedisClient`


## Type Definitions

```typescript
// Configuration options for Redis session store
interface RedisSessionStoreOptions<UserData> {
  prefix?: string;
  ttl?: number | false;
  rolling?: boolean;
  renew?: boolean;
  renewBefore?: number;
  genSessionId?: () => string;
  defaultData?: () => UserData;
}

// Interface for ioredis-like clients
interface IoRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  ttl(key: string): Promise<number>;
  mget(...keys: string[]): Promise<(string | null)[]>;
  scan(cursor: number | string, ...args: any[]): Promise<[string, string[]]>;
}

// Interface for node-redis-like clients
interface NodeRedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  setEx(key: string, seconds: number, value: string): Promise<string>;
  del(keyOrKeys: string | string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  mGet(keys: string[]): Promise<(string | null)[]>;
  scanIterator(options: { MATCH?: string; COUNT?: number }): AsyncIterable<string>;
}

// Generic Redis client interface (fallback)
interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string | 'OK' | null>;
  del(key: string | string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
  mGet?(keys: string[]): Promise<(string | null)[]>;
  mget?(keys: string[]): Promise<(string | null)[]>;
  scan?(cursor: number | string, ...args: any[]): Promise<[string, string[]]>;
  scanIterator?(options: { MATCH?: string; COUNT?: number }): AsyncIterable<string>;
}

// Internal normalized client interface
interface NormalizedRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  setex(key: string, seconds: number, value: string): Promise<boolean>;
  del(keyOrKeys: string | string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<boolean>;
  ttl(key: string): Promise<number>;
  mget(keys: string[]): Promise<(string | null)[]>;
  scanIterator(match: string, count: number): AsyncIterable<string>;
}
```

## License

MIT