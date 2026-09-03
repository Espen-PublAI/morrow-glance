'use client';

import { useId, useSyncExternalStore } from 'react';

const NO_ZONES: string[] = [];
let cachedZones: string[] | null = null;

function readZones(): string[] {
  if (cachedZones === null) {
    try {
      cachedZones = Intl.supportedValuesOf('timeZone');
    } catch {
      cachedZones = NO_ZONES;
    }
  }
  return cachedZones;
}

const subscribeNever = () => () => {};

/**
 * Text input with a datalist of IANA timezones known to this browser.
 *
 * The list is client-only: the server runtime and the browser ship different
 * timezone tables, so rendering it during SSR would break hydration.
 */
export function TimeZoneInput({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  /** Accessible name; the visible label is rendered by the parent. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const listId = useId();
  const zones = useSyncExternalStore(subscribeNever, readZones, () => NO_ZONES);

  return (
    <>
      <input
        data-lpignore="true"
        id={id}
        aria-label={label}
        list={zones.length > 0 ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? 'Europe/Oslo'}
        autoComplete="off"
        spellCheck={false}
      />
      {zones.length > 0 && (
        <datalist id={listId}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}
