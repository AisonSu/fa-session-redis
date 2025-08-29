# Testing fa-session-redis

## Prerequisites

Before running tests, ensure you have Redis installed and running:

```bash
# Using Docker
docker run -d -p 6379:6379 redis

# Or install locally
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt-get install redis-server
sudo systemctl start redis

# Windows
# Download from https://redis.io/download
```

## Running Tests

```bash
# Install dependencies
pnpm install

# Run all tests
pnpm test

# Run tests once (CI mode)
pnpm test:run

# Run tests with coverage
pnpm test:coverage

# Watch mode for development
pnpm test:watch
```

## Test Structure

- `setup.ts` - Test utilities and helpers
- `normalized-client.test.ts` - Unit tests for Redis client normalization
- `session-store.test.ts` - Unit tests for session store functionality
- `integration.test.ts` - Integration tests with farrow-auth

## Environment Variables

You can customize the Redis connection for tests:

```bash
# Redis host (default: localhost)
REDIS_HOST=localhost

# Redis port (default: 6379)
REDIS_PORT=6379

# Redis test database (default: 15)
REDIS_TEST_DB=15
```

## Test Coverage

Run tests with coverage report:

```bash
pnpm test:coverage
```

Coverage report will be generated in:
- Terminal output
- `coverage/` directory (HTML report)

## Debugging Tests

To debug specific tests:

```typescript
// Add .only to run specific test
it.only('should handle specific case', async () => {
  // test code
});

// Or debug entire suite
describe.only('Specific suite', () => {
  // tests
});
```

## Writing New Tests

When adding new features, ensure to:

1. Add unit tests for the specific functionality
2. Add integration tests if it affects the auth flow
3. Test with both ioredis and node-redis clients
4. Test error cases and edge conditions

Example test structure:

```typescript
describe('Feature Name', () => {
    let client: any;
    
    beforeAll(async () => {
        // Setup
    });
    
    afterAll(async () => {
        // Cleanup
    });
    
    it('should handle normal case', async () => {
        // Test implementation
    });
    
    it('should handle error case', async () => {
        // Test error handling
    });
});
```