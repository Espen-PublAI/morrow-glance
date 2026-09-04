import type { NextConfig } from 'next';

/**
 * `MORROW_TARGET=node` builds the self-hosting bundle at `dist/standalone/`,
 * started with `node dist/standalone/server.js`. Without it the build targets
 * Cloudflare Workers. See the deployment section of the README.
 */
const selfHosted = process.env.MORROW_TARGET === 'node';

const nextConfig: NextConfig = selfHosted ? { output: 'standalone' } : {};

export default nextConfig;
