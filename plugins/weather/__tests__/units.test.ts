import { describe, expect, it } from 'vitest';

import { degrees, rainfall, readUnits } from '../units';

/**
 * MET Norway reports Celsius and millimetres. A display elsewhere should not
 * have to read those, so the conversion is a setting rather than an
 * assumption.
 */

describe('choosing units', () => {
  it('is metric unless the block says imperial', () => {
    expect(readUnits({})).toBe('metric');
    expect(readUnits({ units: 'metric' })).toBe('metric');
    expect(readUnits({ units: 'imperial' })).toBe('imperial');
    // Anything unrecognised keeps the default rather than failing a block.
    expect(readUnits({ units: 'stones' })).toBe('metric');
  });
});

describe('temperature', () => {
  it('rounds Celsius, and converts for Fahrenheit', () => {
    expect(degrees(19.8, 'metric')).toBe('20°');
    expect(degrees(0, 'metric')).toBe('0°');
    expect(degrees(-4.4, 'metric')).toBe('-4°');
    // 20 °C is 68 °F; freezing is 32.
    expect(degrees(20, 'imperial')).toBe('68°');
    expect(degrees(0, 'imperial')).toBe('32°');
    expect(degrees(-40, 'imperial')).toBe('-40°');
  });

  it('shows a dash rather than a number it does not have', () => {
    expect(degrees(Number.NaN, 'metric')).toBe('–');
    expect(degrees(Number.NaN, 'imperial')).toBe('–');
  });
});

describe('precipitation', () => {
  it('writes millimetres or inches', () => {
    expect(rainfall(3.5, 'metric')).toBe('3.5 mm');
    // 25.4 mm is one inch.
    expect(rainfall(25.4, 'imperial')).toBe('1.00 in');
    expect(rainfall(12.7, 'imperial')).toBe('0.50 in');
  });

  it('says nothing at all when there is no rain', () => {
    expect(rainfall(0, 'metric')).toBe('');
    expect(rainfall(0, 'imperial')).toBe('');
    expect(rainfall(Number.NaN, 'metric')).toBe('');
  });

  it('does not print a hundredth of an inch as nothing', () => {
    // 0.1 mm is 0.004 in, which would round to 0.00 and read as dry.
    expect(rainfall(0.1, 'imperial')).toBe('<0.01 in');
    expect(rainfall(0.1, 'metric')).toBe('0.1 mm');
  });
});
