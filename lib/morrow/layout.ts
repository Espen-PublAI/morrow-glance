import { cellsOf } from '@/lib/morrow/config';
import type { GlanceBlock, GlanceLayout } from '@/lib/morrow/types';

/** Grid math used by Admin. Pure functions so they are easy to test. */

export interface SizePreset {
  label: string;
  span: number;
  rowSpan: number;
}

/** Size presets relative to a page's grid rather than a fixed 12×5. */
export function sizePresetsFor(layout: GlanceLayout): SizePreset[] {
  const third = Math.max(1, Math.round(layout.columns / 3));
  const half = Math.max(1, Math.round(layout.columns / 2));
  const shortRows = Math.max(1, Math.min(2, layout.rows));
  return [
    { label: 'Small', span: third, rowSpan: shortRows },
    { label: 'Medium', span: half, rowSpan: shortRows },
    { label: 'Wide', span: layout.columns, rowSpan: shortRows },
    { label: 'Full', span: layout.columns, rowSpan: layout.rows },
  ];
}

/** Short, URL-safe id with a readable prefix, e.g. `block-m1x2y3-ab12c`. */
export function createId(prefix: string): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 7);
  return `${prefix}-${time}-${random}`;
}

/* ------------------------------------------------------------------------- */
/* Direct manipulation: placing, moving, and resizing blocks on the grid.     */
/* ------------------------------------------------------------------------- */

export interface GridSize {
  span: number;
  rowSpan: number;
}

export interface GridPoint {
  column: number;
  row: number;
}

export type GridRect = GridPoint & GridSize;

export interface PixelBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MIN_SIZE: GridSize = { span: 1, rowSpan: 1 };

/** True when the rect lies entirely inside the grid. */
export function fitsGrid(rect: GridRect, layout: GlanceLayout): boolean {
  return (
    rect.column >= 1 &&
    rect.row >= 1 &&
    rect.span >= 1 &&
    rect.rowSpan >= 1 &&
    rect.column + rect.span - 1 <= layout.columns &&
    rect.row + rect.rowSpan - 1 <= layout.rows
  );
}

/** Shrink to the grid if needed, then shift up/left so the rect fits. */
export function clampToGrid(rect: GridRect, layout: GlanceLayout): GridRect {
  const span = Math.min(Math.max(1, rect.span), layout.columns);
  const rowSpan = Math.min(Math.max(1, rect.rowSpan), layout.rows);
  const column = Math.min(Math.max(1, rect.column), layout.columns - span + 1);
  const row = Math.min(Math.max(1, rect.row), layout.rows - rowSpan + 1);
  return { column, row, span, rowSpan };
}

/** True when the rect fits the grid and overlaps no other block. */
export function canPlace(
  rect: GridRect,
  blocks: GlanceBlock[],
  layout: GlanceLayout,
  ignoreId?: string,
): boolean {
  if (!fitsGrid(rect, layout)) return false;
  const wanted = new Set(cellsOf(rect));
  return blocks.every(
    (block) =>
      block.id === ignoreId || !cellsOf(block).some((cell) => wanted.has(cell)),
  );
}

/** The grid cell under a pixel position, clamped to the grid. */
export function cellAt(
  point: { x: number; y: number },
  bounds: PixelBounds,
  layout: GlanceLayout,
): GridPoint {
  const cellWidth = bounds.width / layout.columns;
  const cellHeight = bounds.height / layout.rows;
  const column = Math.floor((point.x - bounds.left) / cellWidth) + 1;
  const row = Math.floor((point.y - bounds.top) / cellHeight) + 1;
  return {
    column: Math.min(Math.max(1, column), layout.columns),
    row: Math.min(Math.max(1, row), layout.rows),
  };
}

/** Whether the pixel position is inside the canvas. */
export function insideBounds(
  point: { x: number; y: number },
  bounds: PixelBounds,
): boolean {
  return (
    point.x >= bounds.left &&
    point.x <= bounds.left + bounds.width &&
    point.y >= bounds.top &&
    point.y <= bounds.top + bounds.height
  );
}

/** First free top-left position for a block of this size, scanning row by row. */
export function findFreeSlot(
  blocks: GlanceBlock[],
  size: GridSize,
  layout: GlanceLayout,
): GridPoint | undefined {
  const { span, rowSpan } = clampToGrid({ column: 1, row: 1, ...size }, layout);
  for (let row = 1; row <= layout.rows - rowSpan + 1; row += 1) {
    for (let column = 1; column <= layout.columns - span + 1; column += 1) {
      if (canPlace({ column, row, span, rowSpan }, blocks, layout))
        return { column, row };
    }
  }
  return undefined;
}

/**
 * Rect spanning from a fixed top-left anchor to the cell under the pointer,
 * never smaller than `min`, never past the grid edge.
 */
export function resizeToCell(
  anchor: GridPoint,
  corner: GridPoint,
  min: GridSize,
  layout: GlanceLayout,
): GridRect {
  const span = Math.max(min.span, corner.column - anchor.column + 1);
  const rowSpan = Math.max(min.rowSpan, corner.row - anchor.row + 1);
  return {
    column: anchor.column,
    row: anchor.row,
    span: Math.min(span, layout.columns - anchor.column + 1),
    rowSpan: Math.min(rowSpan, layout.rows - anchor.row + 1),
  };
}

/** Largest size a plugin may shrink to on this grid. */
export function minSizeFor(
  min: GridSize | undefined,
  layout: GlanceLayout,
): GridSize {
  return {
    span: Math.min(Math.max(1, min?.span ?? 1), layout.columns),
    rowSpan: Math.min(Math.max(1, min?.rowSpan ?? 1), layout.rows),
  };
}

/**
 * Which of a block's left and top edges are fully shared with neighbouring
 * blocks. Renderers draw dividers on every block's right and bottom edge, and
 * only draw left/top edges that no neighbour already covers, so two adjacent
 * blocks share a single hairline.
 */
export function sharedEdges(
  block: GridRect,
  blocks: Array<GridRect & { id?: string }>,
): { left: boolean; top: boolean } {
  const occupied = new Set<string>();
  for (const other of blocks) {
    if (other === block) continue;
    for (const cell of cellsOf(other)) occupied.add(cell);
  }
  let left = block.column > 1;
  for (let r = block.row; left && r < block.row + block.rowSpan; r += 1) {
    if (!occupied.has(`${r}:${block.column - 1}`)) left = false;
  }
  let top = block.row > 1;
  for (let c = block.column; top && c < block.column + block.span; c += 1) {
    if (!occupied.has(`${block.row - 1}:${c}`)) top = false;
  }
  return { left, top };
}
