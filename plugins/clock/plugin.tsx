import { Clock3 } from 'lucide-react';

import {
  describeOffset,
  formatTime,
  timeZoneCity,
  zoneClock,
} from '@/lib/morrow/format';
import { parseCoordinates, project, zoneCoordinates } from '@/lib/morrow/geo';
import landJson from '@/lib/morrow/geo/land.json';
import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

/**
 * A world clock. Pick a city in Admin; the block stores the city name, its
 * timezone, and its coordinates. Three views: digits, a clock face, and a
 * dotted world map with the city marked. When the zone differs from the
 * display's own, the offset and day shift are shown.
 */

const land = landJson as { cols: number; rows: number; grid: string[] };

function useClockSettings({
  settings,
  timeZone: displayZone,
}: PluginViewProps) {
  const zone = readStringSetting(settings, 'timeZone') || displayZone;
  const city = readStringSetting(settings, 'city') || timeZoneCity(zone);
  const label = readStringSetting(settings, 'label') || city;
  const coordinates =
    parseCoordinates(readStringSetting(settings, 'coordinates')) ??
    zoneCoordinates(zone);
  return { zone, city, label, coordinates };
}

function Relation({
  now,
  zone,
  city,
  displayZone,
}: {
  now: Date;
  zone: string;
  city: string;
  displayZone: string;
}) {
  const relation = describeOffset(now, zone, displayZone);
  return <small>{relation ? `${city} · ${relation}` : city}</small>;
}

function DigitalView(props: PluginViewProps) {
  const { now, timeZone: displayZone } = props;
  const { zone, city, label } = useClockSettings(props);

  return (
    <div className="plugin-view clock-plugin clock-digital">
      <span className="plugin-label">{label}</span>
      <time>{formatTime(now, zone)}</time>
      <Relation now={now} zone={zone} city={city} displayZone={displayZone} />
    </div>
  );
}

function AnalogView(props: PluginViewProps) {
  const { now, timeZone: displayZone } = props;
  const { zone, city, label } = useClockSettings(props);
  const { hours, minutes } = zoneClock(now, zone);
  const minuteAngle = minutes * 6;
  const hourAngle = (hours % 12) * 30 + minutes / 2;
  const ticks = Array.from({ length: 12 }, (_, index) => index * 30);

  return (
    <div className="plugin-view clock-plugin clock-analog">
      <span className="plugin-label">{label}</span>
      <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
        <circle className="clock-face" cx="50" cy="50" r="46" />
        {ticks.map((angle) => (
          <line
            key={angle}
            className={
              angle % 90 === 0 ? 'clock-tick is-quarter' : 'clock-tick'
            }
            x1="50"
            y1="6"
            x2="50"
            y2={angle % 90 === 0 ? '12' : '9.5'}
            transform={`rotate(${angle} 50 50)`}
          />
        ))}
        <line
          className="clock-hand is-hour"
          x1="50"
          y1="54"
          x2="50"
          y2="26"
          transform={`rotate(${hourAngle} 50 50)`}
        />
        <line
          className="clock-hand is-minute"
          x1="50"
          y1="56"
          x2="50"
          y2="14"
          transform={`rotate(${minuteAngle} 50 50)`}
        />
        <circle className="clock-centre" cx="50" cy="50" r="2.2" />
      </svg>
      <span className="sr-only">{formatTime(now, zone)}</span>
      <Relation now={now} zone={zone} city={city} displayZone={displayZone} />
    </div>
  );
}

// The land mask as one path of small circles, built once per module load.
const MAP_WIDTH = 192;
const MAP_HEIGHT = 96;
const landPath = (() => {
  const cellW = MAP_WIDTH / land.cols;
  const cellH = MAP_HEIGHT / land.rows;
  const r = Math.min(cellW, cellH) * 0.34;
  const parts: string[] = [];
  land.grid.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col += 1) {
      if (row[col] !== '#') continue;
      const cx = (col + 0.5) * cellW;
      const cy = (rowIndex + 0.5) * cellH;
      parts.push(
        `M${(cx - r).toFixed(2)} ${cy.toFixed(2)}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`,
      );
    }
  });
  return parts.join('');
})();

function MapView(props: PluginViewProps) {
  const { now, timeZone: displayZone } = props;
  const { zone, city, label, coordinates } = useClockSettings(props);
  const marker = coordinates
    ? project(coordinates, MAP_WIDTH, MAP_HEIGHT)
    : undefined;

  return (
    <div className="plugin-view clock-plugin clock-map">
      <span className="plugin-label">{label}</span>
      <svg
        className="clock-map-svg"
        viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
        preserveAspectRatio="xMinYMid meet"
        aria-hidden="true"
        focusable="false"
      >
        <path className="clock-land" d={landPath} />
        {marker && (
          <g
            className="clock-marker"
            transform={`translate(${marker.x.toFixed(2)} ${marker.y.toFixed(2)})`}
          >
            <circle className="clock-marker-halo" r="5" />
            <circle className="clock-marker-dot" r="1.6" />
          </g>
        )}
      </svg>
      <div className="clock-map-time">
        <time>{formatTime(now, zone)}</time>
        <Relation now={now} zone={zone} city={city} displayZone={displayZone} />
      </div>
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.clock',
    name: 'Clock',
    version: '0.3.0',
    description: 'The time in any city: digits, a clock face, or a world map.',
    refreshSeconds: 60,
    views: [
      { id: 'digital', name: 'Digital' },
      { id: 'analog', name: 'Analog' },
      { id: 'map', name: 'Map' },
    ],
    settings: [
      {
        id: 'city',
        label: 'City',
        type: 'city',
        placeholder: 'Search for a city',
      },
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Defaults to the city name',
      },
    ],
    defaultSize: { span: 4, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
  },
  icon: Clock3,
  views: { digital: DigitalView, analog: AnalogView, map: MapView },
});
