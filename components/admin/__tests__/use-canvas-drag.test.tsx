// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasDrag } from '@/components/admin/use-canvas-drag';
import type {
  GlanceBlock,
  GlanceLayout,
  PluginRuntime,
} from '@/lib/morrow/types';

/**
 * The drag hook is the most intricate interaction in Admin, and the place a
 * refactor is most likely to break something quietly: the press-versus-drag
 * threshold, the grab offset, and the click that must not fire after a drag.
 */

const layout: GlanceLayout = { columns: 12, rows: 5 };
// A 1200 x 500 canvas at the origin, so every grid cell is exactly 100 x 100.
const CELL = 100;

const block = (id: string, over: Partial<GlanceBlock> = {}): GlanceBlock => ({
  id,
  plugin: 'morrow.text',
  view: 'note',
  column: 1,
  row: 1,
  span: 2,
  rowSpan: 2,
  ...over,
});

const plugin = (
  span = 4,
  rowSpan = 2,
  minSize?: { span: number; rowSpan: number },
) =>
  ({
    manifest: {
      id: 'test.plugin',
      name: 'Test',
      version: '1.0.0',
      description: '',
      refreshSeconds: 0,
      views: [{ id: 'default', name: 'Default' }],
      defaultSize: { span, rowSpan },
      ...(minSize ? { minSize } : {}),
    },
  }) as unknown as PluginRuntime;

let canvas: HTMLDivElement;

beforeEach(() => {
  canvas = document.createElement('div');
  document.body.appendChild(canvas);
  canvas.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 1200,
      height: 500,
      right: 1200,
      bottom: 500,
      x: 0,
      y: 0,
    }) as DOMRect;
});

afterEach(() => {
  canvas.remove();
  cleanup();
});

/** The middle of a 1-based grid cell, in canvas pixels. */
function centreOf(column: number, row: number) {
  return { x: (column - 0.5) * CELL, y: (row - 0.5) * CELL };
}

function pointer(x: number, y: number, button = 0) {
  return {
    pointerId: 1,
    clientX: x,
    clientY: y,
    button,
    stopPropagation: () => {},
  } as unknown as ReactPointerEvent;
}

function dispatch(type: string, x: number, y: number, pointerId = 1) {
  act(() => {
    window.dispatchEvent(
      new PointerEvent(type, {
        pointerId,
        clientX: x,
        clientY: y,
        bubbles: true,
      }),
    );
  });
}

function setup(blocks: GlanceBlock[] = []) {
  const onAdd = vi.fn();
  const onMove = vi.fn();
  const onResize = vi.fn();
  const view = renderHook(() =>
    useCanvasDrag({
      canvasRef: { current: canvas },
      layout,
      blocks,
      onAdd,
      onMove,
      onResize,
    }),
  );
  return { view, onAdd, onMove, onResize };
}

describe('press versus drag', () => {
  it('treats a press that barely moves as a click, not a drag', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    dispatch('pointermove', 4, 0); // inside the 6px threshold
    dispatch('pointerup', 4, 0);
    expect(onAdd).not.toHaveBeenCalled();
    expect(view.result.current.ghost).toBeNull();
    expect(view.result.current.consumeClick()).toBe(false);
  });

  it('swallows exactly one click after a real drag', () => {
    const { view } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    const target = centreOf(3, 2);
    dispatch('pointermove', target.x, target.y);
    dispatch('pointerup', target.x, target.y);
    expect(view.result.current.consumeClick()).toBe(true);
    // One-shot: a later genuine click must get through.
    expect(view.result.current.consumeClick()).toBe(false);
  });

  it('ignores a non-primary button', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0, 2), plugin());
    });
    const target = centreOf(3, 2);
    dispatch('pointermove', target.x, target.y);
    dispatch('pointerup', target.x, target.y);
    expect(onAdd).not.toHaveBeenCalled();
  });
});

describe('adding from the library', () => {
  it('centres the ghost on the pointer and drops there', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin(4, 2));
    });
    const target = centreOf(6, 3);
    dispatch('pointermove', target.x, target.y);
    // A 4-wide, 2-tall block centred on column 6, row 3.
    expect(view.result.current.ghost).toEqual({
      column: 5,
      row: 3,
      span: 4,
      rowSpan: 2,
      valid: true,
    });
    dispatch('pointerup', target.x, target.y);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]?.[1]).toEqual({
      column: 5,
      row: 3,
      span: 4,
      rowSpan: 2,
    });
  });

  it('marks the ghost invalid over an occupied cell and refuses the drop', () => {
    const { view, onAdd } = setup([
      block('taken', { column: 1, row: 1, span: 12, rowSpan: 2 }),
    ]);
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin(4, 2));
    });
    const target = centreOf(6, 1);
    dispatch('pointermove', target.x, target.y);
    expect(view.result.current.ghost?.valid).toBe(false);
    dispatch('pointerup', target.x, target.y);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('clamps a ghost dragged past the edge back inside the grid', () => {
    const { view } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin(4, 2));
    });
    const target = centreOf(12, 5);
    dispatch('pointermove', target.x, target.y);
    const ghost = view.result.current.ghost;
    expect(ghost?.column).toBe(9); // 9..12
    expect(ghost?.row).toBe(4); // 4..5
  });

  it('hides the ghost while the pointer is outside the canvas', () => {
    const { view } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    const inside = centreOf(4, 2);
    dispatch('pointermove', inside.x, inside.y);
    expect(view.result.current.ghost).not.toBeNull();
    dispatch('pointermove', 1400, 200);
    expect(view.result.current.ghost).toBeNull();
  });
});

describe('moving a block', () => {
  it('keeps the grab offset, so the block does not jump under the cursor', () => {
    const moving = block('m', { column: 5, row: 2, span: 4, rowSpan: 2 });
    const { view, onMove } = setup([moving]);
    // Grab the block near its right edge: column 8, row 3.
    const grab = centreOf(8, 3);
    act(() => {
      view.result.current.beginMove(pointer(grab.x, grab.y), moving);
    });
    // Drag that same corner to column 10, row 4: the block should follow by +2, +1.
    const target = centreOf(10, 4);
    dispatch('pointermove', target.x, target.y);
    expect(view.result.current.ghost).toMatchObject({
      column: 7,
      row: 3,
      span: 4,
      rowSpan: 2,
    });
    dispatch('pointerup', target.x, target.y);
    expect(onMove).toHaveBeenCalledWith('m', {
      column: 7,
      row: 3,
      span: 4,
      rowSpan: 2,
    });
  });

  it('lets a block overlap its own old position', () => {
    const moving = block('m', { column: 1, row: 1, span: 4, rowSpan: 2 });
    const { view } = setup([moving]);
    const grab = centreOf(1, 1);
    act(() => {
      view.result.current.beginMove(pointer(grab.x, grab.y), moving);
    });
    const target = centreOf(2, 1);
    dispatch('pointermove', target.x, target.y);
    expect(view.result.current.ghost?.valid).toBe(true);
  });
});

describe('resizing a block', () => {
  it('grows from the block corner', () => {
    const target = block('r', { column: 2, row: 2, span: 2, rowSpan: 1 });
    const { view, onResize } = setup([target]);
    act(() => {
      view.result.current.beginResize(pointer(0, 0), target, undefined);
    });
    const corner = centreOf(7, 4);
    dispatch('pointermove', corner.x, corner.y);
    expect(view.result.current.ghost).toMatchObject({
      column: 2,
      row: 2,
      span: 6,
      rowSpan: 3,
    });
    dispatch('pointerup', corner.x, corner.y);
    expect(onResize).toHaveBeenCalledWith('r', {
      column: 2,
      row: 2,
      span: 6,
      rowSpan: 3,
    });
  });

  it('never shrinks below the plugin minimum', () => {
    const target = block('r', { column: 4, row: 3, span: 4, rowSpan: 2 });
    const { view } = setup([target]);
    act(() => {
      view.result.current.beginResize(pointer(0, 0), target, {
        span: 3,
        rowSpan: 2,
      });
    });
    // Drag the corner back above and left of the anchor.
    const corner = centreOf(1, 1);
    dispatch('pointermove', corner.x, corner.y);
    expect(view.result.current.ghost).toMatchObject({
      column: 4,
      row: 3,
      span: 3,
      rowSpan: 2,
    });
  });
});

describe('interruptions', () => {
  it('abandons the drag on pointercancel', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    const target = centreOf(4, 2);
    dispatch('pointermove', target.x, target.y);
    dispatch('pointercancel', target.x, target.y);
    expect(onAdd).not.toHaveBeenCalled();
    expect(view.result.current.ghost).toBeNull();
    expect(view.result.current.dragging).toBeNull();
  });

  it('ignores events from a different pointer', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    const target = centreOf(4, 2);
    dispatch('pointermove', target.x, target.y, 99);
    expect(view.result.current.ghost).toBeNull();
    dispatch('pointerup', target.x, target.y, 99);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('detaches its window listeners when the component goes away', () => {
    const { view, onAdd } = setup();
    act(() => {
      view.result.current.beginAdd(pointer(0, 0), plugin());
    });
    view.unmount();
    const target = centreOf(4, 2);
    // No listeners left, so these must be inert rather than throwing.
    dispatch('pointermove', target.x, target.y);
    dispatch('pointerup', target.x, target.y);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
