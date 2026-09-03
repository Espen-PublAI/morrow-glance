import { isAllowedSourceUrl, readBodyWithLimit } from '@/lib/morrow/sources';
import type { PluginServerContext } from '@/lib/morrow/types';

import type { CalendarData } from './events';
import { eventsFromIcs } from './ics';

/**
 * A calendar published from Outlook as an ICS link. No app registration: the
 * user publishes the calendar in Outlook (Settings → Calendar → Shared
 * calendars → Publish) and pastes the ICS address into the block's secret.
 */

/** Published calendars can be large; allow a megabyte. */
const MAX_ICS_BYTES = 1024 * 1024;
const TIMEOUT_MS = 10_000;

export async function fetchPublishedCalendar(
  url: string,
  timeZone: string,
  showDetails: boolean,
  context: PluginServerContext,
): Promise<CalendarData> {
  const normalised = url.trim().replace(/^webcal:\/\//i, 'https://');
  if (!isAllowedSourceUrl(normalised)) {
    throw new Error('The calendar link must be a public https address.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(normalised, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1',
        'user-agent':
          'Morrow Glance (+https://github.com/Espen-PublAI/morrow-glance)',
      },
    });
    if (!response.ok)
      throw new Error(`The calendar link answered ${response.status}.`);
    const text = await readBodyWithLimit(response, MAX_ICS_BYTES);
    if (!/BEGIN:VCALENDAR/i.test(text))
      throw new Error('The link did not return a calendar (.ics).');
    const from = context.now.getTime() - 24 * 60 * 60 * 1000;
    const to = context.now.getTime() + 2 * 24 * 60 * 60 * 1000;
    return {
      calendar: 'published',
      timeZone,
      fetchedAt: context.now.toISOString(),
      events: eventsFromIcs(text, timeZone, from, to, showDetails),
    };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new Error('The calendar link did not answer within 10 seconds.');
    }
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}
