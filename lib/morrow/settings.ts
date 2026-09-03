import type { PluginSettings } from '@/lib/morrow/types';

/**
 * Typed readers for plugin settings. Settings arrive as loosely typed values,
 * so plugins should read through these instead of indexing directly.
 */

export function readStringSetting(
  settings: PluginSettings,
  key: string,
  fallback = '',
): string {
  const value = settings[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

export function readNumberSetting(
  settings: PluginSettings,
  key: string,
  fallback: number,
): number {
  const value = settings[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function readBooleanSetting(
  settings: PluginSettings,
  key: string,
  fallback = false,
): boolean {
  const value = settings[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}
