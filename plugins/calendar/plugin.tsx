import { CalendarDays } from 'lucide-react';

import { readBooleanSetting, readStringSetting } from '@/lib/morrow/settings';
import { definePlugin, type PluginViewProps } from '@/lib/morrow/types';

import {
  eventsToday,
  formatClock,
  isCalendarData,
  nextEvent,
  roomStatus,
  type CalendarEvent,
} from './events';

import './plugin.css';

/**
 * Microsoft 365 calendar: a meeting room, shared mailbox, or person. Data is
 * fetched by `server.ts` through Microsoft Graph with application permissions.
 */

function usePlace({ settings, timeZone: displayZone }: PluginViewProps) {
  const calendar = readStringSetting(settings, 'calendar');
  const label =
    readStringSetting(settings, 'label') ||
    calendar.split('@')[0] ||
    'Calendar';
  const zone = readStringSetting(settings, 'timeZone') || displayZone;
  const showDetails = readBooleanSetting(settings, 'showDetails', true);
  return { calendar, label, zone, showDetails };
}

function Empty({
  label,
  calendar,
  error,
}: {
  label: string;
  calendar: string;
  error?: string | null;
}) {
  return (
    <div className="plugin-view calendar-plugin">
      <span className="plugin-label">{label}</span>
      <span className="calendar-state">
        {!calendar
          ? 'Enter a calendar address in the block settings'
          : error
            ? `Calendar unavailable · ${error}`
            : 'Waiting for calendar'}
      </span>
    </div>
  );
}

function EventRow({
  event,
  zone,
  current,
}: {
  event: CalendarEvent;
  zone: string;
  current: boolean;
}) {
  return (
    <li className={current ? 'is-current' : undefined}>
      <span className="calendar-time">
        {event.allDay
          ? 'All day'
          : `${formatClock(event.start, zone)}–${formatClock(event.end, zone)}`}
      </span>
      <span className="calendar-subject">
        <strong>{event.subject || 'Reserved'}</strong>
        {event.location && <small>{event.location}</small>}
      </span>
    </li>
  );
}

function RoomView(props: PluginViewProps) {
  const { now, data } = props;
  const { calendar, label, zone } = usePlace(props);
  if (!data || !isCalendarData(data.data))
    return <Empty label={label} calendar={calendar} error={data?.error} />;
  const status = roomStatus(data.data.events, now, zone);
  const upcoming = nextEvent(data.data.events, now);

  return (
    <div
      className={
        status.busy
          ? 'plugin-view calendar-plugin calendar-room is-busy'
          : 'plugin-view calendar-plugin calendar-room'
      }
    >
      <span className="plugin-label">{label}</span>
      <div className="calendar-status">
        <strong>{status.headline}</strong>
        <span>{status.detail}</span>
      </div>
      <span className="plugin-meta">
        {upcoming && !status.busy
          ? `Next · ${formatClock(upcoming.start, zone)} ${upcoming.subject || 'Reserved'}`
          : upcoming && status.busy
            ? `Then · ${formatClock(upcoming.start, zone)} ${upcoming.subject || 'Reserved'}`
            : 'Microsoft 365'}
        {data.error ? ` · ${data.error}` : ''}
      </span>
    </div>
  );
}

function TodayView(props: PluginViewProps) {
  const { now, data } = props;
  const { calendar, label, zone } = usePlace(props);
  if (!data || !isCalendarData(data.data))
    return <Empty label={label} calendar={calendar} error={data?.error} />;
  const events = eventsToday(data.data.events, now, zone);
  const t = now.getTime();

  return (
    <div className="plugin-view calendar-plugin calendar-today">
      <span className="plugin-label">{label}</span>
      {events.length === 0 ? (
        <span className="calendar-state">Nothing scheduled today</span>
      ) : (
        <ol className="calendar-events">
          {events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              zone={zone}
              current={
                !event.allDay &&
                Date.parse(event.start) <= t &&
                Date.parse(event.end) > t
              }
            />
          ))}
        </ol>
      )}
      <span className="plugin-meta">
        {calendar} · Microsoft 365{data.error ? ` · ${data.error}` : ''}
      </span>
    </div>
  );
}

export const plugin = definePlugin({
  manifest: {
    id: 'morrow.calendar',
    name: 'Calendar',
    version: '0.1.0',
    description: 'A Microsoft 365 calendar: room sign or the day at a glance.',
    refreshSeconds: 300,
    views: [
      { id: 'room', name: 'Room sign' },
      { id: 'today', name: 'Today' },
    ],
    settings: [
      {
        id: 'calendar',
        label: 'Calendar address',
        type: 'text',
        placeholder: 'room-a@example.org',
      },
      {
        id: 'label',
        label: 'Label',
        type: 'text',
        placeholder: 'Defaults to the mailbox name',
      },
      {
        id: 'showDetails',
        label: 'Show meeting titles and locations',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    defaultSize: { span: 4, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
    serverFetch: true,
  },
  icon: CalendarDays,
  views: { room: RoomView, today: TodayView },
});
