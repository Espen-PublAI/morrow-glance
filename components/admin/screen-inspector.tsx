import { ArrowLeft, Trash2 } from 'lucide-react';

import { isPortrait } from '@/lib/morrow/screens';
import type { ScreenProfile } from '@/lib/morrow/types';

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function ScreenInspector({
  screen,
  removable,
  onBack,
  onChange,
  onRemove,
}: {
  screen: ScreenProfile;
  removable: boolean;
  onBack: () => void;
  onChange: (patch: Partial<ScreenProfile>) => void;
  onRemove: () => void;
}) {
  const playerUrl = `/?screen=${encodeURIComponent(screen.id)}`;

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
          <span>Screen</span>
          <strong>{screen.name}</strong>
        </div>
        <button
          type="button"
          onClick={onRemove}
          disabled={!removable}
          aria-label="Remove screen"
          title={
            removable ? 'Remove screen' : 'A Glance needs at least one screen'
          }
        >
          <Trash2 />
        </button>
      </div>

      <section className="inspector-section setting-fields">
        <span className="inspector-label">Reference size</span>
        <label className="field-label">
          Name
          <input
            data-lpignore="true"
            value={screen.name}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <div className="field-pair">
          <label className="field-label">
            Width
            <input
              data-lpignore="true"
              type="number"
              min="1"
              max="8192"
              value={screen.width}
              onChange={(event) =>
                onChange({
                  width: positiveInteger(event.target.value, screen.width),
                })
              }
            />
          </label>
          <label className="field-label">
            Height
            <input
              data-lpignore="true"
              type="number"
              min="1"
              max="8192"
              value={screen.height}
              onChange={(event) =>
                onChange({
                  height: positiveInteger(event.target.value, screen.height),
                })
              }
            />
          </label>
        </div>
        <label className="field-label">
          Refresh
          <input
            data-lpignore="true"
            type="number"
            min="1"
            value={screen.refreshSeconds}
            onChange={(event) =>
              onChange({
                refreshSeconds: positiveInteger(
                  event.target.value,
                  screen.refreshSeconds,
                ),
              })
            }
          />
          <small>seconds</small>
        </label>
        <p className="field-note">
          {isPortrait(screen) ? 'Portrait' : 'Landscape'} · the Player adapts to
          the real viewport; this size is what the layout is designed against.
        </p>
      </section>

      <section className="inspector-section endpoint-section">
        <span className="inspector-label">Player URL</span>
        <code>{playerUrl}</code>
        <p>
          Open this address on the screen. It follows this screen&apos;s refresh
          interval.
        </p>
      </section>
    </>
  );
}
