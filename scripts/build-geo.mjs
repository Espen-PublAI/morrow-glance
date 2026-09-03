#!/usr/bin/env node
/**
 * Build the geographic data used by the world clock:
 *
 *   lib/morrow/geo/cities.json  City index for the Admin picker (GeoNames, CC BY 4.0); population in thousands
 *   lib/morrow/geo/zones.json   Representative coordinates per IANA zone (from the index)
 *   lib/morrow/geo/land.json    Dot-grid land mask for the map view (Natural Earth, public domain)
 *
 * Usage: node scripts/build-geo.mjs [path/to/cities15000.txt]
 * Download cities15000.zip from https://download.geonames.org/export/dump/ first.
 * Re-run only when refreshing data; the outputs are committed.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { feature } = require('topojson-client');
const land110 = require('world-atlas/land-110m.json');

const source = process.argv[2] ?? 'cities15000.txt';
const MIN_POPULATION = 100_000;
// Alternate names (exonyms such as Saigon or Bombay) matter for large cities;
// smaller ones are found by their name. Keeps the index small.
const ALTERNATES_FROM_POPULATION = 500_000;
const MAX_ALTERNATES = 8;

/**
 * Pick the alternates a person is likely to type: proper nouns in ASCII,
 * short, not airport codes, and not just the name with a prefix or suffix.
 */
function pickAlternates(name, ascii, raw) {
  const lowerName = name.toLowerCase();
  const seen = new Set([lowerName, ascii.toLowerCase()]);
  const candidates = [];
  for (const alt of raw.split(',')) {
    const clean = alt.trim();
    const lower = clean.toLowerCase();
    if (!clean || seen.has(lower)) continue;
    if (!/^[A-Z][A-Za-z .'-]{2,19}$/.test(clean)) continue; // ASCII proper noun, 3-20 chars
    if (/^[A-Z]{3}$/.test(clean)) continue; // airport code
    if (lower.includes(lowerName) || lowerName.includes(lower)) continue; // prefix/suffix variants
    seen.add(lower);
    candidates.push(clean);
  }
  candidates.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return candidates.slice(0, MAX_ALTERNATES);
}

// ---------------------------------------------------------------- cities
const rows = readFileSync(resolve(source), 'utf8').split('\n').filter(Boolean);
const cities = [];
for (const row of rows) {
  const f = row.split('\t');
  const population = Number(f[14]);
  const timeZone = f[17];
  if (!timeZone || population < MIN_POPULATION) continue;
  const name = f[1];
  const ascii = f[2] ?? '';
  const alternates =
    population >= ALTERNATES_FROM_POPULATION
      ? pickAlternates(name, ascii, f[3] ?? '')
      : [];
  if (ascii && ascii.toLowerCase() !== name.toLowerCase())
    alternates.unshift(ascii);
  cities.push({
    n: name,
    c: f[8],
    z: timeZone,
    a: alternates,
    p: Math.round(population / 1000),
    la: Number(Number(f[4]).toFixed(2)),
    lo: Number(Number(f[5]).toFixed(2)),
  });
}
cities.sort((a, b) => b.p - a.p);

// One representative point per zone: its most populous city.
const zones = {};
for (const city of cities) zones[city.z] ??= [city.la, city.lo];

// ---------------------------------------------------------------- land mask
const COLS = 96;
const ROWS = 48;
const land = feature(land110, land110.objects.land);

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}
function pointInPolygon(x, y, polygon) {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1)
    if (pointInRing(x, y, polygon[i])) return false;
  return true;
}
function isLand(lon, lat) {
  for (const f of land.features) {
    const polygons =
      f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry.coordinates;
    for (const polygon of polygons)
      if (pointInPolygon(lon, lat, polygon)) return true;
  }
  return false;
}
const grid = [];
for (let r = 0; r < ROWS; r += 1) {
  const lat = 90 - ((r + 0.5) / ROWS) * 180;
  let line = '';
  for (let c = 0; c < COLS; c += 1) {
    const lon = -180 + ((c + 0.5) / COLS) * 360;
    // Antarctica is left blank: it carries no cities and would sit behind the time.
    line += lat > -60 && isLand(lon, lat) ? '#' : '.';
  }
  grid.push(line);
}

// ---------------------------------------------------------------- write
const out = (file, data) =>
  writeFileSync(resolve('lib/morrow/geo', file), JSON.stringify(data) + '\n');
out('cities.json', cities);
out('zones.json', zones);
out('land.json', { cols: COLS, rows: ROWS, grid });
console.log(
  `cities: ${cities.length}, zones: ${Object.keys(zones).length}, land cells: ${grid.join('').split('#').length - 1}`,
);
