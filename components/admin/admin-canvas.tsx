'use client';

import { LayoutGrid, X } from 'lucide-react';
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent,
  RefObject,
} from 'react';
import { useEffect, useRef } from 'react';

import { PluginIcon } from '@/components/admin/plugin-icon';
import type { DragGhost, DragKind } from '@/components/admin/use-canvas-drag';
import { sharedEdges } from '@/lib/morrow/layout';
import type {
  BlockData,
  GlanceBlock,
  GlancePage,
  MorrowColor,
  PluginRuntime,
} from '@/lib/morrow/types';

interface GridStyle extends CSSProperties {
  '--admin-columns': number;
  '--admin-rows': number;
}

interface CellStyle extends CSSProperties {
  '--admin-column': number;
  '--admin-span': number;
  '--admin-row': number;
  '--admin-row-span': number;
}

function cellStyle(
  rect: Pick<GlanceBlock, 'column' | 'span' | 'row' | 'rowSpan'>,
): CellStyle {
  return {
    '--admin-column': rect.column,
    '--admin-span': rect.span,
    '--admin-row': rect.row,
    '--admin-row-span': rect.rowSpan,
  };
}

interface AdminCanvasProps {
  canvasRef: RefObject<HTMLDivElement | null>;
  page: GlancePage;
  color: MorrowColor;
  now: Date;
  blockData: Record<string, BlockData>;
  registry: Record<string, PluginRuntime>;
  selectedBlockId: string | null;
  ghost: DragGhost | null;
  dragging: DragKind | null;
  draggingBlockId: string | null;
  onSelect: (blockId: string) => void;
  /** Called when the user clicks empty canvas or the margin around it. */
  onDeselect: () => void;
  onBlockPointerDown: (
    event: PointerEvent<HTMLElement>,
    block: GlanceBlock,
  ) => void;
  onResizePointerDown: (
    event: PointerEvent<HTMLElement>,
    block: GlanceBlock,
    plugin: PluginRuntime | undefined,
  ) => void;
  onBlockKeyDown: (
    event: KeyboardEvent<HTMLElement>,
    block: GlanceBlock,
  ) => void;
  onRemoveBlock: (blockId: string) => void;
  consumeClick: () => boolean;
}

/** The page grid in Admin. Blocks can be selected, dragged, resized, and nudged. */
export function AdminCanvas({
  canvasRef,
  page,
  color,
  now,
  blockData,
  registry,
  selectedBlockId,
  ghost,
  dragging,
  draggingBlockId,
  onSelect,
  onDeselect,
  onBlockPointerDown,
  onResizePointerDown,
  onBlockKeyDown,
  onRemoveBlock,
  consumeClick,
}: AdminCanvasProps) {
  const gridStyle: GridStyle = {
    '--admin-columns': page.layout.columns,
    '--admin-rows': page.layout.rows,
  };
  const showEmptyState = page.blocks.length === 0 && !ghost;
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Clicking empty canvas (or the margin around it) clears the selection. Attached
  // as a listener rather than a JSX handler: the wrapper is not a control, it is
  // the "outside" that a selection should respond to.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.admin-block, .block-tools, .resize-handle')) return;
      if (consumeClick()) return;
      onDeselect();
    };
    wrap.addEventListener('click', onClick);
    return () => wrap.removeEventListener('click', onClick);
  }, [consumeClick, onDeselect]);

  return (
    <div ref={wrapRef} className="canvas-wrap" data-color={color}>
      <div
        ref={canvasRef}
        className={dragging ? 'admin-canvas is-dragging' : 'admin-canvas'}
        style={gridStyle}
      >
        {page.blocks.map((block) => {
          const plugin = registry[block.plugin];
          const selected = block.id === selectedBlockId;
          const shared = sharedEdges(block, page.blocks);
          const classes = [
            'admin-block',
            selected ? 'is-selected' : '',
            block.id === draggingBlockId ? 'is-dragging' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <button
              key={block.id}
              type="button"
              aria-pressed={selected}
              aria-label={`${plugin?.manifest.name ?? block.plugin} block, columns ${block.column} to ${block.column + block.span - 1}, rows ${block.row} to ${block.row + block.rowSpan - 1}`}
              className={classes}
              style={cellStyle(block)}
              data-shared-left={shared.left || undefined}
              data-shared-top={shared.top || undefined}
              onPointerDown={(event) => onBlockPointerDown(event, block)}
              onClick={() => {
                if (!consumeClick()) onSelect(block.id);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(block.id);
                  return;
                }
                onBlockKeyDown(event, block);
              }}
            >
              <span className="block-chip">
                <PluginIcon plugin={plugin} />{' '}
                {plugin?.manifest.name ?? block.plugin}
              </span>
              <div className="admin-block-content">
                {plugin?.render(block.view, {
                  now,
                  settings: block.settings ?? {},
                  data: blockData[block.id],
                })}
              </div>
              {selected && (
                <span
                  className="resize-handle"
                  aria-hidden="true"
                  onPointerDown={(event) =>
                    onResizePointerDown(event, block, plugin)
                  }
                />
              )}
            </button>
          );
        })}

        {page.blocks
          .filter((block) => block.id === selectedBlockId)
          .map((block) => {
            const plugin = registry[block.plugin];
            return (
              <div
                key={`tools-${block.id}`}
                className="block-tools"
                style={cellStyle(block)}
              >
                <span className="block-chip">
                  <PluginIcon plugin={plugin} />{' '}
                  {plugin?.manifest.name ?? block.plugin}
                </span>
                <button
                  type="button"
                  className="block-remove"
                  aria-label="Remove block"
                  title="Remove block"
                  onClick={() => onRemoveBlock(block.id)}
                >
                  <X />
                </button>
              </div>
            );
          })}

        {ghost && (
          <div
            className={ghost.valid ? 'admin-ghost' : 'admin-ghost is-invalid'}
            style={cellStyle(ghost)}
            aria-hidden="true"
          >
            <span>
              {ghost.span} × {ghost.rowSpan}
            </span>
          </div>
        )}

        {showEmptyState && (
          <div className="empty-canvas">
            <LayoutGrid />
            <strong>Empty page</strong>
            <span>Drag a plugin here, or click one in the library.</span>
          </div>
        )}
      </div>
    </div>
  );
}
