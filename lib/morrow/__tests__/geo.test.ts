import { describe, expect, it } from 'vitest';

import {
  formatCoordinates,
  parseCoordinates,
  project,
  searchCities,
  searchZones,
  zoneCoordinates,
  type City,
} from '@/lib/morrow/geo';

const index: City[] = [
  {
    n: 'Ho Chi Minh City',
    c: 'VN',
    z: 'Asia/Ho_Chi_Minh',
    a: ['Saigon', 'Sai Gon'],
    p: 14_000_000,
    la: 10.82,
    lo: 106.63,
  },
  {
    n: 'Oslo',
    c: 'NO',
    z: 'Europe/Oslo',
    a: [],
    p: 700_000,
    la: 59.91,
    lo: 10.75,
  },
  {
    n: 'Bergen',
    c: 'NO',
    z: 'Europe/Oslo',
    a: [],
    p: 294_000,
    la: 60.39,
    lo: 5.32,
  },
  {
    n: 'Bergen op Zoom',
    c: 'NL',
    z: 'Europe/Amsterdam',
    a: [],
    p: 66_000,
    la: 51.5,
    lo: 4.29,
  },
  {
    n: 'São Paulo',
    c: 'BR',
    z: 'America/Sao_Paulo',
    a: ['Sao Paulo'],
    p: 12_000_000,
    la: -23.55,
    lo: -46.63,
  },
];

describe('searchCities', () => {
  it('finds cities by name, alternate name, and without diacritics', () => {
    expect(searchCities(index, 'saigon').map((c) => c.n)).toEqual([
      'Ho Chi Minh City',
    ]);
    expect(searchCities(index, 'ho chi').map((c) => c.n)).toEqual([
      'Ho Chi Minh City',
    ]);
    expect(searchCities(index, 'sao paulo').map((c) => c.n)).toEqual([
      'São Paulo',
    ]);
  });

  it('ranks exact and prefix matches above substrings, larger cities first', () => {
    expect(searchCities(index, 'bergen').map((c) => c.n)).toEqual([
      'Bergen',
      'Bergen op Zoom',
    ]);
    expect(searchCities(index, 'o').length).toBe(0);
  });
});

describe('searchZones', () => {
  it('matches zone names with spaces or underscores', () => {
    const zones = ['Europe/Oslo', 'Asia/Ho_Chi_Minh', 'America/New_York'];
    expect(searchZones(zones, 'new york')).toEqual(['America/New_York']);
    expect(searchZones(zones, 'chi_minh')).toEqual(['Asia/Ho_Chi_Minh']);
  });
});

describe('coordinates and projection', () => {
  it('round-trips and validates coordinates', () => {
    expect(parseCoordinates('10.82,106.63')).toEqual({
      lat: 10.82,
      lon: 106.63,
    });
    expect(parseCoordinates('91,0')).toBeUndefined();
    expect(parseCoordinates('nope')).toBeUndefined();
    expect(parseCoordinates(undefined)).toBeUndefined();
    expect(formatCoordinates({ lat: 59.9127, lon: 10.7461 })).toBe(
      '59.91,10.75',
    );
  });

  it('projects with equirectangular mapping', () => {
    expect(project({ lat: 0, lon: 0 }, 100, 50)).toEqual({ x: 50, y: 25 });
    expect(project({ lat: 90, lon: -180 }, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(project({ lat: -90, lon: 180 }, 100, 50)).toEqual({ x: 100, y: 50 });
  });

  it('knows a representative point for common zones', () => {
    const oslo = zoneCoordinates('Europe/Oslo');
    expect(oslo?.lat).toBeCloseTo(59.9, 0);
    expect(zoneCoordinates('Mars/Olympus')).toBeUndefined();
  });
});
