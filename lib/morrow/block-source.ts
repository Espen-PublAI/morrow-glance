import { ownSource, type SourceResolver } from '@/lib/morrow/sources';
import type { BlockDataSource, GlanceBlock } from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';
import { pluginServers } from '@/plugins/server';

/**
 * The source Morrow Server should use for a block, in order: a hand-configured
 * one, one the plugin derives from settings, or the plugin's own server fetch.
 */
export const resolveBlockSource: SourceResolver = (
  block: GlanceBlock,
): BlockDataSource | undefined => {
  const own = ownSource(block);
  if (own) return own;
  const derive = pluginRegistry[block.plugin]?.manifest.source;
  if (derive) {
    try {
      const derived = derive(block.settings ?? {});
      if (derived) return derived;
    } catch {
      // A plugin that throws on incomplete settings simply has no source yet.
    }
  }
  const server = pluginServers[block.plugin];
  if (server)
    return { kind: 'plugin', intervalSeconds: server.intervalSeconds };
  return undefined;
};
