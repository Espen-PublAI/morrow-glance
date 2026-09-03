import zonesJson from '@/lib/morrow/geo/zones.json';

/**
 * Geography for the world clock: where a city or zone sits on the map.
 * The heavy city index is loaded lazily by Admin only; the Player needs just
 * the small per-zone table and a projection.
 */

export interface City {
  /** Display name. */
  n: string;
  /** ISO 3166 country code. */
  c: string;
  /** IANA timezone. */
  z: string;
  /** Alternate names people might type. */
  a: string[];
  /** Population, used for ranking. */
  p: number;
  la: number;
  lo: number;
}

export interface Coordinates {
  lat: number;
  lon: number;
}

const zones = zonesJson as unknown as Record<string, [number, number]>;

/** Representative coordinates for an IANA zone (its largest city), if known. */
export function zoneCoordinates(timeZone: string): Coordinates | undefined {
  const entry = zones[timeZone];
  return entry ? { lat: entry[0], lon: entry[1] } : undefined;
}

/** `"10.82,106.63"` → coordinates, or undefined for anything malformed. */
export function parseCoordinates(
  value: string | undefined,
): Coordinates | undefined {
  if (!value) return undefined;
  const [lat, lon] = value.split(',').map((part) => Number(part.trim()));
  if (lat === undefined || lon === undefined) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

export function formatCoordinates({ lat, lon }: Coordinates): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

/** Equirectangular projection onto a width × height box. */
export function project(
  { lat, lon }: Coordinates,
  width: number,
  height: number,
) {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

function normalise(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Rank cities for a query: exact name first, then names starting with the
 * query, then alternates and substrings, larger cities first within a tier.
 */
export function searchCities(index: City[], query: string, limit = 8): City[] {
  const q = normalise(query);
  if (q.length < 2) return [];
  const scored: Array<{ city: City; score: number }> = [];
  for (const city of index) {
    const name = normalise(city.n);
    let score = 0;
    if (name === q) score = 4;
    else if (name.startsWith(q)) score = 3;
    else if (city.a.some((alt) => normalise(alt) === q)) score = 3;
    else if (city.a.some((alt) => normalise(alt).startsWith(q))) score = 2;
    else if (name.includes(q)) score = 1;
    if (score > 0) scored.push({ city, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || b.city.p - a.city.p)
    .slice(0, limit)
    .map((entry) => entry.city);
}

/** IANA zones whose name matches the query, for places the index lacks. */
export function searchZones(
  zones: string[],
  query: string,
  limit = 4,
): string[] {
  const q = normalise(query).replace(/\s+/g, '_');
  if (q.length < 2) return [];
  return zones.filter((zone) => normalise(zone).includes(q)).slice(0, limit);
}

let indexPromise: Promise<City[]> | null = null;

/** The city index, loaded once on demand so Players never ship it. */
export function loadCityIndex(): Promise<City[]> {
  indexPromise ??= import('@/lib/morrow/geo/cities.json').then(
    (module) => module.default as City[],
  );
  return indexPromise;
}
