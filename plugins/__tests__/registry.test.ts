import { describe, expect, it } from 'vitest';

import {
  createPluginRegistry,
  installedPlugins,
  pluginCatalog,
} from '@/plugins';

describe('plugin discovery', () => {
  it('finds every plugins/<name>/plugin.tsx and skips underscore folders', () => {
    const ids = installedPlugins.map((plugin) => plugin.manifest.id);
    expect(ids).toContain('morrow.clock');
    expect(ids).toContain('morrow.text');
    expect(ids).not.toContain('example.plugin');
  });

  it('gives every plugin a unique, namespaced id and at least one view', () => {
    const ids = installedPlugins.map((plugin) => plugin.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const plugin of installedPlugins) {
      expect(plugin.manifest.id).toMatch(/^[a-z0-9]+\.[a-z0-9.-]+$/);
      expect(plugin.manifest.views.length).toBeGreaterThan(0);
      for (const view of plugin.manifest.views) {
        expect(plugin.views[view.id]).toBeTypeOf('function');
      }
    }
  });

  it('sorts the catalogue by name and rejects duplicate ids', () => {
    const names = pluginCatalog.map((plugin) => plugin.manifest.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const first = installedPlugins[0];
    expect(first).toBeDefined();
    if (first)
      expect(() => createPluginRegistry([first, first])).toThrow(
        /Duplicate plugin id/,
      );
  });
});
