import type { CalendarEvent } from './events';

/**
 * A small iCalendar reader for published Outlook calendars. Handles the shapes
 * Outlook actually emits: folded lines, DATE and DATE-TIME values with Windows
 * or IANA time zone ids, all-day events, cancellations, private events, and
 * recurring events (RRULE with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY,
 * EXDATE, and RECURRENCE-ID overrides), expanded within a window.
 */

/** Windows time zone names Outlook writes, mapped to IANA zones. */
export const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'FLE Standard Time': 'Europe/Kiev',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'GTB Standard Time': 'Europe/Bucharest',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  UTC: 'UTC',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Atlantic Standard Time': 'America/Halifax',
  'SA Pacific Standard Time': 'America/Bogota',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Arabian Standard Time': 'Asia/Dubai',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
};

export function resolveZone(
  tzid: string | undefined,
  fallback: string,
): string {
  if (!tzid) return fallback;
  const cleaned = tzid.replace(/^"|"$/g, '');
  if (WINDOWS_ZONES[cleaned]) return WINDOWS_ZONES[cleaned];
  try {
    new Intl.DateTimeFormat('en', { timeZone: cleaned });
    return cleaned;
  } catch {
    return fallback;
  }
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  uid: string;
  summary: string;
  location: string;
  start: number;
  end: number;
  allDay: boolean;
  cancelled: boolean;
  isPrivate: boolean;
  rrule?: string;
  exdates: number[];
  recurrenceId?: number;
  duration: number;
}

/** Unfold continuation lines (RFC 5545 §3.1). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.length > 0);
}

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name = '', ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, ' ')
    .replace(/\\([,;\\])/g, '$1')
    .trim();
}

/** Wall-clock components in a zone → instant. */
function zonedToInstant(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  timeZone: string,
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offsetAt = (at: number) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(at));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    return (
      Date.UTC(
        get('year'),
        get('month') - 1,
        get('day'),
        get('hour') % 24,
        get('minute'),
        get('second'),
      ) - at
    );
  };
  let instant = guess - offsetAt(guess);
  instant = guess - offsetAt(instant);
  return instant;
}

/** Parse a DATE or DATE-TIME value into an instant plus whether it was a bare date. */
export function parseDateValue(
  value: string,
  params: Record<string, string>,
  fallbackZone: string,
): { time: number; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  const Y = Number(y),
    M = Number(mo),
    D = Number(d);
  if (h === undefined || params.VALUE === 'DATE') {
    // All-day: midnight in the calendar's zone.
    return {
      time: zonedToInstant(
        Y,
        M,
        D,
        0,
        0,
        0,
        resolveZone(params.TZID, fallbackZone),
      ),
      allDay: true,
    };
  }
  const H = Number(h),
    MI = Number(mi),
    S = Number(s ?? '0');
  if (z) return { time: Date.UTC(Y, M - 1, D, H, MI, S), allDay: false };
  return {
    time: zonedToInstant(
      Y,
      M,
      D,
      H,
      MI,
      S,
      resolveZone(params.TZID, fallbackZone),
    ),
    allDay: false,
  };
}

function parseDuration(value: string): number {
  const m =
    /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const total =
    (Number(w ?? 0) * 7 + Number(d ?? 0)) * 86_400_000 +
    Number(h ?? 0) * 3_600_000 +
    Number(mi ?? 0) * 60_000 +
    Number(s ?? 0) * 1000;
  return sign ? -total : total;
}

function parseEvents(text: string, fallbackZone: string): RawEvent[] {
  const events: RawEvent[] = [];
  let current: (Partial<RawEvent> & { exdates: number[] }) | null = null;
  let depth = 0; // ignore nested VALARM etc.
  for (const line of unfold(text)) {
    const prop = parseProperty(line);
    if (!prop) continue;
    if (prop.name === 'BEGIN') {
      if (prop.value === 'VEVENT')
        current = {
          exdates: [],
          summary: '',
          location: '',
          cancelled: false,
          isPrivate: false,
          allDay: false,
        };
      else if (current) depth += 1;
      continue;
    }
    if (prop.name === 'END') {
      if (prop.value === 'VEVENT' && current) {
        if (current.start !== undefined) {
          const end =
            current.end ??
            (current.duration
              ? current.start + current.duration
              : current.start + (current.allDay ? 86_400_000 : 0));
          events.push({
            uid: current.uid ?? `${current.start}`,
            summary: current.summary ?? '',
            location: current.location ?? '',
            start: current.start,
            end,
            allDay: Boolean(current.allDay),
            cancelled: Boolean(current.cancelled),
            isPrivate: Boolean(current.isPrivate),
            rrule: current.rrule,
            exdates: current.exdates,
            recurrenceId: current.recurrenceId,
            duration: end - current.start,
          });
        }
        current = null;
      } else if (current && depth > 0) depth -= 1;
      continue;
    }
    if (!current || depth > 0) continue;
    switch (prop.name) {
      case 'UID':
        current.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        current.summary = unescapeText(prop.value);
        break;
      case 'LOCATION':
        current.location = unescapeText(prop.value);
        break;
      case 'DTSTART': {
        const parsed = parseDateValue(prop.value, prop.params, fallbackZone);
        if (parsed) {
          current.start = parsed.time;
          current.allDay = parsed.allDay;
        }
        break;
      }
      case 'DTEND': {
        const parsed = parseDateValue(prop.value, prop.params, fallbackZone);
        if (parsed) current.end = parsed.time;
        break;
      }
      case 'DURATION':
        current.duration = parseDuration(prop.value);
        break;
      case 'RRULE':
        current.rrule = prop.value.trim();
        break;
      case 'EXDATE':
        for (const part of prop.value.split(',')) {
          const parsed = parseDateValue(part, prop.params, fallbackZone);
          if (parsed) current.exdates.push(parsed.time);
        }
        break;
      case 'RECURRENCE-ID': {
        const parsed = parseDateValue(prop.value, prop.params, fallbackZone);
        if (parsed) current.recurrenceId = parsed.time;
        break;
      }
      case 'STATUS':
        current.cancelled = prop.value.trim().toUpperCase() === 'CANCELLED';
        break;
      case 'CLASS':
        current.isPrivate = prop.value.trim().toUpperCase() === 'PRIVATE';
        break;
      case 'X-MICROSOFT-CDO-ALLDAYEVENT':
        if (prop.value.trim().toUpperCase() === 'TRUE') current.allDay = true;
        break;
      default:
        break;
    }
  }
  return events;
}

const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  count?: number;
  until?: number;
  byDay?: Array<{ ordinal: number; day: number }>;
  byMonthDay?: number[];
}

function parseRule(text: string, fallbackZone: string): Rule | null {
  const parts = Object.fromEntries(
    text.split(';').map((part) => {
      const [k = '', v = ''] = part.split('=');
      return [k.toUpperCase(), v];
    }),
  );
  const freq = parts.FREQ as Rule['freq'] | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq))
    return null;
  const rule: Rule = {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1)),
  };
  if (parts.COUNT) rule.count = Number(parts.COUNT);
  if (parts.UNTIL)
    rule.until = parseDateValue(parts.UNTIL, {}, fallbackZone)?.time;
  if (parts.BYDAY) {
    rule.byDay = parts.BYDAY.split(',').map((token) => {
      const m = /^([+-]?\d)?([A-Z]{2})$/.exec(token.trim());
      return {
        ordinal: Number(m?.[1] ?? 0),
        day: WEEKDAYS.indexOf(m?.[2] ?? 'MO'),
      };
    });
  }
  if (parts.BYMONTHDAY)
    rule.byMonthDay = parts.BYMONTHDAY.split(',').map(Number);
  return rule;
}

/** Calendar parts of an instant in a zone, for recurrence arithmetic. */
function partsIn(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(time));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    h: Number(get('hour')) % 24,
    mi: Number(get('minute')),
    s: Number(get('second')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
      get('weekday'),
    ),
  };
}

/** Expand one recurring master into occurrence start instants within [from, to). */
export function expandRule(
  ruleText: string,
  start: number,
  from: number,
  to: number,
  timeZone: string,
  exdates: number[] = [],
): number[] {
  const rule = parseRule(ruleText, timeZone);
  if (!rule) return [];
  const base = partsIn(start, timeZone);
  const excluded = new Set(exdates);
  const results: number[] = [];
  const limit = rule.until ?? Number.POSITIVE_INFINITY;
  let produced = 0;
  const maxCount = rule.count ?? Number.POSITIVE_INFINITY;

  const emit = (time: number): boolean => {
    if (time > limit || produced >= maxCount) return false;
    produced += 1;
    if (time >= from && time < to && !excluded.has(time)) results.push(time);
    return true;
  };

  const daysBetween = (a: number, b: number) =>
    Math.round((b - a) / 86_400_000);
  const firstLocal = Date.UTC(base.y, base.m - 1, base.d);
  const horizon =
    Date.UTC(
      partsIn(to, timeZone).y,
      partsIn(to, timeZone).m - 1,
      partsIn(to, timeZone).d,
    ) + 86_400_000;

  if (rule.freq === 'DAILY') {
    for (
      let day = firstLocal;
      day <= horizon;
      day += 86_400_000 * rule.interval
    ) {
      const p = new Date(day);
      if (
        !emit(
          zonedToInstant(
            p.getUTCFullYear(),
            p.getUTCMonth() + 1,
            p.getUTCDate(),
            base.h,
            base.mi,
            base.s,
            timeZone,
          ),
        )
      )
        break;
    }
  } else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.map((b) => b.day) ?? [base.weekday];
    // Walk week by week from the week containing the start.
    const startWeek = firstLocal - base.weekday * 86_400_000;
    outer: for (
      let week = startWeek;
      week <= horizon;
      week += 7 * 86_400_000 * rule.interval
    ) {
      for (const weekday of [...days].sort((a, b) => a - b)) {
        const day = week + weekday * 86_400_000;
        if (day < firstLocal) continue;
        const p = new Date(day);
        if (
          !emit(
            zonedToInstant(
              p.getUTCFullYear(),
              p.getUTCMonth() + 1,
              p.getUTCDate(),
              base.h,
              base.mi,
              base.s,
              timeZone,
            ),
          )
        )
          break outer;
      }
    }
  } else if (rule.freq === 'MONTHLY') {
    for (let k = 0; ; k += rule.interval) {
      const monthIndex = base.m - 1 + k;
      const y = base.y + Math.floor(monthIndex / 12);
      const m = (monthIndex % 12) + 1;
      if (Date.UTC(y, m - 1, 1) > horizon) break;
      const candidates: number[] = [];
      if (rule.byDay && rule.byDay.length > 0) {
        for (const { ordinal, day } of rule.byDay) {
          const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
          const matching: number[] = [];
          for (let d = 1; d <= daysInMonth; d += 1) {
            if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === day)
              matching.push(d);
          }
          const pick =
            ordinal === 0
              ? matching
              : ordinal > 0
                ? [matching[ordinal - 1]]
                : [matching[matching.length + ordinal]];
          for (const d of pick) if (d) candidates.push(d);
        }
      } else if (rule.byMonthDay) {
        candidates.push(...rule.byMonthDay);
      } else {
        candidates.push(base.d);
      }
      let stop = false;
      for (const d of [...new Set(candidates)].sort((a, b) => a - b)) {
        const time = zonedToInstant(y, m, d, base.h, base.mi, base.s, timeZone);
        if (time < start) continue;
        if (!emit(time)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
  } else {
    for (let y = base.y; Date.UTC(y, 0, 1) <= horizon; y += rule.interval) {
      const time = zonedToInstant(
        y,
        base.m,
        base.d,
        base.h,
        base.mi,
        base.s,
        timeZone,
      );
      if (!emit(time)) break;
    }
  }
  void daysBetween;
  return results;
}

/**
 * All events, with recurring ones expanded into occurrences inside [from, to),
 * overrides applied, and details redacted when asked.
 */
export function eventsFromIcs(
  text: string,
  fallbackZone: string,
  from: number,
  to: number,
  showDetails: boolean,
): CalendarEvent[] {
  const raw = parseEvents(text, fallbackZone);
  const overrides = new Map<string, RawEvent>();
  for (const event of raw) {
    if (event.recurrenceId !== undefined)
      overrides.set(`${event.uid}@${event.recurrenceId}`, event);
  }

  const out: CalendarEvent[] = [];
  const push = (source: RawEvent, start: number, end: number, key: string) => {
    const hidden = !showDetails || source.isPrivate;
    out.push({
      id: key,
      subject: hidden ? '' : source.summary,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      allDay: source.allDay,
      location: hidden ? '' : source.location,
      cancelled: source.cancelled,
    });
  };

  for (const event of raw) {
    if (event.recurrenceId !== undefined) continue; // handled via overrides
    if (!event.rrule) {
      if (event.end > from && event.start < to)
        push(event, event.start, event.end, event.uid);
      continue;
    }
    const starts = expandRule(
      event.rrule,
      event.start,
      from - event.duration,
      to,
      fallbackZone,
      event.exdates,
    );
    for (const start of starts) {
      const override = overrides.get(`${event.uid}@${start}`);
      if (override) {
        if (override.end > from && override.start < to)
          push(override, override.start, override.end, `${event.uid}@${start}`);
        continue;
      }
      const end = start + event.duration;
      if (end > from && start < to)
        push(event, start, end, `${event.uid}@${start}`);
    }
  }
  // Overrides whose master occurrence fell outside the window but which moved inside it.
  for (const [key, override] of overrides) {
    if (out.some((e) => e.id === key)) continue;
    if (override.end > from && override.start < to)
      push(override, override.start, override.end, key);
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}
