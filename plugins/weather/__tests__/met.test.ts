import { describe, expect, it } from 'vitest';

import fixture from './met-oslo.json';
import { current, dailyForecast, splitSymbol, upcomingHours } from '../met';

const now = new Date('2026-09-03T15:30:00.000Z');

describe('MET parsing', () => {
  it('reads current conditions from the nearest entry', () => {
    const c = current(fixture, now);
    expect(c?.time).toBe('2026-09-03T15:00:00Z');
    expect(c?.temperature).toBe(19.8);
    expect(c?.symbol).toMatch(/^[a-z]+(_day|_night)?$/);
    expect(c?.windSpeed).toBe(3.4);
  });

  it('picks upcoming hours at a fixed step with hourly symbols', () => {
    const hours = upcomingHours(fixture, now, 4, 2);
    expect(hours.map((h) => h.time)).toEqual([
      '2026-09-03T16:00:00Z',
      '2026-09-03T18:00:00Z',
      '2026-09-03T20:00:00Z',
      '2026-09-03T22:00:00Z',
    ]);
    for (const h of hours) expect(Number.isFinite(h.temperature)).toBe(true);
  });

  it('summarises days in the location timezone with high, low, and rain', () => {
    const days = dailyForecast(fixture, 'Europe/Oslo', 7);
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(days[0]?.date).toBe('2026-09-03');
    for (const day of days) {
      expect(day.high).toBeGreaterThanOrEqual(day.low);
      expect(day.precipitation).toBeGreaterThanOrEqual(0);
      expect(day.symbol).toBeTruthy();
    }
  });

  it('handles empty or foreign data without throwing', () => {
    expect(current(null, now)).toBeUndefined();
    expect(upcomingHours({ nope: true }, now)).toEqual([]);
    expect(dailyForecast(undefined, 'UTC')).toEqual([]);
  });

  it('splits symbol codes into base and night flag', () => {
    expect(splitSymbol('clearsky_night')).toEqual({
      base: 'clearsky',
      night: true,
    });
    expect(splitSymbol('heavyrainandthunder')).toEqual({
      base: 'heavyrainandthunder',
      night: false,
    });
  });
});
