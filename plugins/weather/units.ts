import { readStringSetting } from '@/lib/morrow/settings';
import type { PluginSettings } from '@/lib/morrow/types';

/**
 * MET Norway reports in Celsius and millimetres. A display elsewhere may want
 * Fahrenheit and inches, so the conversion lives here rather than being
 * assumed away in the views.
 */

export const WEATHER_UNITS = ['metric', 'imperial'] as const;
export type WeatherUnits = (typeof WEATHER_UNITS)[number];

export function readUnits(settings: PluginSettings): WeatherUnits {
  return readStringSetting(settings, 'units') === 'imperial'
    ? 'imperial'
    : 'metric';
}

/** A temperature as the display writes it, degree sign included. */
export function degrees(value: number, units: WeatherUnits): string {
  if (!Number.isFinite(value)) return '\u2013';
  const shown = units === 'imperial' ? value * 1.8 + 32 : value;
  return `${Math.round(shown)}\u00b0`;
}

/** Precipitation, in millimetres or inches, or empty when there is none. */
export function rainfall(value: number, units: WeatherUnits): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (units === 'imperial') {
    const inches = value / 25.4;
    // Below a hundredth of an inch, say so rather than printing 0.00.
    return inches < 0.01 ? '<0.01 in' : `${inches.toFixed(2)} in`;
  }
  return `${value.toFixed(1)} mm`;
}
