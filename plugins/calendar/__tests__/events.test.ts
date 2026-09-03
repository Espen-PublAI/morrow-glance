import { describe, expect, it } from 'vitest';

import {
  currentEvent,
  eventsToday,
  nextEvent,
  roomStatus,
  type CalendarEvent,
} from '../events';
import { normaliseEvents } from '../graph';

const zone = 'Europe/Oslo';
const ev = (
  id: string,
  start: string,
  end: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id,
  subject: `Meeting ${id}`,
  start,
  end,
  allDay: false,
  location: '',
  cancelled: false,
  ...extra,
});

// 2026-09-03 in Oslo is UTC+2.
const events = [
  ev('a', '2026-09-03T07:00:00.000Z', '2026-09-03T08:00:00.000Z'), // 09:00–10:00
  ev('b', '2026-09-03T10:30:00.000Z', '2026-09-03T11:30:00.000Z'), // 12:30–13:30
  ev('c', '2026-09-03T11:30:00.000Z', '2026-09-03T12:00:00.000Z', {
    cancelled: true,
  }),
  ev('d', '2026-09-04T07:00:00.000Z', '2026-09-04T08:00:00.000Z'), // tomorrow
  ev('e', '2026-09-02T22:00:00.000Z', '2026-09-03T22:00:00.000Z', {
    allDay: true,
    subject: 'Holiday',
  }),
];

describe('room status', () => {
  it('reports free until the next meeting with minutes when close', () => {
    const at = new Date('2026-09-03T10:00:00.000Z'); // 12:00 Oslo
    expect(currentEvent(events, at)).toBeUndefined();
    expect(nextEvent(events, at)?.id).toBe('b');
    expect(roomStatus(events, at, zone)).toEqual({
      busy: false,
      headline: 'Free until 12:30',
      detail: '30 min · Meeting b',
    });
  });

  it('reports busy during a meeting and ignores cancelled ones', () => {
    const at = new Date('2026-09-03T11:00:00.000Z'); // 13:00 Oslo
    expect(roomStatus(events, at, zone)).toMatchObject({
      busy: true,
      headline: 'Busy until 13:30',
    });
    const later = new Date('2026-09-03T11:45:00.000Z'); // cancelled c would be now
    expect(roomStatus(events, later, zone).busy).toBe(false);
  });

  it('is free for the rest of the day after the last meeting', () => {
    const at = new Date('2026-09-03T15:00:00.000Z');
    expect(roomStatus(events, at, zone)).toEqual({
      busy: false,
      headline: 'Free',
      detail: 'No more meetings today',
    });
  });

  it('uses Reserved when subjects are hidden', () => {
    const hidden = events.map((e) => ({ ...e, subject: '' }));
    expect(
      roomStatus(hidden, new Date('2026-09-03T11:00:00.000Z'), zone).detail,
    ).toBe('Reserved');
  });
});

describe('eventsToday', () => {
  it('lists the local day only, all-day first, without cancelled events', () => {
    const at = new Date('2026-09-03T06:00:00.000Z');
    expect(eventsToday(events, at, zone).map((e) => e.id)).toEqual([
      'e',
      'a',
      'b',
    ]);
  });
});

describe('normaliseEvents', () => {
  const raw = [
    {
      id: 'x',
      subject: 'Budget review',
      start: {
        dateTime: '2026-09-03T12:30:00.0000000',
        timeZone: 'Europe/Oslo',
      },
      end: { dateTime: '2026-09-03T13:30:00.0000000', timeZone: 'Europe/Oslo' },
      location: { displayName: 'Room A' },
    },
    {
      id: 'y',
      subject: 'Doctor',
      sensitivity: 'private',
      start: {
        dateTime: '2026-09-03T14:00:00.0000000',
        timeZone: 'Europe/Oslo',
      },
      end: { dateTime: '2026-09-03T15:00:00.0000000', timeZone: 'Europe/Oslo' },
    },
  ];

  it('converts Graph wall-clock times to instants and keeps details when allowed', () => {
    const [x] = normaliseEvents(raw, zone, true);
    expect(x?.start).toBe('2026-09-03T10:30:00.000Z');
    expect(x?.end).toBe('2026-09-03T11:30:00.000Z');
    expect(x?.subject).toBe('Budget review');
    expect(x?.location).toBe('Room A');
  });

  it('strips subjects and locations when details are hidden or the event is private', () => {
    const [x, y] = normaliseEvents(raw, zone, false);
    expect(x?.subject).toBe('');
    expect(x?.location).toBe('');
    const [, yShown] = normaliseEvents(raw, zone, true);
    expect(yShown?.subject).toBe('');
    expect(y?.id).toBe('y');
  });
});
