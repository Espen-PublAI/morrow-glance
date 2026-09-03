import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so tests do not boot vinext or Cloudflare.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.test.ts', 'db/**/*.test.ts', 'plugins/**/*.test.ts'],
    environment: 'node',
  },
});
