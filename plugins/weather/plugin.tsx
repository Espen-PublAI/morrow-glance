import { CloudSun } from 'lucide-react';

import { timeZoneCity } from '@/lib/morrow/format';
import { parseCoordinates } from '@/lib/morrow/geo';
import { readStringSetting } from '@/lib/morrow/settings';
import {
  definePlugin,
  type PluginSettings,
  type PluginViewProps,
} from '@/lib/morrow/types';

import { WeatherIcon } from './icons';
import { current, dailyForecast, upcomingHours } from './met';

import './plugin.css';

/**
 * Weather forecast for any place on Earth, from MET Norway's Locationforecast
 * (the data behind Yr). Pick a city; the plugin derives its own poll source from
 * the stored coordinates and refreshes hourly while a screen shows it.
 */

const MET_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';

function source(settings: PluginSettings) {
  const coordinates = parseCoordinates(
    readStringSetting(settings, 'coordinates'),
  );
  if (!coordinates) return undefined;
  // MET asks for at most four decimals so requests can be cached.
  const lat = coordinates.lat.toFixed(4);
  const lon = coordinates.lon.toFixed(4);
  return {
    kind: 'poll' as const,
    url: `${MET_URL}?lat=${lat}&lon=${lon}`,
    intervalSeconds: 3600,
  };
}

function usePlace({ settings, timeZone: displayZone }: PluginViewProps) {
  const zone = readStringSetting(settings, 'timeZone') || displayZone;
  const city = readStringSetting(settings, 'city') || timeZoneCity(zone);
  const label = readStringSetting(settings, 'label') || city;
  const hasPlace = Boolean(
    parseCoordinates(readStringSetting(settings, 'coordinates')),
  );
  return { zone, city, label, hasPlace };
}

function degrees(value: number): string {
  return Number.isFinite(value) ? `${Math.round(value)}°` : '–';
}

function hourLabel(time: string, zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(time));
  } catch {
    return time.slice(11, 13);
  }
}

function dayLabel(date: string, index: number, zone: string): string {
  if (index === 0) return 'Today';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      weekday: 'short',
    }).format(new Date(`${date}T12:00:00Z`));
  } catch {
    return date;
  }
}

function Empty({
  label,
  hasPlace,
  error,
}: {
  label: string;
  hasPlace: boolean;
  error?: string | null;
}) {
  return (
    <div className="plugin-view weather-plugin">
      <span className="plugin-label">{label}</span>
      <span className="weather-state">
        {!hasPlace
          ? 'Pick a city in the block settings'
          : error
            ? `Forecast unavailable · ${error}`
            : 'Waiting for forecast'}
      </span>
    </div>
  );
}

function NowView(props: PluginViewProps) {
  const { now, data } = props;
  const { label, hasPlace } = usePlace(props);
  const conditions = data ? current(data.data, now) : undefined;
  if (!conditions)
    return <Empty label={label} hasPlace={hasPlace} error={data?.error} />;

  return (
    <div className="plugin-view weather-plugin weather-now">
      <span className="plugin-label">{label}</span>
      <div className="weather-now-main">
        <WeatherIcon
          code={conditions.symbol}
          className="weather-icon is-large"
        />
        <strong>{degrees(conditions.temperature)}</strong>
      </div>
      <span className="plugin-meta">
        {conditions.windSpeed.toFixed(0)} m/s
        {conditions.precipitation > 0
          ? ` · ${conditions.precipitation.toFixed(1)} mm`
          : ''}
      </span>
    </div>
  );
}

function TodayView(props: PluginViewProps) {
  const { now, data } = props;
  const { zone, label, hasPlace } = usePlace(props);
  const hours = data ? upcomingHours(data.data, now, 6, 2) : [];
  if (hours.length === 0)
    return <Empty label={label} hasPlace={hasPlace} error={data?.error} />;

  return (
    <div className="plugin-view weather-plugin weather-today">
      <span className="plugin-label">{label}</span>
      <ol className="weather-hours">
        {hours.map((hour) => (
          <li key={hour.time}>
            <span className="weather-hour">{hourLabel(hour.time, zone)}</span>
            <WeatherIcon code={hour.symbol} className="weather-icon" />
            <strong>{degrees(hour.temperature)}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

function WeekView(props: PluginViewProps) {
  const { data } = props;
  const { zone, label, hasPlace } = usePlace(props);
  const days = data ? dailyForecast(data.data, zone, 7) : [];
  if (days.length === 0)
    return <Empty label={label} hasPlace={hasPlace} error={data?.error} />;

  return (
    <div className="plugin-view weather-plugin weather-week">
      <span className="plugin-label">{label}</span>
      <ol className="weather-days">
        {days.map((day, index) => (
          <li key={day.date}>
            <span className="weather-day">
              {dayLabel(day.date, index, zone)}
            </span>
            <WeatherIcon code={day.symbol} className="weather-icon" />
            <span className="weather-rain">
              {day.precipitation > 0
                ? `${day.precipitation.toFixed(1)} mm`
                : ''}
            </span>
            <span className="weather-range">
              <strong>{degrees(day.high)}</strong>
              <span>{degrees(day.low)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.weather',
    name: 'Weather',
    version: '0.1.0',
    description:
      'Forecast for any place on Earth: now, the next hours, or the week.',
    refreshSeconds: 3600,
    views: [
      { id: 'now', name: 'Now' },
      { id: 'today', name: 'Next hours' },
      { id: 'week', name: 'Week' },
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
    source,
  },
  icon: CloudSun,
  views: { now: NowView, today: TodayView, week: WeekView },
});
