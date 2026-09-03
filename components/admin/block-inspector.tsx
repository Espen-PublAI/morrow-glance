import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';

import { CityInput } from '@/components/admin/city-input';
import { SecretInput } from '@/components/admin/secret-input';
import { TimeZoneInput } from '@/components/admin/timezone-input';
import type { SizePreset } from '@/lib/morrow/layout';
import { CONFIG_LIMITS } from '@/lib/morrow/config';
import type {
  BlockData,
  BlockDataSource,
  GlanceBlock,
  PluginRuntime,
  PluginSettingValue,
  PluginSettings,
} from '@/lib/morrow/types';

export function BlockInspector({
  block,
  plugin,
  sizePresets,
  onBack,
  onRemove,
  onResize,
  onChangeView,
  onChangeSetting,
  onChangeSettings,
  blockData,
  onChangeData,
  displayTimeZone,
}: {
  block: GlanceBlock;
  plugin: PluginRuntime;
  sizePresets: SizePreset[];
  onBack: () => void;
  onRemove: () => void;
  onResize: (span: number, rowSpan: number) => void;
  onChangeView: (view: string) => void;
  onChangeSetting: (id: string, value: PluginSettingValue) => void;
  /** Apply several settings at once, as a city pick does. */
  onChangeSettings: (patch: PluginSettings) => void;
  /** Latest stored data for this block, if any. */
  blockData?: BlockData;
  onChangeData: (source: BlockDataSource | undefined) => void;
  /** The display's timezone, used for typed coordinates. */
  displayTimeZone: string;
}) {
  const { manifest } = plugin;
  const settings = manifest.settings ?? [];
  const fieldPrefix = useId();
  const source = block.data;
  const webhookPath = `/api/webhooks/${block.id}`;

  const setKind = (kind: string) => {
    if (kind === 'poll') {
      onChangeData(
        source?.kind === 'poll'
          ? source
          : { kind: 'poll', url: '', intervalSeconds: 300 },
      );
    } else if (kind === 'webhook') {
      onChangeData({ kind: 'webhook' });
    } else {
      onChangeData(undefined);
    }
  };

  return (
    <>
      <div className="inspector-heading">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to plugin library"
        >
          <ArrowLeft />
        </button>
        <div>
          <span>Block</span>
          <strong>{manifest.name}</strong>
        </div>
        <button type="button" onClick={onRemove} aria-label="Remove block">
          <Trash2 />
        </button>
      </div>

      <section className="inspector-section">
        <span className="inspector-label">Size</span>
        <div className="size-options">
          {sizePresets.map((size) => (
            <button
              key={size.label}
              type="button"
              className={
                block.span === size.span && block.rowSpan === size.rowSpan
                  ? 'is-active'
                  : ''
              }
              onClick={() => onResize(size.span, size.rowSpan)}
            >
              {size.label}
            </button>
          ))}
        </div>
      </section>

      {manifest.views.length > 1 && (
        <section className="inspector-section">
          <label className="field-label">
            View
            <select
              value={block.view}
              onChange={(event) => onChangeView(event.target.value)}
            >
              {manifest.views.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
          </label>
        </section>
      )}

      {settings.length > 0 && (
        <section className="inspector-section setting-fields">
          <span className="inspector-label">Content</span>
          {settings.map((setting) => {
            const value = String(block.settings?.[setting.id] ?? '');
            const fieldId = `${fieldPrefix}-${setting.id}`;
            return (
              <label key={setting.id} className="field-label" htmlFor={fieldId}>
                {setting.label}
                {setting.type === 'textarea' ? (
                  <textarea
                    data-lpignore="true"
                    id={fieldId}
                    value={value}
                    onChange={(event) =>
                      onChangeSetting(setting.id, event.target.value)
                    }
                    placeholder={setting.placeholder}
                    rows={5}
                  />
                ) : setting.type === 'secret' ? (
                  <SecretInput
                    id={fieldId}
                    blockId={block.id}
                    name={setting.id}
                    placeholder={setting.placeholder}
                  />
                ) : setting.type === 'boolean' ? (
                  <input
                    id={fieldId}
                    type="checkbox"
                    className="field-checkbox"
                    checked={
                      block.settings?.[setting.id] === undefined
                        ? setting.defaultValue === true
                        : block.settings[setting.id] === true
                    }
                    onChange={(event) =>
                      onChangeSetting(setting.id, event.target.checked)
                    }
                  />
                ) : setting.type === 'city' ? (
                  <CityInput
                    id={fieldId}
                    value={value}
                    displayTimeZone={displayTimeZone}
                    onChange={onChangeSettings}
                  />
                ) : setting.type === 'timezone' ? (
                  <TimeZoneInput
                    id={fieldId}
                    label={setting.label}
                    value={value}
                    onChange={(next) => onChangeSetting(setting.id, next)}
                    placeholder={setting.placeholder}
                  />
                ) : (
                  <input
                    data-lpignore="true"
                    id={fieldId}
                    value={value}
                    onChange={(event) =>
                      onChangeSetting(setting.id, event.target.value)
                    }
                    placeholder={setting.placeholder}
                  />
                )}
              </label>
            );
          })}
        </section>
      )}
      {manifest.serverFetch && (
        <section className="inspector-section">
          <span className="inspector-label">Data</span>
          <p className="data-status">
            {blockData?.fetchedAt
              ? `Fetched by Morrow Server · last data ${new Date(blockData.fetchedAt).toLocaleString()}`
              : 'Fetched by Morrow Server with its own credentials. Save, then wait for the first fetch.'}
            {blockData?.error && (
              <span className="data-status-error">{blockData.error}</span>
            )}
          </p>
        </section>
      )}

      {manifest.source && !manifest.acceptsData && (
        <section className="inspector-section">
          <span className="inspector-label">Data</span>
          <p className="data-status">
            {manifest.source(block.settings ?? {})
              ? blockData?.fetchedAt
                ? `Fetched by the plugin · last data ${new Date(blockData.fetchedAt).toLocaleString()}`
                : 'Fetched by the plugin from its settings. Save, then wait for the first fetch.'
              : 'The plugin fetches its own data once its settings are complete.'}
            {blockData?.error && (
              <span className="data-status-error">{blockData.error}</span>
            )}
          </p>
        </section>
      )}

      {manifest.acceptsData && (
        <section className="inspector-section setting-fields">
          <span className="inspector-label">Data</span>
          <label className="field-label" htmlFor={`${fieldPrefix}-data-kind`}>
            Source
            <select
              id={`${fieldPrefix}-data-kind`}
              value={source?.kind ?? 'none'}
              onChange={(event) => setKind(event.target.value)}
            >
              <option value="none">None</option>
              <option value="poll">Poll a public JSON URL</option>
              <option value="webhook">Receive a webhook</option>
            </select>
          </label>

          {source?.kind === 'poll' && (
            <>
              <label
                className="field-label"
                htmlFor={`${fieldPrefix}-data-url`}
              >
                URL
                <input
                  id={`${fieldPrefix}-data-url`}
                  data-lpignore="true"
                  type="url"
                  inputMode="url"
                  value={source.url}
                  placeholder="https://api.example.com/current.json"
                  onChange={(event) =>
                    onChangeData({ ...source, url: event.target.value })
                  }
                />
              </label>
              <label
                className="field-label"
                htmlFor={`${fieldPrefix}-data-interval`}
              >
                Refresh every
                <input
                  id={`${fieldPrefix}-data-interval`}
                  data-lpignore="true"
                  type="number"
                  min={CONFIG_LIMITS.pollIntervalMin}
                  max={CONFIG_LIMITS.pollIntervalMax}
                  value={source.intervalSeconds}
                  onChange={(event) =>
                    onChangeData({
                      ...source,
                      intervalSeconds: Math.max(
                        CONFIG_LIMITS.pollIntervalMin,
                        Number.parseInt(event.target.value, 10) ||
                          CONFIG_LIMITS.pollIntervalMin,
                      ),
                    })
                  }
                />
                <small>seconds</small>
              </label>
              <p className="field-note">
                Public https URLs only, JSON up to 64 KB. Morrow Server fetches
                it while a screen is showing this block. Authenticated sources
                should push data with a webhook instead.
              </p>
            </>
          )}

          {source?.kind === 'webhook' && (
            <>
              <code className="endpoint-code">POST {webhookPath}</code>
              <p className="field-note">
                Send JSON with the header{' '}
                <code>Authorization: Bearer &lt;MORROW_WEBHOOK_TOKEN&gt;</code>.
                Each delivery replaces the block&apos;s data. Works from Power
                Automate, n8n, Home Assistant, or curl.
              </p>
            </>
          )}

          {source && (
            <p className="data-status">
              {blockData?.fetchedAt
                ? `Last data ${new Date(blockData.fetchedAt).toLocaleString()}`
                : 'No data received yet. Save, then wait for the first fetch or delivery.'}
              {blockData?.error && (
                <span className="data-status-error">{blockData.error}</span>
              )}
            </p>
          )}
        </section>
      )}

      <section className="inspector-danger">
        <button type="button" className="danger-action" onClick={onRemove}>
          <Trash2 /> Remove block
        </button>
        <button
          type="button"
          className="quiet-action inspector-back"
          onClick={onBack}
        >
          <Plus /> Add another block
        </button>
      </section>
    </>
  );
}
