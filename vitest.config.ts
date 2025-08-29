import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'dist/',
                'test/',
                '*.config.ts',
            ],
        },
        testTimeout: 20000, // 20 seconds for Redis operations
        hookTimeout: 10000,
        // 串行运行测试以避免 Redis 数据竞争
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
    },
});