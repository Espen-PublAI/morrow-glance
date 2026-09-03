import { ownSource, type SourceResolver } from '@/lib/morrow/sources';
import type { BlockDataSource, GlanceBlock } from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';

/**
 * The source Morrow Server should use for a block: a hand-configured one wins,
 * otherwise the plugin may derive one from the block's settings.
 */
export const resolveBlockSource: SourceResolver = (
  block: GlanceBlock,
): BlockDataSource | undefined => {
  const own = ownSource(block);
  if (own) return own;
  const derive = pluginRegistry[block.plugin]?.manifest.source;
  if (!derive) return undefined;
  try {
    return derive(block.settings ?? {});
  } catch {
    return undefined;
  }
};
