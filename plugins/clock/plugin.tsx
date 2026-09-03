import { Clock3 } from 'lucide-react';

import {
  describeOffset,
  formatTime,
  timeZoneCity,
  zoneClock,
} from '@/lib/morrow/format';
import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import './plugin.css';

/**
 * A world clock. The `timeZone` setting picks a city (any IANA zone); the view
 * shows that city's time and, when it differs from the display's own zone, the
 * offset and whether it is already tomorrow there.
 */

function useClockSettings({
  settings,
  timeZone: displayZone,
}: PluginViewProps) {
  const zone = readStringSetting(settings, 'timeZone') || displayZone;
  const label = readStringSetting(settings, 'label') || timeZoneCity(zone);
  return { zone, label };
}

function Relation({
  now,
  zone,
  displayZone,
}: {
  now: Date;
  zone: string;
  displayZone: string;
}) {
  const relation = describeOffset(now, zone, displayZone);
  return <small>{relation || timeZoneCity(zone)}</small>;
}

function DigitalView(props: PluginViewProps) {
  const { now, timeZone: displayZone } = props;
  const { zone, label } = useClockSettings(props);

  return (
    <div className="plugin-view clock-plugin clock-digital">
      <span className="plugin-label">{label}</span>
      <time>{formatTime(now, zone)}</time>
      <Relation now={now} zone={zone} displayZone={displayZone} />
    </div>
  );
}

function AnalogView(props: PluginViewProps) {
  const { now, timeZone: displayZone } = props;
  const { zone, label } = useClockSettings(props);
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
      <Relation now={now} zone={zone} displayZone={displayZone} />
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.clock',
    name: 'Clock',
    version: '0.2.0',
    description: 'The time in any city, as digits or a clock face.',
    refreshSeconds: 60,
    views: [
      { id: 'digital', name: 'Digital' },
      { id: 'analog', name: 'Analog' },
    ],
    settings: [
      {
        id: 'timeZone',
        label: 'City or timezone',
        type: 'timezone',
        placeholder: 'Tokyo',
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
  views: { digital: DigitalView, analog: AnalogView },
});
