# fa-session-redis

Redis session store for [farrow-auth](https://github.com/farrow-js/farrow/tree/master/packages/farrow-auth) with support for both [redis](https://github.com/redis/node-redis) and [ioredis](https://github.com/luin/ioredis) clients.

[中文文档](./README_CN.md)

## Features

- 🔄 **Universal Redis Support** - Works with both `redis` and `ioredis` clients through a normalized adapter
- 🎯 **Type-Safe** - Full TypeScript support with complete type inference
- ⚡ **Performance** - Efficient session management with configurable TTL strategies
- 🔒 **Secure** - Server-side session storage
- 🎨 **Flexible** - Multiple session expiration strategies (rolling, renewing, fixed)

## Installation

```bash
npm install fa-session-redis farrow-auth

# Install one of the Redis clients
npm install redis
# or
npm install ioredis
```

## Quick Start

```typescript
import { Http, Response } from 'farrow-http';
import { ObjectType, String } from 'farrow-schema';
import { createAuth, createAuthCtx, cookieSessionParser } from 'farrow-auth';
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

// Create auth context
const authUserDataCtx = createAuthCtx<UserData>({});

// Create Redis session store
const redisStore = createRedisSessionStore<UserData>(redis, {
  prefix: 'session',
  ttl: 86400, // 24 hours in seconds
  rolling: true, // Reset expiration on each access
});

// Setup authentication middleware
const authMiddleware = createAuth({
  authUserDataCtx,
  authParser: cookieSessionParser(),
  authStore: redisStore,
  autoSave: true,
});

// Define request schema
class LoginRequest extends ObjectType {
  username = String;
  password = String;
}

// Create HTTP app
const app = Http();
app.use(authMiddleware);

// Login endpoint
app.post('/login', { body: LoginRequest }).use(async (request) => {
  const { username, password } = request.body;
  
  // Your authentication logic here
  authUserDataCtx.set({
    userId: 'user-123',
    username: username,
  });
  
  return Response.json({ success: true });
});

// Protected endpoint
app.get('/profile').use(() => {
  const userData = authUserDataCtx.get();
  
  if (!userData?.userId) {
    return Response.status(401).json({ error: 'Not authenticated' });
  }
  
  return Response.json(userData);
});

// Logout endpoint
app.post('/logout').use(async () => {
  await authUserDataCtx.destroy();
  return Response.json({ success: true });
});

app.listen(3000);
```

## Configuration Options

### `createRedisSessionStore(client, options)`

Creates a Redis-backed session store for farrow-auth.

#### Parameters

- `client` - Redis client instance (from `redis` or `ioredis` package) or a normalized Redis client
- `options` - Configuration options

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

Creates a Redis-backed session store implementing the `AuthStore` interface from farrow-auth.

**Returns:** `AuthStore<UserData, string>`

### `createNormalizedRedisClient(client)`

Creates a normalized Redis client that provides a consistent API regardless of the underlying Redis client library.

**Returns:** `NormalizedRedisClient`

### `createRedisAuthStore`

Alias for `createRedisSessionStore` for backward compatibility.

## Type Definitions

```typescript
interface RedisSessionStoreOptions<UserData> {
  prefix?: string;
  ttl?: number | false;
  rolling?: boolean;
  renew?: boolean;
  renewBefore?: number;
  genSessionId?: () => string;
  defaultData?: () => UserData;
}

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