import type { PluginServerContext } from '@/lib/morrow/types';

import type { CalendarData, CalendarEvent } from './events';

/**
 * Microsoft Graph with application permissions (client credentials). An IT
 * admin registers Morrow once in Entra ID and grants `Calendars.Read` as an
 * application permission; then any block can read a room, shared mailbox, or
 * user calendar by address. Credentials come from the server environment only.
 */

export const GRAPH_ENV = {
  tenant: 'MORROW_MS_TENANT_ID',
  clientId: 'MORROW_MS_CLIENT_ID',
  clientSecret: 'MORROW_MS_CLIENT_SECRET',
} as const;

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 8_000;

interface TokenCache {
  token: string;
  expiresAt: number;
}
let cached: TokenCache | null = null;

function missingCredentials(env: PluginServerContext['env']): string[] {
  return Object.values(GRAPH_ENV).filter((name) => !env[name]?.trim());
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** Client-credentials token, cached per isolate until a minute before expiry. */
export async function graphToken(
  env: PluginServerContext['env'],
): Promise<string> {
  const missing = missingCredentials(env);
  if (missing.length > 0) {
    throw new Error(
      `Microsoft credentials are not configured: set ${missing.join(', ')}.`,
    );
  }
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const body = new URLSearchParams({
    client_id: env[GRAPH_ENV.clientId] ?? '',
    client_secret: env[GRAPH_ENV.clientSecret] ?? '',
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const response = await withTimeout((signal) =>
    fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(env[GRAPH_ENV.tenant] ?? '')}/oauth2/v2.0/token`,
      {
        method: 'POST',
        body,
        signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
    ),
  );
  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error(
      `Microsoft sign-in failed: ${json.error_description?.split('.')[0] ?? response.status}.`,
    );
  }
  cached = {
    token: json.access_token,
    expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.token;
}

interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  sensitivity?: string;
}

/** Graph returns wall-clock times in the requested zone; make them instants. */
function toInstant(dateTime: string, timeZone: string): string {
  const [date, time = '00:00:00'] = dateTime.split('T');
  const [y, m, d] = (date ?? '').split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map((part) => Number(part.slice(0, 2)));
  const guess = Date.UTC(
    y ?? 1970,
    (m ?? 1) - 1,
    d ?? 1,
    hh ?? 0,
    mm ?? 0,
    ss ?? 0,
  );
  // Shift by the zone's offset at that moment (two passes handle DST edges).
  const offset = (at: number) => {
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
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return asUtc - at;
  };
  let instant = guess - offset(guess);
  instant = guess - offset(instant);
  return new Date(instant).toISOString();
}

export function normaliseEvents(
  raw: GraphEvent[],
  timeZone: string,
  showDetails: boolean,
): CalendarEvent[] {
  return raw.map((event) => {
    const hidden = !showDetails || event.sensitivity === 'private';
    return {
      id: event.id,
      subject: hidden ? '' : (event.subject ?? ''),
      start: toInstant(event.start.dateTime, event.start.timeZone || timeZone),
      end: toInstant(event.end.dateTime, event.end.timeZone || timeZone),
      allDay: Boolean(event.isAllDay),
      location: hidden ? '' : (event.location?.displayName ?? ''),
      cancelled: Boolean(event.isCancelled),
    };
  });
}

/** Today and tomorrow for one calendar address, normalised for the views. */
export async function fetchCalendar(
  calendar: string,
  timeZone: string,
  showDetails: boolean,
  context: PluginServerContext,
): Promise<CalendarData> {
  const token = await graphToken(context.env);
  const startOfDay = new Date(context.now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1); // generous window; views filter by local day
  const end = new Date(startOfDay.getTime() + 3 * 24 * 60 * 60 * 1000);

  const url = new URL(
    `${GRAPH}/users/${encodeURIComponent(calendar)}/calendarView`,
  );
  url.searchParams.set('startDateTime', startOfDay.toISOString());
  url.searchParams.set('endDateTime', end.toISOString());
  url.searchParams.set(
    '$select',
    'subject,start,end,isAllDay,isCancelled,location,sensitivity',
  );
  url.searchParams.set('$orderby', 'start/dateTime');
  url.searchParams.set('$top', '50');

  const response = await withTimeout((signal) =>
    fetch(url, {
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        prefer: `outlook.timezone="${timeZone}"`,
      },
    }),
  );
  if (response.status === 404)
    throw new Error(`Calendar "${calendar}" was not found.`);
  if (response.status === 403) {
    throw new Error(
      'Access denied: grant Calendars.Read (application) to the Morrow app in Entra.',
    );
  }
  if (!response.ok)
    throw new Error(`Microsoft Graph answered ${response.status}.`);
  const json = (await response.json()) as { value?: GraphEvent[] };
  return {
    calendar,
    timeZone,
    fetchedAt: context.now.toISOString(),
    events: normaliseEvents(json.value ?? [], timeZone, showDetails),
  };
}
