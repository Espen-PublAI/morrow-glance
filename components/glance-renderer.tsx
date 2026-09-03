import type { CSSProperties } from 'react';

import { sharedEdges } from '@/lib/morrow/layout';
import type { BlockData, GlancePage } from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';

/** Renders one page of blocks onto a CSS grid. Shared by Player and Admin. */

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

export function GlanceRenderer({
  page,
  now,
  blockData,
  timeZone,
}: {
  page: GlancePage;
  now: Date;
  /** Latest data per block id, for blocks with a data source. */
  blockData?: Record<string, BlockData>;
  /** The display's timezone, passed to every view. */
  timeZone: string;
}) {
  const layoutStyle: LayoutStyle = {
    '--columns': page.layout.columns,
    '--rows': page.layout.rows,
  };

  return (
    <div className="glance-grid" style={layoutStyle}>
      {page.blocks.map((block) => {
        const plugin = pluginRegistry[block.plugin];
        const content = plugin?.render(block.view, {
          now,
          settings: block.settings ?? {},
          data: blockData?.[block.id],
          timeZone,
        });
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
