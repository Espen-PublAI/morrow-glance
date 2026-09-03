import { Plus } from 'lucide-react';
import type { PointerEvent } from 'react';

import { PluginIcon } from '@/components/admin/plugin-icon';
import type { PluginRuntime } from '@/lib/morrow/types';

export function PluginLibrary({
  plugins,
  onAdd,
  onPointerDown,
  consumeClick,
}: {
  plugins: PluginRuntime[];
  /** Click: place the plugin in the first free slot. */
  onAdd: (plugin: PluginRuntime) => void;
  /** Press and drag: place it where it is dropped. */
  onPointerDown: (
    event: PointerEvent<HTMLElement>,
    plugin: PluginRuntime,
  ) => void;
  consumeClick: () => boolean;
}) {
  return (
    <>
      <div className="library-heading">
        <span>Plugin library</span>
        <strong>Add a block</strong>
      </div>
      <div className="plugin-list">
        {plugins.map((plugin) => (
          <button
            key={plugin.manifest.id}
            type="button"
            className="plugin-card"
            onPointerDown={(event) => onPointerDown(event, plugin)}
            onClick={() => {
              if (!consumeClick()) onAdd(plugin);
            }}
          >
            <span className="plugin-icon">
              <PluginIcon plugin={plugin} />
            </span>
            <span>
              <strong>{plugin.manifest.name}</strong>
              <small>{plugin.manifest.description}</small>
            </span>
            <Plus />
          </button>
        ))}
      </div>
      <p className="library-note">
        Drag a plugin onto the page, or click to add it to the first free space.
        Drag the corner of a block to resize it. Arrow keys nudge a selected
        block; hold Shift to resize.
      </p>
    </>
  );
}
