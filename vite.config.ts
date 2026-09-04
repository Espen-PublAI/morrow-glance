import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

// Self-hosting builds skip the Cloudflare plugin; storage falls back to SQLite.
const selfHosted = process.env.MORROW_TARGET === 'node';

/**
 * `cloudflare:workers` only exists in the Workers runtime. The D1 adapter
 * imports it, and although a self-hosted build never loads that adapter, the
 * bundler still has to resolve the import. Give it a stub that throws if it is
 * ever reached.
 */
const stubCloudflareWorkers = {
  name: 'morrow:stub-cloudflare-workers',
  resolveId(id: string) {
    return id === 'cloudflare:workers' ? '\0morrow:cloudflare-workers' : null;
  },
  load(id: string) {
    if (id !== '\0morrow:cloudflare-workers') return null;
    return [
      'export const env = {};',
      'export const waitUntil = () => {};',
      'export default { env, waitUntil };',
    ].join('\n');
  },
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const cloudflarePlugins = selfHosted
    ? []
    : [
        (await import('@cloudflare/vite-plugin')).cloudflare({
          viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
          config: localBindingConfig,
        }),
      ];

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      ...(selfHosted ? [stubCloudflareWorkers] : []),
      ...cloudflarePlugins,
    ],
  };
});
