/**
 * Calendar events as the views see them, plus the small amount of logic a
 * room sign needs: what is happening now, what comes next, and how long the
 * room is free. Pure functions; the Graph specifics live in `graph.ts`.
 */

export interface CalendarEvent {
  id: string;
  /** Empty when details are hidden. */
  subject: string;
  /** ISO instants. */
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  cancelled: boolean;
}

export interface CalendarData {
  calendar: string;
  timeZone: string;
  fetchedAt: string;
  events: CalendarEvent[];
}

export function isCalendarData(value: unknown): value is CalendarData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as CalendarData).events) &&
    typeof (value as CalendarData).timeZone === 'string'
  );
}

const ms = (iso: string) => Date.parse(iso);

/** Events that are not cancelled, sorted by start. */
export function activeEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events
    .filter((e) => !e.cancelled)
    .sort((a, b) => ms(a.start) - ms(b.start));
}

/** The timed event happening at `now`, if any (all-day events do not occupy a room). */
export function currentEvent(
  events: CalendarEvent[],
  now: Date,
): CalendarEvent | undefined {
  const t = now.getTime();
  return activeEvents(events).find(
    (e) => !e.allDay && ms(e.start) <= t && ms(e.end) > t,
  );
}

/** The first timed event starting after `now`. */
export function nextEvent(
  events: CalendarEvent[],
  now: Date,
): CalendarEvent | undefined {
  const t = now.getTime();
  return activeEvents(events).find((e) => !e.allDay && ms(e.start) > t);
}

/** Events whose local date matches `now` in the given zone, all-day ones first. */
export function eventsToday(
  events: CalendarEvent[],
  now: Date,
  timeZone: string,
): CalendarEvent[] {
  const day = localDate(now.toISOString(), timeZone);
  return activeEvents(events)
    .filter(
      (e) =>
        localDate(e.start, timeZone) === day ||
        (e.allDay &&
          localDate(e.end, timeZone) > day &&
          localDate(e.start, timeZone) <= day),
    )
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) || ms(a.start) - ms(b.start),
    );
}

export function localDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      dateStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function formatClock(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  } catch {
    return iso.slice(11, 16);
  }
}

/** "Free until 14:00", "Free for the rest of the day", or "Busy until 13:30". */
export function roomStatus(
  events: CalendarEvent[],
  now: Date,
  timeZone: string,
): { busy: boolean; headline: string; detail: string } {
  const current = currentEvent(events, now);
  if (current) {
    return {
      busy: true,
      headline: `Busy until ${formatClock(current.end, timeZone)}`,
      detail: current.subject || 'Reserved',
    };
  }
  const next = nextEvent(events, now);
  if (
    next &&
    localDate(next.start, timeZone) === localDate(now.toISOString(), timeZone)
  ) {
    const minutes = Math.round((ms(next.start) - now.getTime()) / 60_000);
    return {
      busy: false,
      headline: `Free until ${formatClock(next.start, timeZone)}`,
      detail:
        minutes < 60
          ? `${minutes} min · ${next.subject || 'Reserved'}`
          : next.subject || 'Reserved',
    };
  }
  return { busy: false, headline: 'Free', detail: 'No more meetings today' };
}
