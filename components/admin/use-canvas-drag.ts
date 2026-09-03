'use client';

import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  canPlace,
  cellAt,
  clampToGrid,
  insideBounds,
  minSizeFor,
  resizeToCell,
  type GridPoint,
  type GridRect,
  type GridSize,
} from '@/lib/morrow/layout';
import type {
  GlanceBlock,
  GlanceLayout,
  PluginRuntime,
} from '@/lib/morrow/types';

/**
 * Pointer-driven placement for the Admin canvas: drag a plugin in from the
 * library, move a block, or resize one from its corner. Everything snaps to
 * grid cells; the caller only ever receives a valid `GridRect`.
 */

/** Pixels the pointer must travel before a press becomes a drag. */
const DRAG_THRESHOLD = 6;

export type DragKind = 'add' | 'move' | 'resize';

export interface DragGhost extends GridRect {
  valid: boolean;
}

interface Session {
  kind: DragKind;
  pointerId: number;
  origin: { x: number; y: number };
  moved: boolean;
  size: GridSize;
  min: GridSize;
  plugin?: PluginRuntime;
  blockId?: string;
  anchor?: GridPoint;
  grab?: { columns: number; rows: number };
}

interface Options {
  canvasRef: RefObject<HTMLElement | null>;
  layout: GlanceLayout;
  blocks: GlanceBlock[];
  onAdd: (plugin: PluginRuntime, rect: GridRect) => void;
  onMove: (blockId: string, rect: GridRect) => void;
  onResize: (blockId: string, rect: GridRect) => void;
}

export function useCanvasDrag({
  canvasRef,
  layout,
  blocks,
  onAdd,
  onMove,
  onResize,
}: Options) {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const ghostRef = useRef<DragGhost | null>(null);
  const suppressClick = useRef(false);

  // Latest values for the window listeners, which outlive a render.
  const latest = useRef({ layout, blocks, onAdd, onMove, onResize });
  useEffect(() => {
    latest.current = { layout, blocks, onAdd, onMove, onResize };
  }, [layout, blocks, onAdd, onMove, onResize]);

  const canvasBounds = useCallback(() => {
    const element = canvasRef.current;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }, [canvasRef]);

  const updateGhost = useCallback((next: DragGhost | null) => {
    ghostRef.current = next;
    setGhost(next);
  }, []);

  const listeners = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
  } | null>(null);

  const finish = useCallback(() => {
    const current = session.current;
    session.current = null;
    const active = listeners.current;
    if (active) {
      window.removeEventListener('pointermove', active.move);
      window.removeEventListener('pointerup', active.up);
      window.removeEventListener('pointercancel', active.cancel);
      listeners.current = null;
    }
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    suppressClick.current = current?.moved ?? false;
    updateGhost(null);
    setDragging(null);
    setActiveBlockId(null);
  }, [updateGhost]);

  const handleMove = useCallback(
    (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const point = { x: event.clientX, y: event.clientY };

      if (!current.moved) {
        const distance = Math.hypot(
          point.x - current.origin.x,
          point.y - current.origin.y,
        );
        if (distance < DRAG_THRESHOLD) return;
        current.moved = true;
        setDragging(current.kind);
        setActiveBlockId(current.blockId ?? null);
        document.body.style.cursor =
          current.kind === 'resize' ? 'nwse-resize' : 'grabbing';
        document.body.style.userSelect = 'none';
      }

      const bounds = canvasBounds();
      if (!bounds) return;
      const { layout: grid, blocks: placed } = latest.current;

      if (current.kind === 'add') {
        if (!insideBounds(point, bounds)) {
          updateGhost(null);
          return;
        }
        const cell = cellAt(point, bounds, grid);
        const rect = clampToGrid(
          {
            column: cell.column - Math.floor((current.size.span - 1) / 2),
            row: cell.row - Math.floor((current.size.rowSpan - 1) / 2),
            ...current.size,
          },
          grid,
        );
        updateGhost({ ...rect, valid: canPlace(rect, placed, grid) });
        return;
      }

      const cell = cellAt(point, bounds, grid);
      if (current.kind === 'move' && current.grab) {
        const rect = clampToGrid(
          {
            column: cell.column - current.grab.columns,
            row: cell.row - current.grab.rows,
            ...current.size,
          },
          grid,
        );
        updateGhost({
          ...rect,
          valid: canPlace(rect, placed, grid, current.blockId),
        });
        return;
      }

      if (current.kind === 'resize' && current.anchor) {
        const rect = resizeToCell(current.anchor, cell, current.min, grid);
        updateGhost({
          ...rect,
          valid: canPlace(rect, placed, grid, current.blockId),
        });
      }
    },
    [canvasBounds, updateGhost],
  );

  const handleUp = useCallback(
    (event: PointerEvent) => {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const drop = ghostRef.current;
      if (current.moved && drop?.valid) {
        const { column, row, span, rowSpan } = drop;
        const rect = { column, row, span, rowSpan };
        if (current.kind === 'add' && current.plugin)
          latest.current.onAdd(current.plugin, rect);
        if (current.kind === 'move' && current.blockId)
          latest.current.onMove(current.blockId, rect);
        if (current.kind === 'resize' && current.blockId) {
          latest.current.onResize(current.blockId, rect);
        }
      }
      finish();
    },
    [finish],
  );

  const start = useCallback(
    (
      event: ReactPointerEvent,
      partial: Omit<Session, 'pointerId' | 'origin' | 'moved'>,
    ) => {
      if (event.button !== 0 || session.current) return;
      session.current = {
        ...partial,
        pointerId: event.pointerId,
        origin: { x: event.clientX, y: event.clientY },
        moved: false,
      };
      const active = { move: handleMove, up: handleUp, cancel: finish };
      listeners.current = active;
      window.addEventListener('pointermove', active.move);
      window.addEventListener('pointerup', active.up);
      window.addEventListener('pointercancel', active.cancel);
    },
    [finish, handleMove, handleUp],
  );

  useEffect(() => finish, [finish]);

  const beginAdd = useCallback(
    (event: ReactPointerEvent, plugin: PluginRuntime) => {
      const size = clampToGrid(
        { column: 1, row: 1, ...plugin.manifest.defaultSize },
        layout,
      );
      start(event, {
        kind: 'add',
        plugin,
        size: { span: size.span, rowSpan: size.rowSpan },
        min: minSizeFor(plugin.manifest.minSize, layout),
      });
    },
    [layout, start],
  );

  const beginMove = useCallback(
    (event: ReactPointerEvent, block: GlanceBlock) => {
      const bounds = canvasBounds();
      if (!bounds) return;
      const cell = cellAt(
        { x: event.clientX, y: event.clientY },
        bounds,
        layout,
      );
      start(event, {
        kind: 'move',
        blockId: block.id,
        size: { span: block.span, rowSpan: block.rowSpan },
        min: { span: 1, rowSpan: 1 },
        grab: {
          columns: cell.column - block.column,
          rows: cell.row - block.row,
        },
      });
    },
    [canvasBounds, layout, start],
  );

  const beginResize = useCallback(
    (
      event: ReactPointerEvent,
      block: GlanceBlock,
      min: GridSize | undefined,
    ) => {
      event.stopPropagation();
      start(event, {
        kind: 'resize',
        blockId: block.id,
        size: { span: block.span, rowSpan: block.rowSpan },
        min: minSizeFor(min, layout),
        anchor: { column: block.column, row: block.row },
      });
    },
    [layout, start],
  );

  /** True once, right after a drag, so the trailing click can be ignored. */
  const consumeClick = useCallback(() => {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }, []);

  return {
    ghost,
    dragging,
    activeBlockId,
    beginAdd,
    beginMove,
    beginResize,
    consumeClick,
  };
}
