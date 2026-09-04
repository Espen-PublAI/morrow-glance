'use client';

import type { KeyboardEvent } from 'react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { useCanvasDrag } from '@/components/admin/use-canvas-drag';
import {
  SaveConflictError,
  fetchBlockData,
  readStoredAdminToken,
  writeRemoteMorrowConfig,
  writeStoredAdminToken,
  writeStoredMorrowConfig,
} from '@/lib/morrow/client';
import { DEFAULT_LAYOUT } from '@/lib/morrow/defaults';
import {
  canPlace,
  createId,
  findFreeSlot,
  minSizeFor,
  sizePresetsFor,
  type GridRect,
} from '@/lib/morrow/layout';
import { screenPresets } from '@/lib/morrow/screens';
import type {
  BlockData,
  GlanceBlock,
  GlancePage,
  MorrowConfig,
  PluginManifest,
  PluginRuntime,
  PluginSettingValue,
  PluginSettings,
  ScreenProfile,
} from '@/lib/morrow/types';
import { pluginCatalog, pluginRegistry } from '@/plugins';

/**
 * Everything Admin knows and can do, with no markup.
 *
 * Splitting it out keeps the console a layout and makes the interesting part
 * testable on its own: placing and moving blocks, the dirty and saving flags,
 * save conflicts, and the keyboard editing rules. The console renders what
 * this returns and calls back into it; it holds no state of its own beyond
 * field ids.
 */

/** The id offered in Admin's "Add a screen" menu for a blank custom size. */
export const CUSTOM_SCREEN_ID = 'custom';

const CUSTOM_SCREEN: ScreenProfile = {
  id: CUSTOM_SCREEN_ID,
  name: 'Custom screen',
  width: 1920,
  height: 1080,
  refreshSeconds: 30,
};

const subscribeNever = () => () => {};
const noToken = () => '';

function initialSettings(
  manifest: PluginManifest,
  timeZone: string,
): PluginSettings {
  return Object.fromEntries(
    (manifest.settings ?? []).map((setting) => [
      setting.id,
      setting.type === 'timezone' ? timeZone : (setting.defaultValue ?? ''),
    ]),
  );
}

export interface AdminStateOptions {
  /** Server-rendered configuration, so Admin opens on the real data. */
  initialConfig: MorrowConfig;
  /** Version stamp of that configuration; sent back on save to detect conflicts. */
  initialUpdatedAt: string | null;
}

export function useAdminState({
  initialConfig,
  initialUpdatedAt,
}: AdminStateOptions) {
  const [config, setConfig] = useState<MorrowConfig>(initialConfig);
  const [updatedAt, setUpdatedAt] = useState<string | null>(initialUpdatedAt);
  const [pageId, setPageId] = useState<string>(
    initialConfig.pages[0]?.id ?? '',
  );
  const [blockId, setBlockId] = useState<string | null>(null);
  const [screenId, setScreenId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // The stored token lives in sessionStorage, which does not exist during SSR.
  const storedToken = useSyncExternalStore(
    subscribeNever,
    readStoredAdminToken,
    noToken,
  );
  const [tokenOverride, setTokenOverride] = useState<string | null>(null);
  const adminToken = tokenOverride ?? storedToken;

  /** Keep the token for this tab only; the view never touches storage. */
  const setAdminToken = (token: string) => {
    setTokenOverride(token);
    writeStoredAdminToken(token);
  };
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [blockData, setBlockData] = useState<Record<string, BlockData>>({});
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Keep the canvas preview ticking so clocks look alive while editing.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  // Show real block data on the canvas, refreshed on the same cadence as a Player.
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void fetchBlockData()
        .then((data) => {
          if (!cancelled) setBlockData(data);
        })
        .catch(() => undefined);
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const activePage =
    config.pages.find((page) => page.id === pageId) ?? config.pages[0];
  const selectedBlock = activePage?.blocks.find(
    (block) => block.id === blockId,
  );
  const selectedPlugin = selectedBlock
    ? pluginRegistry[selectedBlock.plugin]
    : undefined;
  const selectedScreen = config.screens.find(
    (screen) => screen.id === screenId,
  );
  const disabled = new Set(config.disabledPlugins);
  const enabledPlugins = pluginCatalog.filter(
    (plugin) => !disabled.has(plugin.manifest.id),
  );
  const sizePresets = useMemo(
    () => sizePresetsFor(activePage?.layout ?? DEFAULT_LAYOUT),
    [activePage?.layout],
  );

  const updateConfig = (updater: (current: MorrowConfig) => MorrowConfig) => {
    setConfig((current) => updater(current));
    setDirty(true);
    setError('');
  };

  const updatePage = (updater: (page: GlancePage) => GlancePage) => {
    if (!activePage) return;
    updateConfig((current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === activePage.id ? updater(page) : page,
      ),
    }));
  };

  const updateBlock = (
    id: string,
    updater: (block: GlanceBlock) => GlanceBlock,
  ) => {
    updatePage((page) => ({
      ...page,
      blocks: page.blocks.map((block) =>
        block.id === id ? updater(block) : block,
      ),
    }));
  };

  /* Pages ---------------------------------------------------------------- */

  const selectPage = (id: string) => {
    setPageId(id);
    setBlockId(null);
    setScreenId(null);
  };

  const addPage = () => {
    const id = createId('page');
    updateConfig((current) => ({
      ...current,
      pages: [
        ...current.pages,
        {
          id,
          label: `Page ${current.pages.length + 1}`,
          layout: { ...DEFAULT_LAYOUT },
          blocks: [],
        },
      ],
    }));
    selectPage(id);
  };

  const removePage = (id: string) => {
    if (config.pages.length === 1) return;
    const target = config.pages.find((page) => page.id === id);
    if (!target) return;
    const name = target.label || 'Untitled page';
    if (
      target.blocks.length > 0 &&
      !window.confirm(
        `Delete "${name}" and its ${target.blocks.length} block(s)?`,
      )
    ) {
      return;
    }
    const remaining = config.pages.filter((page) => page.id !== id);
    updateConfig((current) => ({ ...current, pages: remaining }));
    if (activePage?.id === id) selectPage(remaining[0]?.id ?? '');
  };

  /* Screens -------------------------------------------------------------- */

  /** Add a screen from a preset, or a blank custom one. Ids stay unique per config. */
  const addScreen = (presetId: string) => {
    const base =
      screenPresets.find((screen) => screen.id === presetId) ?? CUSTOM_SCREEN;
    const taken = new Set(config.screens.map((screen) => screen.id));
    const screen: ScreenProfile = {
      ...base,
      id: taken.has(base.id) ? createId(base.id) : base.id,
    };
    updateConfig((current) => ({
      ...current,
      screens: [...current.screens, screen],
    }));
    setScreenId(screen.id);
    setBlockId(null);
  };

  const updateScreen = (id: string, patch: Partial<ScreenProfile>) => {
    updateConfig((current) => ({
      ...current,
      screens: current.screens.map((screen) =>
        screen.id === id ? { ...screen, ...patch } : screen,
      ),
    }));
  };

  const removeScreen = (id: string) => {
    const remaining = config.screens.filter((screen) => screen.id !== id);
    const fallback = remaining[0];
    if (!fallback) return;
    updateConfig((current) => ({
      ...current,
      screens: remaining,
      defaultScreenId:
        current.defaultScreenId === id ? fallback.id : current.defaultScreenId,
    }));
    setScreenId(null);
  };

  /* Blocks --------------------------------------------------------------- */

  const placeBlock = (plugin: PluginRuntime, rect: GridRect) => {
    const { manifest } = plugin;
    const block: GlanceBlock = {
      id: createId('block'),
      plugin: manifest.id,
      view: manifest.views[0]?.id ?? 'default',
      settings: initialSettings(manifest, config.timeZone),
      ...rect,
    };
    updatePage((page) => ({ ...page, blocks: [...page.blocks, block] }));
    setBlockId(block.id);
    setScreenId(null);
  };

  /** Click in the library: drop the plugin into the first free space. */
  const addPlugin = (plugin: PluginRuntime) => {
    if (!activePage) return;
    const size = plugin.manifest.defaultSize;
    const slot = findFreeSlot(activePage.blocks, size, activePage.layout);
    if (!slot) {
      setError(
        'No free space for this block. Free up room or add another page.',
      );
      return;
    }
    placeBlock(plugin, { ...slot, ...size });
  };

  const removeBlock = (id: string) => {
    updatePage((page) => ({
      ...page,
      blocks: page.blocks.filter((block) => block.id !== id),
    }));
    if (blockId === id) setBlockId(null);
  };

  /**
   * Apply a rect to an existing block if nothing is in the way.
   *
   * The drag hook refuses to commit an invalid drop, so in practice the guard
   * below does not fire and `failure` is not shown; the ghost has already
   * turned red under the cursor. It stays as a safety net for any future
   * caller that has not checked first.
   */
  const placeExisting = (id: string, rect: GridRect, failure: string) => {
    if (!activePage) return;
    if (!canPlace(rect, activePage.blocks, activePage.layout, id)) {
      setError(failure);
      return;
    }
    updateBlock(id, (block) => ({ ...block, ...rect }));
  };

  /** Size presets: keep the block in place if possible, otherwise find room. */
  const resizeBlock = (span: number, rowSpan: number) => {
    if (!activePage || !selectedBlock) return;
    const inPlace = {
      column: selectedBlock.column,
      row: selectedBlock.row,
      span,
      rowSpan,
    };
    if (
      canPlace(inPlace, activePage.blocks, activePage.layout, selectedBlock.id)
    ) {
      updateBlock(selectedBlock.id, (block) => ({ ...block, ...inPlace }));
      return;
    }
    const others = activePage.blocks.filter(
      (block) => block.id !== selectedBlock.id,
    );
    const slot = findFreeSlot(others, { span, rowSpan }, activePage.layout);
    if (!slot) {
      setError('That size does not fit on this page.');
      return;
    }
    updateBlock(selectedBlock.id, (block) => ({
      ...block,
      ...slot,
      span,
      rowSpan,
    }));
  };

  /** Arrow keys nudge a block, Shift+arrows resize it, Delete removes it, Escape deselects. */
  const handleBlockKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    block: GlanceBlock,
  ) => {
    if (!activePage) return;

    if (event.key === 'Escape') {
      setBlockId(null);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeBlock(block.id);
      return;
    }

    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setBlockId(block.id);

    const [dx, dy] = delta;
    const min = minSizeFor(
      pluginRegistry[block.plugin]?.manifest.minSize,
      activePage.layout,
    );
    const rect: GridRect = event.shiftKey
      ? {
          column: block.column,
          row: block.row,
          span: Math.max(min.span, block.span + dx),
          rowSpan: Math.max(min.rowSpan, block.rowSpan + dy),
        }
      : {
          column: block.column + dx,
          row: block.row + dy,
          span: block.span,
          rowSpan: block.rowSpan,
        };
    if (canPlace(rect, activePage.blocks, activePage.layout, block.id)) {
      updateBlock(block.id, (current) => ({ ...current, ...rect }));
    }
  };

  const drag = useCanvasDrag({
    canvasRef,
    layout: activePage?.layout ?? DEFAULT_LAYOUT,
    blocks: activePage?.blocks ?? [],
    onAdd: placeBlock,
    onMove: (id, rect) => placeExisting(id, rect, 'That spot is taken.'),
    onResize: (id, rect) =>
      placeExisting(id, rect, 'That size does not fit here.'),
  });

  const updateSettings = (patch: PluginSettings) => {
    if (!selectedBlock) return;
    updateBlock(selectedBlock.id, (block) => ({
      ...block,
      settings: { ...block.settings, ...patch },
    }));
  };

  const updateSetting = (id: string, value: PluginSettingValue) =>
    updateSettings({ [id]: value });

  /* Persistence ---------------------------------------------------------- */

  const save = async () => {
    setSaving(true);
    try {
      const saved = await writeRemoteMorrowConfig(
        config,
        adminToken,
        updatedAt,
      );
      writeStoredMorrowConfig(saved.config);
      setConfig(saved.config);
      setUpdatedAt(saved.updatedAt);
      setDirty(false);
      setError('');
      setConflict(false);
    } catch (cause) {
      setConflict(cause instanceof SaveConflictError);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save this configuration.',
      );
    } finally {
      setSaving(false);
    }
  };
  return {
    // What is on screen
    config,
    activePage,
    selectedBlock,
    /** The raw selection, which the canvas needs even before it resolves. */
    selectedBlockId: blockId,
    selectedPlugin,
    selectedScreen,
    enabledPlugins,
    sizePresets,
    blockData,
    now,
    canvasRef,
    drag,

    // Status
    dirty,
    saving,
    error,
    conflict,
    adminToken,

    // Display settings
    updateConfig,
    setAdminToken,

    // Pages
    selectPage,
    addPage,
    removePage,
    updatePage,

    // Screens
    addScreen,
    updateScreen,
    removeScreen,
    selectScreen: setScreenId,

    // Blocks
    addPlugin,
    removeBlock,
    resizeBlock,
    updateBlock,
    updateSetting,
    updateSettings,
    selectBlock: setBlockId,
    handleBlockKeyDown,

    // Persistence
    save,
  };
}

export type AdminState = ReturnType<typeof useAdminState>;
