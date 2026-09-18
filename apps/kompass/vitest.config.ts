import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // Sonst wirft der blosse Import von `@/lib/mcp` im Test.
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
