import { describe, expect, it } from 'vitest';

import {
  MIN_SIZE,
  canPlace,
  cellAt,
  clampToGrid,
  createId,
  findFreeSlot,
  fitsGrid,
  insideBounds,
  minSizeFor,
  resizeToCell,
  sharedEdges,
  sizePresetsFor,
} from '@/lib/morrow/layout';
import type { GlanceBlock } from '@/lib/morrow/types';

const make = (id: string, span: number, rowSpan: number): GlanceBlock => ({
  id,
  plugin: 'morrow.text',
  view: 'note',
  column: 1,
  row: 1,
  span,
  rowSpan,
});

describe('sizePresetsFor', () => {
  it('derives presets from the page grid', () => {
    expect(sizePresetsFor({ columns: 12, rows: 5 })).toEqual([
      { label: 'Small', span: 4, rowSpan: 2 },
      { label: 'Medium', span: 6, rowSpan: 2 },
      { label: 'Wide', span: 12, rowSpan: 2 },
      { label: 'Full', span: 12, rowSpan: 5 },
    ]);
    expect(sizePresetsFor({ columns: 2, rows: 1 })).toEqual([
      { label: 'Small', span: 1, rowSpan: 1 },
      { label: 'Medium', span: 1, rowSpan: 1 },
      { label: 'Wide', span: 2, rowSpan: 1 },
      { label: 'Full', span: 2, rowSpan: 1 },
    ]);
  });
});

describe('createId', () => {
  it('produces prefixed ids that pass configuration validation', () => {
    const id = createId('block');
    expect(id).toMatch(/^block-[a-z0-9]+-[a-z0-9]{5}$/);
    expect(createId('block')).not.toBe(id);
  });
});

describe('direct manipulation helpers', () => {
  const layout = { columns: 12, rows: 5 };
  const blocks = [make('a', 4, 2)]; // occupies columns 1-4, rows 1-2

  it('fitsGrid and clampToGrid keep rects inside the grid', () => {
    expect(fitsGrid({ column: 9, row: 4, span: 4, rowSpan: 2 }, layout)).toBe(
      true,
    );
    expect(fitsGrid({ column: 10, row: 4, span: 4, rowSpan: 2 }, layout)).toBe(
      false,
    );
    expect(
      clampToGrid({ column: 11, row: 5, span: 4, rowSpan: 2 }, layout),
    ).toEqual({
      column: 9,
      row: 4,
      span: 4,
      rowSpan: 2,
    });
    expect(
      clampToGrid({ column: 0, row: 0, span: 40, rowSpan: 40 }, layout),
    ).toEqual({
      column: 1,
      row: 1,
      span: 12,
      rowSpan: 5,
    });
  });

  it('canPlace rejects overlaps unless the overlapping block is ignored', () => {
    const rect = { column: 3, row: 1, span: 4, rowSpan: 2 };
    expect(canPlace(rect, blocks, layout)).toBe(false);
    expect(canPlace(rect, blocks, layout, 'a')).toBe(true);
    expect(
      canPlace({ column: 5, row: 1, span: 4, rowSpan: 2 }, blocks, layout),
    ).toBe(true);
    expect(
      canPlace({ column: 12, row: 1, span: 2, rowSpan: 1 }, blocks, layout),
    ).toBe(false);
  });

  it('cellAt maps pixels to cells and clamps outside points', () => {
    const bounds = { left: 100, top: 50, width: 1200, height: 500 };
    expect(cellAt({ x: 100, y: 50 }, bounds, layout)).toEqual({
      column: 1,
      row: 1,
    });
    expect(cellAt({ x: 199, y: 149 }, bounds, layout)).toEqual({
      column: 1,
      row: 1,
    });
    expect(cellAt({ x: 200, y: 150 }, bounds, layout)).toEqual({
      column: 2,
      row: 2,
    });
    expect(cellAt({ x: 1299, y: 549 }, bounds, layout)).toEqual({
      column: 12,
      row: 5,
    });
    expect(cellAt({ x: -50, y: 9999 }, bounds, layout)).toEqual({
      column: 1,
      row: 5,
    });
    expect(insideBounds({ x: 99, y: 60 }, bounds)).toBe(false);
    expect(insideBounds({ x: 100, y: 60 }, bounds)).toBe(true);
  });

  it('findFreeSlot scans row by row and reports a full page', () => {
    expect(findFreeSlot(blocks, { span: 4, rowSpan: 2 }, layout)).toEqual({
      column: 5,
      row: 1,
    });
    expect(findFreeSlot(blocks, { span: 12, rowSpan: 2 }, layout)).toEqual({
      column: 1,
      row: 3,
    });
    expect(
      findFreeSlot([make('full', 12, 5)], { span: 1, rowSpan: 1 }, layout),
    ).toBeUndefined();
  });

  it('resizeToCell grows from the anchor and respects min and grid', () => {
    const anchor = { column: 3, row: 2 };
    expect(
      resizeToCell(anchor, { column: 6, row: 3 }, MIN_SIZE, layout),
    ).toEqual({
      column: 3,
      row: 2,
      span: 4,
      rowSpan: 2,
    });
    // Pointer before the anchor collapses to the minimum size.
    expect(
      resizeToCell(
        anchor,
        { column: 1, row: 1 },
        { span: 2, rowSpan: 1 },
        layout,
      ),
    ).toEqual({
      column: 3,
      row: 2,
      span: 2,
      rowSpan: 1,
    });
    // Minimum larger than the remaining grid is clipped to the edge.
    expect(
      resizeToCell(
        { column: 12, row: 5 },
        { column: 12, row: 5 },
        { span: 3, rowSpan: 2 },
        layout,
      ),
    ).toEqual({
      column: 12,
      row: 5,
      span: 1,
      rowSpan: 1,
    });
  });

  it('minSizeFor never exceeds the grid', () => {
    expect(minSizeFor(undefined, layout)).toEqual({ span: 1, rowSpan: 1 });
    expect(minSizeFor({ span: 40, rowSpan: 0 }, layout)).toEqual({
      span: 12,
      rowSpan: 1,
    });
  });
});

describe('sharedEdges', () => {
  const a = { id: 'a', column: 1, row: 1, span: 4, rowSpan: 2 };
  const b = { id: 'b', column: 5, row: 1, span: 4, rowSpan: 2 };
  const c = { id: 'c', column: 1, row: 3, span: 8, rowSpan: 1 };
  const d = { id: 'd', column: 9, row: 2, span: 2, rowSpan: 3 };

  it('marks edges fully covered by a neighbour', () => {
    expect(sharedEdges(a, [a, b, c, d])).toEqual({ left: false, top: false });
    expect(sharedEdges(b, [a, b, c, d])).toEqual({ left: true, top: false });
    expect(sharedEdges(c, [a, b, c, d])).toEqual({ left: false, top: true });
  });

  it('does not mark partially covered edges', () => {
    // d's left edge spans rows 2-4; b covers row 2 and c covers row 3, row 4 is open.
    expect(sharedEdges(d, [a, b, c, d])).toEqual({ left: false, top: false });
  });

  it('treats grid edges as unshared', () => {
    expect(sharedEdges(a, [a])).toEqual({ left: false, top: false });
  });
});
