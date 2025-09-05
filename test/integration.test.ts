import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Http, Response } from 'farrow-http';
import { ObjectType, String } from 'farrow-schema';
import { createSession, createSessionCtx, cookieSessionParser } from 'farrow-auth-session';
import { createTestRedisClients, cleanupTestData, closeClients, wait } from './setup';
import { createRedisSessionStore } from '../src';
import request from 'supertest';

type UserData = {
    userId?: string;
    username?: string;
    role?: string;
};

describe('Integration with farrow-auth-session', () => {
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
        // 清理 integration 测试相关的数据
        await cleanupTestData(ioredisClient, 'test:auth*');
        await cleanupTestData(ioredisClient, 'test:expiry*');
        await cleanupTestData(ioredisClient, 'test:rolling*');
        await cleanupTestData(nodeRedisClient, 'test:noderedis*');
    });

    describe('Complete authentication flow', () => {
        it('should handle login, session persistence, and logout', async () => {
            // Setup
            const sessionUserDataCtx = createSessionCtx<UserData>({});
            const redisStore = createRedisSessionStore<UserData>(ioredisClient, {
                prefix: 'test:auth',
                ttl: 3600,
            });

            const sessionMiddleware = createSession({
                sessionUserDataCtx,
                sessionParser: cookieSessionParser({
                    sessionIdKey: 'test-sid',
                    cookieOptions: {
                        httpOnly: true,
                        maxAge: 3600000,
                    },
                }),
                sessionStore: redisStore,
                autoSave: true,
                autoCreateOnMissing: true,
            });

            // Define login request schema
            class LoginRequest extends ObjectType {
                username = String;
                password = String;
            }

            // Define profile update schema
            class ProfileUpdateRequest extends ObjectType {
                role = String;
            }

            const app = Http();
            app.use(sessionMiddleware);

            // Login endpoint with schema validation
            app.post('/login', { body: LoginRequest }).use(async (request) => {
                const { username, password } = request.body;
                
                if (username === 'testuser' && password === 'testpass') {
                    sessionUserDataCtx.set({
                        userId: 'user-123',
                        username: 'testuser',
                        role: 'user',
                    });
                    return Response.json({ success: true });
                }
                
                return Response.status(401).json({ error: 'Invalid credentials' });
            });

            // Protected endpoint
            app.get('/profile').use(() => {
                const userData = sessionUserDataCtx.get();
                
                if (!userData?.userId) {
                    return Response.status(401).json({ error: 'Not authenticated' });
                }
                
                return Response.json(userData);
            });

            // Update profile endpoint
            app.put('/profile', { body: ProfileUpdateRequest }).use((request) => {
                const userData = sessionUserDataCtx.get();
                
                if (!userData?.userId) {
                    return Response.status(401).json({ error: 'Not authenticated' });
                }
                
                const updated = { ...userData, ...request.body };
                sessionUserDataCtx.set(updated);
                
                return Response.json(updated);
            });

            // Logout endpoint
            app.post('/logout').use(async () => {
                await sessionUserDataCtx.destroy();
                return Response.json({ success: true });
            });

            const server = app.server();
            const agent = request.agent(server);

            // Test login
            const loginRes = await agent
                .post('/login')
                .send({ username: 'testuser', password: 'testpass' })
                .expect(200);
            
            expect(loginRes.body).toEqual({ success: true });
            expect(loginRes.headers['set-cookie']).toBeDefined();

            // Extract session cookie
            const cookies = loginRes.headers['set-cookie'];
            expect(cookies[0]).toContain('test-sid=');

            // Test accessing protected route with session
            const profileRes = await agent
                .get('/profile')
                .expect(200);
            
            expect(profileRes.body).toMatchObject({
                userId: 'user-123',
                username: 'testuser',
                role: 'user',
            });

            // Test updating profile
            const updateRes = await agent
                .put('/profile')
                .send({ role: 'admin' })
                .expect(200);
            
            expect(updateRes.body.role).toBe('admin');

            // Verify update persisted
            const verifyRes = await agent
                .get('/profile')
                .expect(200);
            
            expect(verifyRes.body.role).toBe('admin');

            // Test logout
            const logoutRes = await agent
                .post('/logout')
                .expect(200);
            
            expect(logoutRes.body).toEqual({ success: true });

            // Test accessing protected route after logout
            await agent
                .get('/profile')
                .expect(401);
        });

        it('should handle session expiry', async () => {
            const sessionUserDataCtx = createSessionCtx<UserData>({});
            const redisStore = createRedisSessionStore<UserData>(ioredisClient, {
                prefix: 'test:expire',
                ttl: 2, // 2 seconds
            });

            const sessionMiddleware = createSession({
                sessionUserDataCtx,
                sessionParser: cookieSessionParser({
                    sessionIdKey: 'expire-sid',
                }),
                sessionStore: redisStore,
                autoSave: true,
                autoCreateOnMissing: true,
            });

            const app = Http();
            app.use(sessionMiddleware);

            class LoginRequest extends ObjectType {
                username = String;
                password = String;
            }

            app.post('/login', { body: LoginRequest }).use(() => {
                sessionUserDataCtx.set({
                    userId: 'expire-user',
                    username: 'expiretest',
                });
                return Response.json({ success: true });
            });

            app.get('/check').use(() => {
                const userData = sessionUserDataCtx.get();
                return Response.json({ authenticated: !!userData?.userId });
            });

            const server = app.server();
            const agent = request.agent(server);

            // Login
            await agent
                .post('/login')
                .send({ username: 'test', password: 'test' })
                .expect(200);

            // Check immediately - should be authenticated
            const check1 = await agent.get('/check').expect(200);
            expect(check1.body.authenticated).toBe(true);

            // Wait for session to expire
            await wait(3000);

            // Check after expiry - should not be authenticated
            const check2 = await agent.get('/check').expect(200);
            expect(check2.body.authenticated).toBe(false);
        });

        it('should handle rolling sessions', async () => {
            const sessionUserDataCtx = createSessionCtx<UserData>({});
            const redisStore = createRedisSessionStore<UserData>(ioredisClient, {
                prefix: 'test:rolling',
                ttl: 3, // 3 seconds
                rolling: true,
            });

            const sessionMiddleware = createSession({
                sessionUserDataCtx,
                sessionParser: cookieSessionParser({
                    sessionIdKey: 'rolling-sid',
                }),
                sessionStore: redisStore,
                autoSave: true,
                autoCreateOnMissing: true,
            });

            const app = Http();
            app.use(sessionMiddleware);

            class LoginRequest extends ObjectType {
                username = String;
                password = String;
            }

            app.post('/login', { body: LoginRequest }).use(() => {
                sessionUserDataCtx.set({
                    userId: 'rolling-user',
                    username: 'rollingtest',
                });
                return Response.json({ success: true });
            });

            app.get('/check').use(() => {
                const userData = sessionUserDataCtx.get();
                return Response.json({ authenticated: !!userData?.userId });
            });

            const server = app.server();
            const agent = request.agent(server);

            // Login
            await agent
                .post('/login')
                .send({ username: 'test', password: 'test' })
                .expect(200);

            // Make requests every 2 seconds to keep session alive
            for (let i = 0; i < 3; i++) {
                await wait(2000);
                const check = await agent.get('/check').expect(200);
                expect(check.body.authenticated).toBe(true);
            }

            // Total time elapsed: 6 seconds
            // Without rolling, session would have expired after 3 seconds
            // With rolling, session should still be active
            const finalCheck = await agent.get('/check').expect(200);
            expect(finalCheck.body.authenticated).toBe(true);
        });
    });

    describe('Multiple client support', () => {
        it('should work with node-redis client', async () => {
            const sessionUserDataCtx = createSessionCtx<UserData>({});
            const redisStore = createRedisSessionStore<UserData>(nodeRedisClient, {
                prefix: 'test:noderedis',
                ttl: 3600,
            });

            const sessionMiddleware = createSession({
                sessionUserDataCtx,
                sessionParser: cookieSessionParser({
                    sessionIdKey: 'node-sid',
                }),
                sessionStore: redisStore,
                autoSave: true,
                autoCreateOnMissing: true,
            });

            const app = Http();
            app.use(sessionMiddleware);

            class LoginRequest extends ObjectType {
                username = String;
                password = String;
            }

            app.post('/login', { body: LoginRequest }).use(() => {
                sessionUserDataCtx.set({
                    userId: 'node-user',
                    username: 'nodetest',
                });
                return Response.json({ success: true });
            });

            app.get('/profile').use(() => {
                const userData = sessionUserDataCtx.get();
                if (!userData?.userId) {
                    return Response.status(401).json({ error: 'Not authenticated' });
                }
                return Response.json(userData);
            });

            const server = app.server();
            const agent = request.agent(server);

            // Login
            await agent
                .post('/login')
                .send({ username: 'test', password: 'test' })
                .expect(200);

            // Access protected route
            const profileRes = await agent.get('/profile').expect(200);
            expect(profileRes.body).toMatchObject({
                userId: 'node-user',
                username: 'nodetest',
            });
        });
    });
});