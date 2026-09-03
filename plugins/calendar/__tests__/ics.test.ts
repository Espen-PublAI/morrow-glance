import { describe, expect, it } from 'vitest';

import { eventsFromIcs, expandRule, parseDateValue, resolveZone } from '../ics';

const zone = 'Europe/Oslo';
const day = (iso: string) => Date.parse(iso);

const ICS = `BEGIN:VCALENDAR
PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN
VERSION:2.0
BEGIN:VTIMEZONE
TZID:W. Europe Standard Time
END:VTIMEZONE
BEGIN:VEVENT
UID:single@example
DTSTART;TZID=W. Europe Standard Time:20260903T123000
DTEND;TZID=W. Europe Standard Time:20260903T133000
SUMMARY:Budget review\\, part 2
LOCATION:Room A
END:VEVENT
BEGIN:VEVENT
UID:allday@example
DTSTART;VALUE=DATE:20260903
DTEND;VALUE=DATE:20260904
SUMMARY:Public holiday
X-MICROSOFT-CDO-ALLDAYEVENT:TRUE
END:VEVENT
BEGIN:VEVENT
UID:standup@example
DTSTART;TZID=W. Europe Standard Time:20260831T090000
DTEND;TZID=W. Europe Standard Time:20260831T091500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231T000000Z
EXDATE;TZID=W. Europe Standard Time:20260904T090000
SUMMARY:Standup
BEGIN:VALARM
TRIGGER:-PT10M
SUMMARY:ignored alarm summary
END:VALARM
END:VEVENT
BEGIN:VEVENT
UID:standup@example
RECURRENCE-ID;TZID=W. Europe Standard Time:20260903T090000
DTSTART;TZID=W. Europe Standard Time:20260903T100000
DTEND;TZID=W. Europe Standard Time:20260903T101500
SUMMARY:Standup (moved)
END:VEVENT
BEGIN:VEVENT
UID:cancelled@example
DTSTART:20260903T150000Z
DTEND:20260903T160000Z
STATUS:CANCELLED
SUMMARY:Cancelled thing
END:VEVENT
BEGIN:VEVENT
UID:private@example
DTSTART:20260903T170000Z
DTEND:20260903T173000Z
CLASS:PRIVATE
SUMMARY:Doctor
LOCATION:Clinic
END:VEVENT
END:VCALENDAR
`;

describe('resolveZone and parseDateValue', () => {
  it('maps Windows zone names and falls back for unknown ones', () => {
    expect(resolveZone('W. Europe Standard Time', 'UTC')).toBe('Europe/Berlin');
    expect(resolveZone('Europe/Oslo', 'UTC')).toBe('Europe/Oslo');
    expect(resolveZone('Nowhere Standard Time', 'Europe/Oslo')).toBe(
      'Europe/Oslo',
    );
  });

  it('parses UTC, zoned, and date-only values', () => {
    expect(parseDateValue('20260903T150000Z', {}, zone)?.time).toBe(
      day('2026-09-03T15:00:00.000Z'),
    );
    expect(
      parseDateValue(
        '20260903T123000',
        { TZID: 'W. Europe Standard Time' },
        zone,
      )?.time,
    ).toBe(day('2026-09-03T10:30:00.000Z'));
    expect(parseDateValue('20260903', { VALUE: 'DATE' }, zone)).toEqual({
      time: day('2026-09-02T22:00:00.000Z'),
      allDay: true,
    });
  });
});

describe('expandRule', () => {
  it('expands weekly rules on chosen weekdays with exceptions and until', () => {
    const start = day('2026-08-31T07:00:00.000Z'); // Mon 09:00 Oslo
    const starts = expandRule(
      'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20261231T000000Z',
      start,
      day('2026-09-02T22:00:00.000Z'),
      day('2026-09-06T22:00:00.000Z'),
      zone,
      [day('2026-09-04T07:00:00.000Z')],
    );
    expect(starts.map((t) => new Date(t).toISOString())).toEqual([
      '2026-09-03T07:00:00.000Z', // Thu
      // Fri excluded by EXDATE; Sat/Sun not in BYDAY
    ]);
  });

  it('honours COUNT and monthly ordinal weekdays', () => {
    const start = day('2026-09-01T07:00:00.000Z');
    expect(
      expandRule(
        'FREQ=DAILY;COUNT=3',
        start,
        0,
        day('2027-01-01T00:00:00.000Z'),
        zone,
      ).length,
    ).toBe(3);
    // First Monday of each month at 09:00 Oslo: Sep 7 and Oct 5 2026.
    const monthly = expandRule(
      'FREQ=MONTHLY;BYDAY=1MO',
      start,
      start,
      day('2026-10-31T00:00:00.000Z'),
      zone,
    );
    expect(monthly.map((t) => new Date(t).toISOString())).toEqual([
      '2026-09-07T07:00:00.000Z',
      '2026-10-05T07:00:00.000Z',
    ]);
  });
});

describe('eventsFromIcs', () => {
  const from = day('2026-09-02T22:00:00.000Z');
  const to = day('2026-09-04T22:00:00.000Z');

  it('reads singles, all-day, recurring with overrides, cancellations, and privacy', () => {
    const events = eventsFromIcs(ICS, zone, from, to, true);
    const byId = Object.fromEntries(events.map((e) => [e.id, e]));
    expect(byId['single@example']).toMatchObject({
      subject: 'Budget review, part 2',
      location: 'Room A',
      start: '2026-09-03T10:30:00.000Z',
      end: '2026-09-03T11:30:00.000Z',
      allDay: false,
    });
    expect(byId['allday@example']).toMatchObject({
      allDay: true,
      subject: 'Public holiday',
    });
    // Thursday's standup is the moved override; Friday's is excluded.
    const standups = events.filter((e) => e.id.startsWith('standup@example'));
    expect(standups.map((e) => [e.subject, e.start])).toEqual([
      ['Standup (moved)', '2026-09-03T08:00:00.000Z'],
    ]);
    expect(byId['cancelled@example']?.cancelled).toBe(true);
    expect(byId['private@example']).toMatchObject({
      subject: '',
      location: '',
    });
  });

  it('redacts everything when details are hidden', () => {
    const events = eventsFromIcs(ICS, zone, from, to, false);
    expect(events.every((e) => e.subject === '' && e.location === '')).toBe(
      true,
    );
    expect(events.length).toBeGreaterThan(0);
  });
});
