import type { PluginServer } from '@/lib/morrow/types';

/**
 * Server-only plugin modules. Every `plugins/<name>/server.ts` that exports
 * `server` is registered under the plugin id declared in the sibling
 * `plugin.tsx`. Import this file from server code only: these modules may
 * read credentials from the environment.
 */

interface ServerModule {
  server?: PluginServer;
}
interface PluginModule {
  plugin?: { manifest: { id: string } };
}

const serverModules = import.meta.glob<ServerModule>(
  ['./*/server.ts', '!./_*/**'],
  {
    eager: true,
  },
);
const pluginModules = import.meta.glob<PluginModule>(
  ['./*/plugin.tsx', '!./_*/**'],
  {
    eager: true,
  },
);

function folderOf(path: string): string {
  return path.split('/')[1] ?? path;
}

const idByFolder = new Map<string, string>();
for (const [path, module] of Object.entries(pluginModules)) {
  if (module.plugin) idByFolder.set(folderOf(path), module.plugin.manifest.id);
}

export const pluginServers: Record<string, PluginServer> = {};
for (const [path, module] of Object.entries(serverModules)) {
  const id = idByFolder.get(folderOf(path));
  if (!module.server || !id) continue;
  pluginServers[id] = module.server;
}
