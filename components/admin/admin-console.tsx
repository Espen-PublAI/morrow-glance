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
import { useId } from 'react';

import { AdminCanvas } from '@/components/admin/admin-canvas';
import { BlockInspector } from '@/components/admin/block-inspector';
import { PluginLibrary } from '@/components/admin/plugin-library';
import { ScreenInspector } from '@/components/admin/screen-inspector';
import { TimeZoneInput } from '@/components/admin/timezone-input';
import {
  CUSTOM_SCREEN_ID,
  useAdminState,
  type AdminStateOptions,
} from '@/components/admin/use-admin-state';
import { Button } from '@/components/ui/button';
import { screenPresets } from '@/lib/morrow/screens';
import { MORROW_COLORS } from '@/lib/morrow/types';
import { pluginRegistry } from '@/plugins';

/**
 * Admin: the visual control surface that edits and saves the shared
 * configuration. This file is layout only. Everything it can do lives in
 * `useAdminState`, which is where the behaviour is tested.
 */
export function AdminConsole(props: AdminStateOptions) {
  const {
    config,
    activePage,
    selectedBlock,
    selectedBlockId,
    selectedPlugin,
    selectedScreen,
    enabledPlugins,
    sizePresets,
    blockData,
    now,
    canvasRef,
    drag,
    dirty,
    saving,
    error,
    conflict,
    adminToken,
    updateConfig,
    setAdminToken,
    selectPage,
    addPage,
    removePage,
    updatePage,
    addScreen,
    updateScreen,
    removeScreen,
    selectScreen,
    addPlugin,
    removeBlock,
    resizeBlock,
    updateBlock,
    updateSetting,
    updateSettings,
    selectBlock,
    handleBlockKeyDown,
    save,
  } = useAdminState(props);
  const timeZoneFieldId = useId();

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
            <div className="field-label">
              Footer
              <ul className="footer-toggles">
                {(
                  [
                    ['date', 'Date'],
                    ['location', 'Location'],
                    ['time', 'Time'],
                  ] as const
                ).map(([field, label]) => (
                  <li key={field}>
                    <label className="field-label">
                      <input
                        type="checkbox"
                        className="field-checkbox"
                        checked={config.footer[field]}
                        onChange={(event) =>
                          updateConfig((current) => ({
                            ...current,
                            footer: {
                              ...current.footer,
                              [field]: event.target.checked,
                            },
                          }))
                        }
                      />
                      {label}
                    </label>
                  </li>
                ))}
              </ul>
              <small className="field-help">
                The display name is always shown
              </small>
            </div>

            <label className="field-label">
              Admin token
              <input
                data-lpignore="true"
                type="password"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
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
                <option value={CUSTOM_SCREEN_ID}>Custom size</option>
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
                    selectScreen(screen.id);
                    selectBlock(null);
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
              selectedBlockId={selectedBlockId}
              ghost={drag.ghost}
              dragging={drag.dragging}
              draggingBlockId={drag.activeBlockId}
              onSelect={(id) => {
                selectBlock(id);
                selectScreen(null);
              }}
              onDeselect={() => selectBlock(null)}
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
              onBack={() => selectScreen(null)}
              onChange={(patch) => updateScreen(selectedScreen.id, patch)}
              onRemove={() => removeScreen(selectedScreen.id)}
            />
          ) : selectedBlock && selectedPlugin ? (
            <BlockInspector
              block={selectedBlock}
              plugin={selectedPlugin}
              sizePresets={sizePresets}
              onBack={() => selectBlock(null)}
              onRemove={() => removeBlock(selectedBlock.id)}
              onResize={resizeBlock}
              onChangeView={(view) =>
                updateBlock(selectedBlock.id, (block) => ({ ...block, view }))
              }
              onChangeSetting={updateSetting}
              onChangeSettings={updateSettings}
              displayTimeZone={config.timeZone}
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
