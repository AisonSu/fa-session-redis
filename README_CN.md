# fa-session-redis

用于 [farrow-auth-session](https://github.com/AisonSu/farrow-auth-session) 的 Redis 会话存储，同时支持 [redis](https://github.com/redis/node-redis) 和 [ioredis](https://github.com/luin/ioredis) 客户端。

[English Documentation](./README.md)

## 特性

- 🔄 **通用 Redis 支持** - 通过函数重载和标准化适配器同时兼容 `redis` 和 `ioredis` 客户端
- 🎯 **类型安全** - 完整的 TypeScript 支持，使用函数重载进行编译时类型检查
- ⚡ **高性能** - 高效的会话管理，支持可配置的 TTL 策略
- 🔒 **安全** - 服务端会话存储，使用 ULID 生成会话 ID
- 🎨 **灵活** - 多种会话过期策略（滚动、续期、固定）

## 安装

```bash
npm install fa-session-redis farrow-auth-session

# 安装 Redis 客户端
npm install redis
# 或
npm install ioredis
```

## 快速开始

```typescript
import { Http, Response } from 'farrow-http';
import { ObjectType, String } from 'farrow-schema';
import { createSession, createSessionCtx, cookieSessionParser } from 'farrow-auth-session';
import { createRedisSessionStore } from 'fa-session-redis';
import Redis from 'ioredis';

// 创建 Redis 客户端
const redis = new Redis();

// 定义用户数据类型
type UserData = {
  userId?: string;
  username?: string;
  role?: string;
};

// 创建会话上下文
const sessionUserDataCtx = createSessionCtx<UserData>({});

// 创建 Redis 会话存储
const redisStore = createRedisSessionStore<UserData>(redis, {
  prefix: 'session',
  ttl: 86400, // 24 小时（秒）
  rolling: true, // 每次访问时重置过期时间
});

// 设置会话中间件
const sessionMiddleware = createSession({
  sessionUserDataCtx,
  sessionParser: cookieSessionParser(),
  sessionStore: redisStore,
  autoSave: true,
  autoCreateOnMissing: true,
});

// 定义请求 schema
class LoginRequest extends ObjectType {
  username = String;
  password = String;
}

// 创建 HTTP 应用
const app = Http();
app.use(sessionMiddleware);

// 登录端点
app.post('/login', { body: LoginRequest }).use(async (request) => {
  const { username, password } = request.body;
  
  // 你的认证逻辑
  sessionUserDataCtx.set({
    userId: 'user-123',
    username: username,
  });
  
  return Response.json({ success: true });
});

// 受保护的端点
app.get('/profile').use(() => {
  const userData = sessionUserDataCtx.get();
  
  if (!userData?.userId) {
    return Response.status(401).json({ error: 'Not authenticated' });
  }
  
  return Response.json(userData);
});

// 登出端点
app.post('/logout').use(async () => {
  await sessionUserDataCtx.destroy();
  return Response.json({ success: true });
});

app.listen(3000);
```

## Redis 客户端示例

函数重载为不同的 Redis 客户端提供编译时类型安全：

### 使用 ioredis

```typescript
import Redis from 'ioredis';
import { createRedisSessionStore } from 'fa-session-redis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  db: 0,
});

// TypeScript 自动推断正确的重载
const store = createRedisSessionStore(redis, {
  prefix: 'app-session',
  ttl: 3600,
});
```

### 使用 node-redis

```typescript
import { createClient } from 'redis';
import { createRedisSessionStore } from 'fa-session-redis';

const redis = createClient({
  url: 'redis://localhost:6379'
});

await redis.connect();

// TypeScript 自动推断正确的重载
const store = createRedisSessionStore(redis, {
  prefix: 'app-session',
  ttl: 3600,
});
```

### 类型安全

```typescript
// ✅ 正确 - 有效的 Redis 客户端
const validStore = createRedisSessionStore(redisClient, options);

// ❌ 编译时报错 - 不是 Redis 客户端
const invalidStore = createRedisSessionStore({}, options);
// 错误：类型"{}"的参数不能赋给类型"IoRedisLike | NodeRedisLike | RedisLikeClient"的参数
```

## 配置选项

### `createRedisSessionStore(client, options)`

创建用于 farrow-auth-session 的 Redis 会话存储。此函数使用 TypeScript 函数重载为不同的 Redis 客户端类型提供编译时类型安全。

#### 函数重载

```typescript
// 适用于 ioredis 客户端
function createRedisSessionStore<UserData>(
  client: IoRedisLike,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;

// 适用于 node-redis 客户端
function createRedisSessionStore<UserData>(
  client: NodeRedisLike,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;

// 适用于通用 Redis 客户端
function createRedisSessionStore<UserData>(
  client: RedisLikeClient,
  options?: RedisSessionStoreOptions<UserData>
): SessionStore<UserData, string>;
```

#### 参数

- `client` - Redis 客户端实例（来自 `redis`、`ioredis` 或兼容的包）
- `options` - 配置选项（可选）

#### 选项

| 选项 | 类型 | 默认值 | 描述 |
|--------|------|---------|-------------|
| `prefix` | `string` | `'session'` | Redis 键前缀 |
| `ttl` | `number \| false` | `86400` | 会话 TTL（秒）。设为 `false` 禁用过期 |
| `rolling` | `boolean` | `false` | 每次访问时重置过期时间 |
| `renew` | `boolean` | `false` | 接近过期时续期会话 |
| `renewBefore` | `number` | `600` | 过期前多少秒触发续期（当 `renew` 为 true 时） |
| `genSessionId` | `() => string` | `() => ulid()` | 自定义会话 ID 生成器 |
| `defaultData` | `() => UserData` | `() => ({})` | 初始会话数据创建器 |

## 会话过期策略

### 滚动会话
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 1800, // 30 分钟
  rolling: true,
});
```

### 续期会话
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 3600, // 1 小时
  renew: true,
  renewBefore: 600, // 过期前 10 分钟续期
});
```

### 固定会话
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: 28800, // 8 小时
  rolling: false,
  renew: false,
});
```

### 无过期
```typescript
const redisStore = createRedisSessionStore(redis, {
  ttl: false, // Redis 中不设置过期
});
```

## API 参考

### `createRedisSessionStore<UserData>(client, options)`

创建实现了 farrow-auth-session 的 `SessionStore` 接口的 Redis 会话存储。

**返回：** `SessionStore<UserData, string>`

### `createNormalizedRedisClient(client)`

创建标准化的 Redis 客户端，无论底层使用的是哪种 Redis 客户端库，都提供一致的 API。

**返回：** `NormalizedRedisClient`


## 类型定义

```typescript
// Redis 会话存储配置选项
interface RedisSessionStoreOptions<UserData> {
  prefix?: string;
  ttl?: number | false;
  rolling?: boolean;
  renew?: boolean;
  renewBefore?: number;
  genSessionId?: () => string;
  defaultData?: () => UserData;
}

// ioredis 类客户端接口
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

// node-redis 类客户端接口
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

// 通用 Redis 客户端接口（回退）
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

// 内部标准化客户端接口
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

## 许可证

MIT