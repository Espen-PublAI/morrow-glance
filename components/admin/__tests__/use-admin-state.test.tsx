// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SaveConflictError } from '@/lib/morrow/client';
import type { GlanceBlock, MorrowConfig } from '@/lib/morrow/types';
import { morrowConfig } from '@/morrow.config';

/**
 * Admin's behaviour, without its markup: where a block lands, what the
 * keyboard does, when the page is dirty, and what a save conflict looks like.
 * The console renders what this returns, so these are the rules that matter.
 */

const save = vi.fn();
const cacheLocally = vi.fn();
const storeToken = vi.fn();
const loadBlockData = vi.fn();

vi.mock('@/lib/morrow/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/morrow/client')>();
  return {
    ...actual,
    fetchBlockData: () => loadBlockData(),
    readStoredAdminToken: () => 'stored-token',
    writeStoredAdminToken: (token: string) => storeToken(token),
    writeRemoteMorrowConfig: (...args: unknown[]) => save(...args),
    writeStoredMorrowConfig: (config: MorrowConfig) => cacheLocally(config),
  };
});

const { useAdminState } = await import('@/components/admin/use-admin-state');

const block = (id: string, over: Partial<GlanceBlock> = {}): GlanceBlock => ({
  id,
  plugin: 'morrow.text',
  view: 'note',
  column: 1,
  row: 1,
  span: 4,
  rowSpan: 2,
  ...over,
});

/** A configuration with the given blocks on its single 12 x 5 page. */
function configWith(
  blocks: GlanceBlock[],
  pages?: MorrowConfig['pages'],
): MorrowConfig {
  const first = morrowConfig.pages[0];
  if (!first) throw new Error('the clean-install config should have a page');
  return {
    ...morrowConfig,
    pages: pages ?? [{ ...first, blocks }],
  };
}

function setup(
  config: MorrowConfig = configWith([]),
  updatedAt: string | null = 't0',
) {
  return renderHook(() =>
    useAdminState({ initialConfig: config, initialUpdatedAt: updatedAt }),
  );
}

// The real registry, so these tests fail if a plugin's contract changes.
const { pluginCatalog: catalog } = await import('@/plugins');

function clockPlugin() {
  const found = catalog.find((plugin) => plugin.manifest.id === 'morrow.clock');
  if (!found) throw new Error('the clock plugin should be installed');
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  loadBlockData.mockResolvedValue({});
  save.mockImplementation(async (config: MorrowConfig) => ({
    config,
    updatedAt: 't1',
    staleClient: false,
  }));
});

afterEach(cleanup);

describe('opening Admin', () => {
  it('starts on the server-rendered configuration, clean', () => {
    const { result } = setup(configWith([block('a')]));
    expect(result.current.config.name).toBe(morrowConfig.name);
    expect(result.current.activePage?.blocks).toHaveLength(1);
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBe('');
    expect(result.current.adminToken).toBe('stored-token');
  });

  it('offers every installed plugin unless the configuration disables it', () => {
    const { result } = setup();
    expect(result.current.enabledPlugins.length).toBe(catalog.length);

    const withoutText = setup({
      ...configWith([]),
      disabledPlugins: ['morrow.text'],
    });
    expect(
      withoutText.result.current.enabledPlugins.map((p) => p.manifest.id),
    ).not.toContain('morrow.text');
  });

  it('derives size presets from the page grid', () => {
    const { result } = setup();
    expect(result.current.sizePresets).toEqual([
      { label: 'Small', span: 4, rowSpan: 2 },
      { label: 'Medium', span: 6, rowSpan: 2 },
      { label: 'Wide', span: 12, rowSpan: 2 },
      { label: 'Full', span: 12, rowSpan: 5 },
    ]);
  });
});

describe('adding and removing blocks', () => {
  it('drops a new block into the first free space and selects it', () => {
    const { result } = setup(
      configWith([block('a', { column: 1, span: 4, row: 1, rowSpan: 2 })]),
    );
    act(() => result.current.addPlugin(clockPlugin()));
    const blocks = result.current.activePage?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      plugin: 'morrow.clock',
      column: 5,
      row: 1,
      span: 4,
      rowSpan: 2,
    });
    expect(result.current.selectedBlockId).toBe(blocks[1]?.id);
    expect(result.current.dirty).toBe(true);
  });

  it('seeds exactly the settings the plugin declares', () => {
    const { result } = setup();
    act(() => result.current.addPlugin(clockPlugin()));
    // The clock declares `city` and `label`; it reads `timeZone` only once a
    // city is picked, and its view falls back to the display timezone until then.
    expect(result.current.activePage?.blocks[0]?.settings).toEqual({
      city: '',
      label: '',
    });
  });

  it('seeds a declared timezone setting with the display timezone', () => {
    const { result } = setup();
    const withZone = {
      ...clockPlugin(),
      manifest: {
        ...clockPlugin().manifest,
        settings: [
          { id: 'timeZone', label: 'Timezone', type: 'timezone' as const },
        ],
      },
    };
    act(() => result.current.addPlugin(withZone));
    expect(result.current.activePage?.blocks[0]?.settings).toEqual({
      timeZone: morrowConfig.timeZone,
    });
  });

  it('refuses to add a block to a full page and says so', () => {
    const full = block('full', { column: 1, row: 1, span: 12, rowSpan: 5 });
    const { result } = setup(configWith([full]));
    act(() => result.current.addPlugin(clockPlugin()));
    expect(result.current.activePage?.blocks).toHaveLength(1);
    expect(result.current.error).toMatch(/No free space/i);
  });

  it('removes a block and clears the selection', () => {
    const { result } = setup(
      configWith([block('a'), block('b', { column: 5 })]),
    );
    act(() => result.current.selectBlock('a'));
    expect(result.current.selectedBlock?.id).toBe('a');
    act(() => result.current.removeBlock('a'));
    expect(result.current.activePage?.blocks.map((b) => b.id)).toEqual(['b']);
    // The raw selection matters as much as the derived block: a stale id would
    // leave the canvas and inspector thinking something is still selected.
    expect(result.current.selectedBlockId).toBeNull();
    expect(result.current.selectedBlock).toBeUndefined();
  });

  it('keeps the selection when a different block is removed', () => {
    const { result } = setup(
      configWith([block('a'), block('b', { column: 5 })]),
    );
    act(() => result.current.selectBlock('a'));
    act(() => result.current.removeBlock('b'));
    expect(result.current.selectedBlockId).toBe('a');
  });
});

describe('resizing through the size presets', () => {
  it('keeps the block where it is when the new size fits', () => {
    const target = block('a', { column: 5, row: 3, span: 4, rowSpan: 2 });
    const { result } = setup(configWith([target]));
    act(() => result.current.selectBlock('a'));
    act(() => result.current.resizeBlock(6, 2));
    expect(result.current.activePage?.blocks[0]).toMatchObject({
      column: 5,
      row: 3,
      span: 6,
    });
  });

  it('relocates the block when the new size does not fit in place', () => {
    const target = block('a', { column: 9, row: 1, span: 4, rowSpan: 2 });
    const { result } = setup(configWith([target]));
    act(() => result.current.selectBlock('a'));
    act(() => result.current.resizeBlock(12, 2));
    expect(result.current.activePage?.blocks[0]).toMatchObject({
      column: 1,
      row: 1,
      span: 12,
    });
  });

  it('reports when no arrangement fits', () => {
    const other = block('other', { column: 1, row: 1, span: 12, rowSpan: 4 });
    const target = block('a', { column: 1, row: 5, span: 4, rowSpan: 1 });
    const { result } = setup(configWith([other, target]));
    act(() => result.current.selectBlock('a'));
    act(() => result.current.resizeBlock(12, 3));
    expect(result.current.error).toMatch(/does not fit/i);
    expect(result.current.activePage?.blocks[1]).toMatchObject({
      span: 4,
      rowSpan: 1,
    });
  });
});

describe('keyboard editing', () => {
  const press = (key: string, over: Partial<KeyboardEvent> = {}) =>
    ({ key, preventDefault: () => {}, ...over }) as unknown as Parameters<
      ReturnType<typeof setup>['result']['current']['handleBlockKeyDown']
    >[0];

  it('nudges a block by one cell', () => {
    const target = block('a', { column: 2, row: 2, span: 2, rowSpan: 1 });
    const { result } = setup(configWith([target]));
    act(() => result.current.handleBlockKeyDown(press('ArrowRight'), target));
    expect(result.current.activePage?.blocks[0]).toMatchObject({
      column: 3,
      row: 2,
    });
    act(() =>
      result.current.handleBlockKeyDown(
        press('ArrowUp'),
        result.current.activePage!.blocks[0]!,
      ),
    );
    expect(result.current.activePage?.blocks[0]).toMatchObject({
      column: 3,
      row: 1,
    });
  });

  it('leaves a block alone when a neighbour is in the way', () => {
    const moving = block('a', { column: 1, row: 1, span: 3, rowSpan: 2 });
    const neighbour = block('b', { column: 4, row: 1, span: 3, rowSpan: 2 });
    const { result } = setup(configWith([moving, neighbour]));
    act(() => result.current.handleBlockKeyDown(press('ArrowRight'), moving));
    expect(result.current.activePage?.blocks[0]).toMatchObject({ column: 1 });
    expect(result.current.dirty).toBe(false);
  });

  it('resizes with Shift and respects the plugin minimum', () => {
    const target = block('a', {
      plugin: 'morrow.text',
      column: 1,
      row: 1,
      span: 4,
      rowSpan: 2,
    });
    const { result } = setup(configWith([target]));
    act(() =>
      result.current.handleBlockKeyDown(
        press('ArrowRight', { shiftKey: true }),
        target,
      ),
    );
    expect(result.current.activePage?.blocks[0]?.span).toBe(5);
    // The text plugin's minimum is 3 wide, so shrinking stops there.
    let current = result.current.activePage!.blocks[0]!;
    for (let i = 0; i < 5; i += 1) {
      act(() =>
        result.current.handleBlockKeyDown(
          press('ArrowLeft', { shiftKey: true }),
          current,
        ),
      );
      current = result.current.activePage!.blocks[0]!;
    }
    expect(current.span).toBe(3);
  });

  it('deletes with Delete and deselects with Escape', () => {
    const target = block('a');
    const { result } = setup(configWith([target]));
    act(() => result.current.selectBlock('a'));
    act(() => result.current.handleBlockKeyDown(press('Escape'), target));
    expect(result.current.selectedBlockId).toBeNull();
    act(() => result.current.handleBlockKeyDown(press('Delete'), target));
    expect(result.current.activePage?.blocks).toHaveLength(0);
  });

  it('ignores keys it does not handle', () => {
    const target = block('a', { column: 2 });
    const { result } = setup(configWith([target]));
    act(() => result.current.handleBlockKeyDown(press('Tab'), target));
    expect(result.current.dirty).toBe(false);
    expect(result.current.activePage?.blocks[0]).toMatchObject({ column: 2 });
  });
});

describe('committing a drag on the canvas', () => {
  /** Give the hook a canvas with a known rect: 12 x 5 cells of 100 x 100. */
  function attachCanvas(view: ReturnType<typeof setup>) {
    const canvas = document.createElement('div');
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
    act(() => {
      view.result.current.canvasRef.current = canvas;
    });
    return canvas;
  }

  const centre = (column: number, row: number) => ({
    x: (column - 0.5) * 100,
    y: (row - 0.5) * 100,
  });
  const press = (x: number, y: number) =>
    ({
      pointerId: 1,
      clientX: x,
      clientY: y,
      button: 0,
      stopPropagation: () => {},
    }) as never;
  const send = (type: string, x: number, y: number) => {
    act(() => {
      window.dispatchEvent(
        new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y }),
      );
    });
  };

  it('moves a block when the drop lands on free cells', () => {
    const moving = block('a', { column: 1, row: 1, span: 4, rowSpan: 2 });
    const view = setup(configWith([moving]));
    attachCanvas(view);
    const grab = centre(1, 1);
    act(() =>
      view.result.current.drag.beginMove(press(grab.x, grab.y), moving),
    );
    const drop = centre(6, 3);
    send('pointermove', drop.x, drop.y);
    send('pointerup', drop.x, drop.y);
    expect(view.result.current.activePage?.blocks[0]).toMatchObject({
      column: 6,
      row: 3,
    });
    expect(view.result.current.error).toBe('');
  });

  it('leaves a block alone when the drop lands on another block', () => {
    const moving = block('a', { column: 1, row: 1, span: 4, rowSpan: 2 });
    const other = block('b', { column: 5, row: 1, span: 4, rowSpan: 2 });
    const view = setup(configWith([moving, other]));
    attachCanvas(view);
    act(() =>
      view.result.current.drag.beginMove(
        press(centre(1, 1).x, centre(1, 1).y),
        moving,
      ),
    );
    send('pointermove', centre(2, 1).x, centre(2, 1).y);
    expect(view.result.current.drag.ghost?.valid).toBe(false);
    send('pointerup', centre(2, 1).x, centre(2, 1).y);
    expect(view.result.current.activePage?.blocks[0]).toMatchObject({
      column: 1,
    });
    // No toast: the ghost already turned red under the cursor, so an error
    // message would repeat what the user just saw.
    expect(view.result.current.error).toBe('');
  });

  it('resizes a block from its corner and stops at a neighbour', () => {
    const target = block('a', { column: 1, row: 1, span: 2, rowSpan: 1 });
    const other = block('b', { column: 5, row: 1, span: 4, rowSpan: 2 });
    const view = setup(configWith([target, other]));
    attachCanvas(view);
    act(() =>
      view.result.current.drag.beginResize(press(0, 0), target, undefined),
    );
    send('pointermove', centre(4, 2).x, centre(4, 2).y);
    send('pointerup', centre(4, 2).x, centre(4, 2).y);
    expect(view.result.current.activePage?.blocks[0]).toMatchObject({
      span: 4,
      rowSpan: 2,
    });

    // Growing into the neighbour is refused, leaving the last good size.
    const grown = view.result.current.activePage!.blocks[0]!;
    act(() =>
      view.result.current.drag.beginResize(press(0, 0), grown, undefined),
    );
    send('pointermove', centre(8, 2).x, centre(8, 2).y);
    expect(view.result.current.drag.ghost?.valid).toBe(false);
    send('pointerup', centre(8, 2).x, centre(8, 2).y);
    expect(view.result.current.activePage?.blocks[0]).toMatchObject({
      span: 4,
    });
  });

  it('adds a block where it is dropped from the library', () => {
    const view = setup(configWith([]));
    attachCanvas(view);
    act(() => view.result.current.drag.beginAdd(press(0, 0), clockPlugin()));
    const drop = centre(7, 4);
    send('pointermove', drop.x, drop.y);
    send('pointerup', drop.x, drop.y);
    expect(view.result.current.activePage?.blocks[0]).toMatchObject({
      plugin: 'morrow.clock',
      column: 6,
      row: 4,
    });
  });
});

describe('pages', () => {
  it('adds a page and moves to it', () => {
    const { result } = setup();
    act(() => result.current.addPage());
    expect(result.current.config.pages).toHaveLength(2);
    expect(result.current.activePage?.label).toBe('Page 2');
    expect(result.current.selectedBlockId).toBeNull();
  });

  it('will not delete the only page', () => {
    const { result } = setup();
    const id = result.current.activePage?.id ?? '';
    act(() => result.current.removePage(id));
    expect(result.current.config.pages).toHaveLength(1);
  });

  it('asks before deleting a page that has blocks', () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    const first = morrowConfig.pages[0]!;
    const { result } = setup(
      configWith(
        [],
        [
          { ...first, id: 'p1', blocks: [block('a')] },
          { ...first, id: 'p2', blocks: [] },
        ],
      ),
    );
    act(() => result.current.removePage('p1'));
    expect(confirm).toHaveBeenCalledOnce();
    expect(result.current.config.pages).toHaveLength(2);

    confirm.mockReturnValue(true);
    act(() => result.current.removePage('p1'));
    expect(result.current.config.pages).toHaveLength(1);
    vi.unstubAllGlobals();
  });

  it('deletes an empty page without asking', () => {
    const confirm = vi.fn();
    vi.stubGlobal('confirm', confirm);
    const first = morrowConfig.pages[0]!;
    const { result } = setup(
      configWith(
        [],
        [
          { ...first, id: 'p1', blocks: [] },
          { ...first, id: 'p2', blocks: [] },
        ],
      ),
    );
    act(() => result.current.removePage('p2'));
    expect(confirm).not.toHaveBeenCalled();
    expect(result.current.config.pages).toHaveLength(1);
    vi.unstubAllGlobals();
  });
});

describe('screens', () => {
  it('adds a preset screen and keeps ids unique', () => {
    const { result } = setup();
    act(() => result.current.addScreen('tv-4k'));
    expect(result.current.config.screens.map((s) => s.id)).toEqual([
      'browser',
      'tv-4k',
    ]);
    act(() => result.current.addScreen('tv-4k'));
    const ids = result.current.config.screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hands the default to another screen when the default is removed', () => {
    const { result } = setup();
    act(() => result.current.addScreen('tv-4k'));
    expect(result.current.config.defaultScreenId).toBe('browser');
    act(() => result.current.removeScreen('browser'));
    expect(result.current.config.screens.map((s) => s.id)).toEqual(['tv-4k']);
    expect(result.current.config.defaultScreenId).toBe('tv-4k');
  });

  it('will not remove the only screen', () => {
    const { result } = setup();
    act(() => result.current.removeScreen('browser'));
    expect(result.current.config.screens).toHaveLength(1);
  });
});

describe('saving', () => {
  it('sends the version stamp, caches the result, and comes back clean', async () => {
    const { result } = setup(configWith([block('a')]), 't0');
    act(() => result.current.updateConfig((c) => ({ ...c, name: 'Lobby' })));
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      await result.current.save();
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lobby' }),
      'stored-token',
      't0',
    );
    expect(cacheLocally).toHaveBeenCalledOnce();
    expect(result.current.dirty).toBe(false);
    expect(result.current.error).toBe('');

    // The next save carries the stamp the server just returned.
    act(() => result.current.updateConfig((c) => ({ ...c, name: 'Lobby 2' })));
    await act(async () => {
      await result.current.save();
    });
    expect(save).toHaveBeenLastCalledWith(
      expect.anything(),
      'stored-token',
      't1',
    );
  });

  it('flags a conflict distinctly from an ordinary failure', async () => {
    save.mockRejectedValueOnce(
      new SaveConflictError('Someone else saved changes.'),
    );
    const { result } = setup();
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.conflict).toBe(true);
    expect(result.current.error).toMatch(/Someone else saved/);

    save.mockRejectedValueOnce(new Error('Network down'));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.conflict).toBe(false);
    expect(result.current.error).toBe('Network down');
  });

  it('keeps the page dirty when a save fails', async () => {
    save.mockRejectedValueOnce(new Error('nope'));
    const { result } = setup();
    act(() => result.current.updateConfig((c) => ({ ...c, name: 'X' })));
    await act(async () => {
      await result.current.save();
    });
    expect(result.current.dirty).toBe(true);
  });
});

describe('the admin token', () => {
  it('keeps it for this tab and never asks the view to store it', () => {
    const { result } = setup();
    act(() => result.current.setAdminToken('typed-token'));
    expect(result.current.adminToken).toBe('typed-token');
    expect(storeToken).toHaveBeenCalledWith('typed-token');
  });
});

describe('block data', () => {
  it('loads what the blocks have fetched, for the canvas preview', async () => {
    loadBlockData.mockResolvedValue({
      a: { data: { n: 1 }, fetchedAt: 't', error: null },
    });
    const { result } = setup(configWith([block('a')]));
    await waitFor(() =>
      expect(result.current.blockData.a?.data).toEqual({ n: 1 }),
    );
  });

  it('survives a failure to load it', async () => {
    loadBlockData.mockRejectedValue(new Error('offline'));
    const { result } = setup(configWith([block('a')]));
    await waitFor(() => expect(result.current.blockData).toEqual({}));
    expect(result.current.error).toBe('');
  });
});
