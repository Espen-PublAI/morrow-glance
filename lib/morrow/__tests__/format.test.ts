import { describe, expect, it } from 'vitest';

import {
  describeOffset,
  formatDate,
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

describe('the display\u2019s hour format', () => {
  const noon = new Date('2026-09-06T16:15:00.000Z');

  it('writes twenty-four hour by default, as most of the world does', () => {
    expect(formatTime(noon, 'Europe/Oslo')).toBe('18:15');
    expect(formatTime(noon, 'Europe/Oslo', '24h')).toBe('18:15');
  });

  it('writes twelve hour when the display asks for it', () => {
    // Normal in the United States and a few other places.
    expect(formatTime(noon, 'Europe/Oslo', '12h')).toMatch(/^6:15\s?PM$/i);
    expect(formatTime(noon, 'America/New_York', '12h')).toMatch(
      /^12:15\s?PM$/i,
    );
  });

  it('keeps a leading zero only where the format expects one', () => {
    const early = new Date('2026-09-06T05:04:00.000Z');
    expect(formatTime(early, 'UTC', '24h')).toBe('05:04');
    expect(formatTime(early, 'UTC', '12h')).toMatch(/^5:04\s?AM$/i);
  });
});

describe('the display\u2019s language', () => {
  const day = new Date('2026-09-06T10:00:00.000Z');

  it('writes dates in the language the display asks for', () => {
    expect(formatDate(day, 'Europe/Oslo', 'en-GB')).toMatch(/Sunday/);
    // A Norwegian municipality should not have to read English weekdays.
    expect(formatDate(day, 'Europe/Oslo', 'nb-NO')).toMatch(/søndag/i);
    expect(formatDate(day, 'Europe/Oslo', 'de-DE')).toMatch(/Sonntag/);
  });

  it('falls back rather than failing a display on an unknown tag', () => {
    // Well-formed but not a language anyone has: still returns something.
    expect(formatDate(day, 'Europe/Oslo', 'zz-ZZ')).not.toBe('');
    expect(formatTime(day, 'Europe/Oslo', '24h', 'zz-ZZ')).toMatch(/\d/);
  });

  it('keeps the hour format independent of the language', () => {
    expect(formatTime(day, 'Europe/Oslo', '24h', 'nb-NO')).toBe('12:00');
    expect(formatTime(day, 'Europe/Oslo', '12h', 'nb-NO')).toMatch(/12[.:]00/);
  });
});
