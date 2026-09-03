'use client';

import {
  ArrowLeft,
  Check,
  Eye,
  Monitor,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import type { KeyboardEvent } from 'react';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { AdminCanvas } from '@/components/admin/admin-canvas';
import { BlockInspector } from '@/components/admin/block-inspector';
import { PluginLibrary } from '@/components/admin/plugin-library';
import { ScreenInspector } from '@/components/admin/screen-inspector';
import { TimeZoneInput } from '@/components/admin/timezone-input';
import { useCanvasDrag } from '@/components/admin/use-canvas-drag';
import { Button } from '@/components/ui/button';
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
import {
  MORROW_COLORS,
  type BlockData,
  type GlanceBlock,
  type GlancePage,
  type MorrowConfig,
  type PluginManifest,
  type PluginRuntime,
  type PluginSettingValue,
  type PluginSettings,
  type ScreenProfile,
} from '@/lib/morrow/types';
import { pluginCatalog, pluginRegistry } from '@/plugins';

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

const subscribeNever = () => () => {};
const noToken = () => '';

const CUSTOM_SCREEN: ScreenProfile = {
  id: 'custom',
  name: 'Custom screen',
  width: 1920,
  height: 1080,
  refreshSeconds: 30,
};

/** Admin: the visual control surface that edits and saves the shared configuration. */
interface AdminConsoleProps {
  /** Server-rendered configuration, so Admin opens on the real data. */
  initialConfig: MorrowConfig;
  /** Version stamp of that configuration; sent back on save to detect conflicts. */
  initialUpdatedAt: string | null;
}

export function AdminConsole({
  initialConfig,
  initialUpdatedAt,
}: AdminConsoleProps) {
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
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [blockData, setBlockData] = useState<Record<string, BlockData>>({});
  const timeZoneFieldId = useId();
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

  /** Apply a rect to an existing block if nothing is in the way. */
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

  return (
    <main className="admin-shell">
      <header className="admin-bar">
        <Link href="/" className="admin-back">
          <ArrowLeft /> Morrow
        </Link>
        <div className="admin-actions">
          <span className={dirty ? 'save-state is-dirty' : 'save-state'}>
            {dirty ? (
              'Unsaved'
            ) : (
              <>
                <Check /> Saved
              </>
            )}
          </span>
          <Link href="/" target="_blank" className="preview-link">
            <Eye /> Preview
          </Link>
          <Button
            onClick={() => {
              void save();
            }}
            disabled={saving}
          >
            <Save /> {saving ? 'Saving' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="admin-workspace">
        <aside className="admin-sidebar">
          <section className="admin-section">
            <div className="section-heading">
              <span>Display</span>
            </div>
            <label className="field-label">
              Name
              <input
                data-lpignore="true"
                value={config.name}
                onChange={(event) =>
                  updateConfig((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label">
              Location
              <input
                data-lpignore="true"
                value={config.location}
                onChange={(event) =>
                  updateConfig((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>
            <label className="field-label" htmlFor={timeZoneFieldId}>
              Timezone
              <TimeZoneInput
                id={timeZoneFieldId}
                label="Timezone"
                value={config.timeZone}
                onChange={(timeZone) =>
                  updateConfig((current) => ({ ...current, timeZone }))
                }
              />
            </label>
            <label className="field-label">
              Rotation
              <input
                data-lpignore="true"
                type="number"
                min="1"
                value={config.rotationSeconds}
                onChange={(event) =>
                  updateConfig((current) => ({
                    ...current,
                    rotationSeconds: Math.max(
                      1,
                      Number.parseInt(event.target.value, 10) || 1,
                    ),
                  }))
                }
              />
              <small>seconds</small>
            </label>
            <div className="field-label">
              Colour
              <div className="colour-options">
                {MORROW_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={
                      config.color === color
                        ? 'colour-option is-active'
                        : 'colour-option'
                    }
                    data-swatch={color}
                    onClick={() =>
                      updateConfig((current) => ({ ...current, color }))
                    }
                    aria-label={`${color} display`}
                    aria-pressed={config.color === color}
                  />
                ))}
              </div>
            </div>
            <label className="field-label">
              Default screen
              <select
                value={config.defaultScreenId}
                onChange={(event) =>
                  updateConfig((current) => ({
                    ...current,
                    defaultScreenId: event.target.value,
                  }))
                }
              >
                {config.screens.map((screen) => (
                  <option key={screen.id} value={screen.id}>
                    {screen.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              Admin token
              <input
                data-lpignore="true"
                type="password"
                value={adminToken}
                onChange={(event) => {
                  setTokenOverride(event.target.value);
                  writeStoredAdminToken(event.target.value);
                }}
                placeholder="Only required when hosted"
                autoComplete="off"
              />
              <small className="field-help">Kept in this tab only</small>
            </label>
          </section>

          <section className="admin-section">
            <div className="section-heading">
              <span>Screens</span>
              <select
                className="add-select"
                aria-label="Add screen"
                value=""
                onChange={(event) => {
                  if (event.target.value) addScreen(event.target.value);
                }}
              >
                <option value="">Add…</option>
                {screenPresets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
                <option value={CUSTOM_SCREEN.id}>Custom size</option>
              </select>
            </div>
            <nav className="page-list" aria-label="Screens">
              {config.screens.map((screen) => (
                <button
                  key={screen.id}
                  type="button"
                  className={
                    screen.id === selectedScreen?.id
                      ? 'page-row is-active'
                      : 'page-row'
                  }
                  onClick={() => {
                    setScreenId(screen.id);
                    setBlockId(null);
                  }}
                >
                  <Monitor />
                  <span className="profile-row-copy">
                    <strong>{screen.name}</strong>
                    <small>
                      {screen.width} × {screen.height}
                      {screen.id === config.defaultScreenId ? ' · default' : ''}
                    </small>
                  </span>
                </button>
              ))}
            </nav>
          </section>

          <section className="admin-section pages-section">
            <div className="section-heading">
              <span>Pages</span>
              <button type="button" onClick={addPage} aria-label="Add page">
                <Plus />
              </button>
            </div>
            <nav className="page-list" aria-label="Glance pages">
              {config.pages.map((page, index) => (
                <div key={page.id} className="page-row-wrap">
                  <button
                    type="button"
                    className={
                      page.id === activePage?.id && !selectedScreen
                        ? 'page-row is-active'
                        : 'page-row'
                    }
                    onClick={() => selectPage(page.id)}
                  >
                    <span className="page-index">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    {page.label || 'Untitled page'}
                  </button>
                  <button
                    type="button"
                    className="row-delete"
                    aria-label={`Delete page ${page.label || 'Untitled page'}`}
                    title="Delete page"
                    disabled={config.pages.length === 1}
                    onClick={() => removePage(page.id)}
                  >
                    <Trash2 />
                  </button>
                </div>
              ))}
            </nav>
          </section>
        </aside>

        <section className="admin-builder">
          <div className="builder-heading">
            <input
              data-lpignore="true"
              aria-label="Page name"
              value={activePage?.label ?? ''}
              onChange={(event) =>
                updatePage((page) => ({ ...page, label: event.target.value }))
              }
            />
            <span>{activePage?.blocks.length ?? 0} blocks</span>
            <button
              type="button"
              onClick={() => activePage && removePage(activePage.id)}
              className="quiet-action"
              disabled={config.pages.length === 1}
              title={
                config.pages.length === 1
                  ? 'A Glance needs at least one page'
                  : undefined
              }
            >
              <Trash2 /> Delete page
            </button>
          </div>
          {activePage && (
            <AdminCanvas
              canvasRef={canvasRef}
              page={activePage}
              color={config.color}
              now={now}
              blockData={blockData}
              timeZone={config.timeZone}
              registry={pluginRegistry}
              selectedBlockId={blockId}
              ghost={drag.ghost}
              dragging={drag.dragging}
              draggingBlockId={drag.activeBlockId}
              onSelect={(id) => {
                setBlockId(id);
                setScreenId(null);
              }}
              onDeselect={() => setBlockId(null)}
              onBlockPointerDown={(event, block) =>
                drag.beginMove(event, block)
              }
              onResizePointerDown={(event, block, plugin) =>
                drag.beginResize(event, block, plugin?.manifest.minSize)
              }
              onBlockKeyDown={handleBlockKeyDown}
              onRemoveBlock={removeBlock}
              consumeClick={drag.consumeClick}
            />
          )}
        </section>

        <aside className="admin-inspector">
          {selectedScreen ? (
            <ScreenInspector
              screen={selectedScreen}
              removable={config.screens.length > 1}
              onBack={() => setScreenId(null)}
              onChange={(patch) => updateScreen(selectedScreen.id, patch)}
              onRemove={() => removeScreen(selectedScreen.id)}
            />
          ) : selectedBlock && selectedPlugin ? (
            <BlockInspector
              block={selectedBlock}
              plugin={selectedPlugin}
              sizePresets={sizePresets}
              onBack={() => setBlockId(null)}
              onRemove={() => removeBlock(selectedBlock.id)}
              onResize={resizeBlock}
              onChangeView={(view) =>
                updateBlock(selectedBlock.id, (block) => ({ ...block, view }))
              }
              onChangeSetting={updateSetting}
              onChangeSettings={updateSettings}
              blockData={blockData[selectedBlock.id]}
              onChangeData={(source) =>
                updateBlock(selectedBlock.id, (block) => {
                  const { data: _previous, ...rest } = block;
                  return source ? { ...rest, data: source } : rest;
                })
              }
            />
          ) : (
            <PluginLibrary
              plugins={enabledPlugins}
              onAdd={addPlugin}
              onPointerDown={(event, plugin) => drag.beginAdd(event, plugin)}
              consumeClick={drag.consumeClick}
            />
          )}
        </aside>
      </div>

      {error && (
        <div className="admin-error" role="alert">
          <span>{error}</span>
          {conflict && (
            <button
              type="button"
              className="error-action"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          )}
        </div>
      )}
    </main>
  );
}
