import { ownSource, type SourceResolver } from '@/lib/morrow/sources';
import type { BlockDataSource, GlanceBlock } from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';
import { pluginServers } from '@/plugins/server';

/**
 * The source Morrow Server should use for a block, in order: a hand-configured
 * one, one the plugin derives from settings, or the plugin's own server fetch.
 *
 * This lives beside the data layer rather than in `lib/morrow` because it needs
 * the plugin registries. Keeping it here leaves `lib/morrow` a leaf that
 * depends on nothing else in the project, which is what makes it easy to test
 * and to reason about. `lib/morrow/sources.ts` declares the `SourceResolver`
 * type and every function that needs one takes it as a parameter.
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
