import { readBooleanSetting, readStringSetting } from '@/lib/morrow/settings';
import { definePluginServer } from '@/lib/morrow/types';

import { fetchCalendar } from './graph';

/**
 * Server half of the calendar plugin. Runs only in Morrow Server, reads the
 * Microsoft credentials from the environment, and returns normalised events.
 * Subjects are dropped here when "Show details" is off, so private meeting
 * titles never reach a Player at all.
 */
export const server = definePluginServer({
  intervalSeconds: 300,
  async fetch(settings, context) {
    const calendar = readStringSetting(settings, 'calendar');
    if (!calendar)
      throw new Error(
        'Enter a calendar address, such as a meeting room mailbox.',
      );
    const timeZone =
      readStringSetting(settings, 'timeZone') || context.timeZone;
    const showDetails = readBooleanSetting(settings, 'showDetails', true);
    return fetchCalendar(calendar, timeZone, showDetails, context);
  },
});
