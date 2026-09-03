import { createElement } from 'react';

import type { MorrowPlugin, PluginRuntime } from '@/lib/morrow/types';

/**
 * Plugin discovery.
 *
 * Every `plugins/<name>/plugin.tsx` that exports `plugin` is installed. There
 * is nothing to register: add a folder and restart the dev server. Folders
 * whose name starts with an underscore (such as `_template`) are skipped.
 *
 * Whether an installed plugin is offered in Admin is decided per install by
 * `disabledPlugins` in the configuration.
 */

interface PluginModule {
  plugin?: MorrowPlugin;
}

const modules = import.meta.glob<PluginModule>(['./*/plugin.tsx', '!./_*/**'], {
  eager: true,
});

export function createPluginRuntime(plugin: MorrowPlugin): PluginRuntime {
  const { manifest, icon, views } = plugin;
  return {
    manifest,
    icon,
    hasView: (view) => view in views,
    render(view, props) {
      const View = views[view];
      return View ? createElement(View, props) : null;
    },
  };
}

export function createPluginRegistry(
  plugins: MorrowPlugin[],
): Record<string, PluginRuntime> {
  const registry: Record<string, PluginRuntime> = {};
  for (const plugin of plugins) {
    const { id } = plugin.manifest;
    if (id in registry) throw new Error(`Duplicate plugin id: ${id}`);
    registry[id] = createPluginRuntime(plugin);
  }
  return registry;
}

/** Installed plugins, discovered from the folder layout and sorted by name. */
export const installedPlugins: MorrowPlugin[] = Object.entries(modules)
  .map(([path, module]) => {
    if (!module.plugin) throw new Error(`${path} must export \`plugin\`.`);
    return module.plugin;
  })
  .sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));

export const pluginRegistry = createPluginRegistry(installedPlugins);
export const pluginCatalog = Object.values(pluginRegistry);
