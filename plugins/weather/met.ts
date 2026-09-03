/**
 * Parsing for MET Norway's Locationforecast 2.0 "compact" response.
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation
 *
 * Pure functions so the views stay thin and the logic is testable with a fixture.
 */

export interface MetEntry {
  time: string;
  data: {
    instant: { details: Record<string, number> };
    next_1_hours?: {
      summary: { symbol_code: string };
      details?: Record<string, number>;
    };
    next_6_hours?: {
      summary: { symbol_code: string };
      details?: Record<string, number>;
    };
    next_12_hours?: {
      summary: { symbol_code: string };
      details?: Record<string, number>;
    };
  };
}

export interface MetForecast {
  properties?: { meta?: { updated_at?: string }; timeseries?: MetEntry[] };
}

export interface Conditions {
  time: string;
  temperature: number;
  symbol: string;
  windSpeed: number;
  precipitation: number;
}

export interface HourForecast {
  time: string;
  temperature: number;
  symbol: string;
  precipitation: number;
}

export interface DayForecast {
  /** `YYYY-MM-DD` in the location's timezone. */
  date: string;
  high: number;
  low: number;
  precipitation: number;
  symbol: string;
}

export const MET_SYMBOL_BASES = [
  'clearsky',
  'fair',
  'partlycloudy',
  'cloudy',
  'fog',
  'lightrain',
  'rain',
  'heavyrain',
  'lightrainshowers',
  'rainshowers',
  'heavyrainshowers',
  'lightsleet',
  'sleet',
  'heavysleet',
  'lightsleetshowers',
  'sleetshowers',
  'heavysleetshowers',
  'lightsnow',
  'snow',
  'heavysnow',
  'lightsnowshowers',
  'snowshowers',
  'heavysnowshowers',
  'rainandthunder',
  'heavyrainandthunder',
  'lightrainandthunder',
  'rainshowersandthunder',
  'heavyrainshowersandthunder',
  'lightrainshowersandthunder',
  'sleetandthunder',
  'snowandthunder',
  'sleetshowersandthunder',
  'snowshowersandthunder',
  'heavysleetandthunder',
  'heavysnowandthunder',
  'lightsleetandthunder',
  'lightsnowandthunder',
  'heavysleetshowersandthunder',
  'heavysnowshowersandthunder',
  'lightssleetshowersandthunder',
  'lightssnowshowersandthunder',
] as const;

export function timeseries(data: unknown): MetEntry[] {
  const series = (data as MetForecast | null)?.properties?.timeseries;
  return Array.isArray(series) ? series : [];
}

function symbolOf(entry: MetEntry): string {
  return (
    entry.data.next_1_hours?.summary.symbol_code ??
    entry.data.next_6_hours?.summary.symbol_code ??
    entry.data.next_12_hours?.summary.symbol_code ??
    'cloudy'
  );
}

function precipitationOf(entry: MetEntry): number {
  return (
    entry.data.next_1_hours?.details?.precipitation_amount ??
    entry.data.next_6_hours?.details?.precipitation_amount ??
    0
  );
}

/** Split `clearsky_night` into its base and variant. */
export function splitSymbol(code: string): { base: string; night: boolean } {
  const [base = 'cloudy', variant] = code.split('_');
  return { base, night: variant === 'night' };
}

/** The entry closest to now (the first entry not in the past, else the first). */
export function current(data: unknown, now: Date): Conditions | undefined {
  const series = timeseries(data);
  const entry =
    series.find((e) => Date.parse(e.time) >= now.getTime() - 60 * 60 * 1000) ??
    series[0];
  if (!entry) return undefined;
  const details = entry.data.instant.details;
  return {
    time: entry.time,
    temperature: details.air_temperature ?? Number.NaN,
    symbol: symbolOf(entry),
    windSpeed: details.wind_speed ?? 0,
    precipitation: precipitationOf(entry),
  };
}

/** Upcoming hourly entries, one every `stepHours`, up to `count` items. */
export function upcomingHours(
  data: unknown,
  now: Date,
  count = 6,
  stepHours = 2,
): HourForecast[] {
  const series = timeseries(data).filter(
    (e) => Date.parse(e.time) > now.getTime() && e.data.next_1_hours,
  );
  const picked: HourForecast[] = [];
  for (let i = 0; i < series.length && picked.length < count; i += stepHours) {
    const entry = series[i];
    if (!entry) break;
    picked.push({
      time: entry.time,
      temperature: entry.data.instant.details.air_temperature ?? Number.NaN,
      symbol: symbolOf(entry),
      precipitation: precipitationOf(entry),
    });
  }
  return picked;
}

function localDate(time: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      dateStyle: 'short',
    }).format(new Date(time));
  } catch {
    return time.slice(0, 10);
  }
}

function localHour(time: string, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(time)),
    );
  } catch {
    return new Date(time).getUTCHours();
  }
}

/**
 * Daily summaries in the location's timezone: high, low, total precipitation,
 * and a representative symbol taken from the entry nearest midday. Precipitation
 * uses hourly amounts where MET provides them and six-hour blocks after that.
 */
export function dailyForecast(
  data: unknown,
  timeZone: string,
  days = 7,
): DayForecast[] {
  const byDate = new Map<string, MetEntry[]>();
  for (const entry of timeseries(data)) {
    const date = localDate(entry.time, timeZone);
    const list = byDate.get(date) ?? [];
    list.push(entry);
    byDate.set(date, list);
  }

  const result: DayForecast[] = [];
  for (const [date, entries] of byDate) {
    const temps = entries
      .map((e) => e.data.instant.details.air_temperature)
      .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
    if (temps.length === 0) continue;
    let precipitation = 0;
    let coveredUntil = 0;
    for (const entry of entries) {
      const at = Date.parse(entry.time);
      if (at < coveredUntil) continue;
      if (
        entry.data.next_1_hours?.details?.precipitation_amount !== undefined
      ) {
        precipitation += entry.data.next_1_hours.details.precipitation_amount;
        coveredUntil = at + 3_600_000;
      } else if (
        entry.data.next_6_hours?.details?.precipitation_amount !== undefined
      ) {
        precipitation += entry.data.next_6_hours.details.precipitation_amount;
        coveredUntil = at + 6 * 3_600_000;
      }
    }
    const midday = entries.reduce((best, entry) =>
      Math.abs(localHour(entry.time, timeZone) - 12) <
      Math.abs(localHour(best.time, timeZone) - 12)
        ? entry
        : best,
    );
    result.push({
      date,
      high: Math.max(...temps),
      low: Math.min(...temps),
      precipitation: Math.round(precipitation * 10) / 10,
      symbol:
        (
          midday.data.next_6_hours ??
          midday.data.next_12_hours ??
          midday.data.next_1_hours
        )?.summary.symbol_code ?? symbolOf(midday),
    });
    if (result.length >= days) break;
  }
  return result;
}
