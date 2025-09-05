# fa-session-redis

用于 [farrow-auth-session](https://github.com/AisonSu/farrow-auth-session) 的 Redis 会话存储，同时支持 [redis](https://github.com/redis/node-redis) 和 [ioredis](https://github.com/luin/ioredis) 客户端。

[English Documentation](./README.md)

## 特性

- 🔄 **通用 Redis 支持** - 通过标准化适配器同时兼容 `redis` 和 `ioredis` 客户端
- 🎯 **类型安全** - 完整的 TypeScript 支持和类型推导
- ⚡ **高性能** - 高效的会话管理，支持可配置的 TTL 策略
- 🔒 **安全** - 服务端会话存储
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

## 配置选项

### `createRedisSessionStore(client, options)`

创建用于 farrow-auth-session 的 Redis 会话存储。

#### 参数

- `client` - Redis 客户端实例（来自 `redis` 或 `ioredis` 包）或标准化的 Redis 客户端
- `options` - 配置选项

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

## 许可证

MIT