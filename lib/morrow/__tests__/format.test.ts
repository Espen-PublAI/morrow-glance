import { describe, expect, it } from 'vitest';

import {
  describeOffset,
  formatTime,
  timeZoneCity,
  zoneClock,
  zoneOffsetMinutes,
} from '@/lib/morrow/format';

// 2026-09-03 12:00 UTC: Oslo is UTC+2 (summer), Tokyo UTC+9, New York UTC−4, Kolkata UTC+5:30.
const noon = new Date('2026-09-03T12:00:00.000Z');

describe('timeZoneCity', () => {
  it('takes the last segment and humanises it', () => {
    expect(timeZoneCity('Europe/Oslo')).toBe('Oslo');
    expect(timeZoneCity('America/New_York')).toBe('New York');
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
  });
});

describe('zoneOffsetMinutes and zoneClock', () => {
  it('reads offsets and wall-clock time per zone', () => {
    expect(zoneOffsetMinutes(noon, 'Europe/Oslo')).toBe(120);
    expect(zoneOffsetMinutes(noon, 'Asia/Tokyo')).toBe(540);
    expect(zoneOffsetMinutes(noon, 'America/New_York')).toBe(-240);
    expect(zoneOffsetMinutes(noon, 'Asia/Kolkata')).toBe(330);
    expect(zoneClock(noon, 'Asia/Tokyo')).toEqual({ hours: 21, minutes: 0 });
    expect(formatTime(noon, 'Asia/Tokyo')).toBe('21:00');
  });
});

describe('describeOffset', () => {
  it('describes another zone relative to the display zone', () => {
    expect(describeOffset(noon, 'Europe/Oslo', 'Europe/Oslo')).toBe('');
    expect(describeOffset(noon, 'Asia/Tokyo', 'Europe/Oslo')).toBe('+7h');
    expect(describeOffset(noon, 'America/New_York', 'Europe/Oslo')).toBe('−6h');
    expect(describeOffset(noon, 'Asia/Kolkata', 'Europe/Oslo')).toBe('+3:30');
  });

  it('notes when the calendar date differs', () => {
    const lateEvening = new Date('2026-09-03T21:30:00.000Z'); // 23:30 in Oslo, 06:30 next day in Tokyo
    expect(describeOffset(lateEvening, 'Asia/Tokyo', 'Europe/Oslo')).toBe(
      '+7h · tomorrow',
    );
    const earlyMorning = new Date('2026-09-03T01:00:00.000Z'); // 03:00 in Oslo, 21:00 previous day in NY
    expect(
      describeOffset(earlyMorning, 'America/New_York', 'Europe/Oslo'),
    ).toBe('−6h · yesterday');
  });

  it('is empty for unknown zones instead of throwing', () => {
    expect(describeOffset(noon, 'Mars/Olympus', 'Europe/Oslo')).toBe('');
  });
});
