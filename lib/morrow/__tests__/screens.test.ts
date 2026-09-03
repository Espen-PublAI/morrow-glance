import { describe, expect, it } from 'vitest';

import {
  defaultScreen,
  findScreen,
  isPortrait,
  resolveScreen,
  screenPresets,
} from '@/lib/morrow/screens';
import { morrowConfig } from '@/morrow.config';

describe('screen presets', () => {
  it('have unique, URL-safe ids and sane sizes', () => {
    const ids = screenPresets.map((screen) => screen.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const screen of screenPresets) {
      expect(screen.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(screen.width).toBeGreaterThan(0);
      expect(screen.height).toBeGreaterThan(0);
      expect(screen.refreshSeconds).toBeGreaterThan(0);
    }
  });

  it('include the browser screen used by a clean install', () => {
    expect(screenPresets.some((screen) => screen.id === 'browser')).toBe(true);
  });
});

describe('findScreen and defaultScreen', () => {
  it('resolve by id and fall back to the configured default', () => {
    expect(findScreen(morrowConfig, 'browser')?.name).toBe(
      'Browser · adaptive',
    );
    expect(findScreen(morrowConfig, 'nope')).toBeUndefined();
    expect(findScreen(morrowConfig, null)).toBeUndefined();
    expect(defaultScreen(morrowConfig).id).toBe('browser');
  });

  it('use the first screen when the default id is stale', () => {
    expect(defaultScreen({ ...morrowConfig, defaultScreenId: 'gone' }).id).toBe(
      'browser',
    );
  });
});

describe('isPortrait', () => {
  it('compares height against width', () => {
    expect(isPortrait({ width: 1024, height: 1366 })).toBe(true);
    expect(isPortrait({ width: 1920, height: 1080 })).toBe(false);
  });
});

describe('resolveScreen', () => {
  const config = {
    ...morrowConfig,
    screens: [
      ...morrowConfig.screens,
      {
        id: 'lobby-tv',
        name: 'Lobby TV',
        width: 3840,
        height: 2160,
        refreshSeconds: 60,
      },
    ],
  };

  it('prefers the screen named in the Player URL', () => {
    expect(resolveScreen(config, 'lobby-tv').refreshSeconds).toBe(60);
  });

  it('falls back to the default for unknown or missing ids', () => {
    expect(resolveScreen(config, 'nope').id).toBe('browser');
    expect(resolveScreen(config, null).id).toBe('browser');
  });
});
