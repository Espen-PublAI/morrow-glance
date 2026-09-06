import type { CSSProperties } from 'react';

import { sharedEdges } from '@/lib/morrow/layout';
import {
  blockViewProps,
  type BlockData,
  type DisplayContext,
  type GlancePage,
} from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';

/** Renders one page of blocks onto a CSS grid. */

interface LayoutStyle extends CSSProperties {
  '--columns': number;
  '--rows': number;
}

interface BlockStyle extends CSSProperties {
  '--column': number;
  '--span': number;
  '--row': number;
  '--row-span': number;
}

/**
 * A page with nothing on it. Every clean install starts here, so this is the
 * first thing anyone sees; it says where to go next and then gets out of the
 * way. Quiet enough to leave on a wall.
 */
function EmptyPage() {
  return (
    <div className="glance-empty">
      <p>This page is empty.</p>
      <p className="glance-empty-hint">
        {/* A plain link on purpose: a wall screen should never prefetch the
            Admin bundle, and leaving the Player is a real navigation. */}
        {/* eslint-disable-next-line next/no-html-link-for-pages */}
        Add blocks in <a href="/admin">Admin</a>.
      </p>
    </div>
  );
}

export function GlanceRenderer({
  page,
  display,
  blockData,
}: {
  page: GlancePage;
  /** Time, timezone, and writing conventions, passed to every view. */
  display: DisplayContext;
  /** Latest data per block id, for blocks with a data source. */
  blockData?: Record<string, BlockData>;
}) {
  if (page.blocks.length === 0) return <EmptyPage />;

  const layoutStyle: LayoutStyle = {
    '--columns': page.layout.columns,
    '--rows': page.layout.rows,
  };

  return (
    <div className="glance-grid" style={layoutStyle}>
      {page.blocks.map((block) => {
        const plugin = pluginRegistry[block.plugin];
        const content = plugin?.render(
          block.view,
          blockViewProps(block, display, blockData),
        );
        const style: BlockStyle = {
          '--column': block.column,
          '--span': block.span,
          '--row': block.row,
          '--row-span': block.rowSpan,
        };
        const shared = sharedEdges(block, page.blocks);

        return (
          <section
            className="glance-block"
            key={block.id}
            style={style}
            data-shared-left={shared.left || undefined}
            data-shared-top={shared.top || undefined}
          >
            {content ?? (
              <p className="missing-plugin">
                Missing {block.plugin}/{block.view}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
