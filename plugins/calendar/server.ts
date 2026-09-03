import { readBooleanSetting, readStringSetting } from '@/lib/morrow/settings';
import { definePluginServer } from '@/lib/morrow/types';

import { fetchCalendar } from './graph';
import { fetchPublishedCalendar } from './published';

/**
 * Server half of the calendar plugin. Runs only in Morrow Server, reads the
 * Microsoft credentials from the environment, and returns normalised events.
 * Subjects are dropped here when "Show details" is off, so private meeting
 * titles never reach a Player at all.
 */
export const server = definePluginServer({
  intervalSeconds: 300,
  async fetch(settings, context) {
    const timeZone =
      readStringSetting(settings, 'timeZone') || context.timeZone;
    const showDetails = readBooleanSetting(settings, 'showDetails', true);
    const icsUrl = context.secrets.icsUrl;
    if (icsUrl)
      return fetchPublishedCalendar(icsUrl, timeZone, showDetails, context);
    const calendar = readStringSetting(settings, 'calendar');
    if (!calendar) {
      throw new Error(
        'Paste a published calendar link, or enter a mailbox address and configure Microsoft credentials.',
      );
    }
    return fetchCalendar(calendar, timeZone, showDetails, context);
  },
});
