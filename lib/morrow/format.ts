/** Locale-stable time and date formatting shared by Player and Render API. */

export function formatTime(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '--:--';
  }
}

export function formatDate(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  } catch {
    return '';
  }
}

/** `Europe/Oslo` → `Europe/Oslo`, `America/New_York` → `America/New York`. */
export function humanizeTimeZone(timeZone: string): string {
  return timeZone.replaceAll('_', ' ');
}

/** `Europe/Oslo` → `Oslo`, `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
export function timeZoneCity(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return humanizeTimeZone(last);
}

/** Minutes east of UTC for a zone at a given instant (west is negative). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** Hours and minutes in a zone, for drawing clock faces. */
export function zoneClock(
  date: Date,
  timeZone: string,
): { hours: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const read = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { hours: read('hour') % 24, minutes: read('minute') };
}

/**
 * How `timeZone` relates to `baseZone` right now: `+8h`, `−5:30`, and
 * `tomorrow` or `yesterday` when the calendar date differs. Empty when equal.
 */
export function describeOffset(
  date: Date,
  timeZone: string,
  baseZone: string,
): string {
  let difference: number;
  try {
    difference =
      zoneOffsetMinutes(date, timeZone) - zoneOffsetMinutes(date, baseZone);
  } catch {
    return '';
  }
  if (difference === 0) return '';
  const sign = difference > 0 ? '+' : '−';
  const total = Math.abs(difference);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const offset =
    minutes === 0
      ? `${sign}${hours}h`
      : `${sign}${hours}:${String(minutes).padStart(2, '0')}`;
  const day = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      dateStyle: 'short',
    }).format(date);
  const there = day(timeZone);
  const here = day(baseZone);
  if (there > here) return `${offset} · tomorrow`;
  if (there < here) return `${offset} · yesterday`;
  return offset;
}
