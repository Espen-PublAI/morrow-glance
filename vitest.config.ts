import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts so tests do not boot vinext or Cloudflare.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: [
      'lib/**/*.test.ts',
      'db/**/*.test.ts',
      'plugins/**/*.test.ts',
      'plugins/**/*.test.tsx',
      'components/**/*.test.tsx',
    ],
    // Node by default; component tests opt into a DOM with a docblock:
    // `// @vitest-environment happy-dom`
    environment: 'node',
  },
});
