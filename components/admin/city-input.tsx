'use client';

import { useEffect, useId, useState } from 'react';

import {
  formatCoordinates,
  loadCityIndex,
  searchCities,
  searchZones,
  type City,
} from '@/lib/morrow/geo';
import { timeZoneCity } from '@/lib/morrow/format';
import type { PluginSettings } from '@/lib/morrow/types';

/**
 * Search for a city and store it together with its timezone and coordinates.
 * Falls back to raw IANA zones for places the index does not know.
 */

const regionNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

function countryName(code: string): string {
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}

function zoneList(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return [];
  }
}

export function CityInput({
  id,
  value,
  onChange,
}: {
  id: string;
  /** The stored city name. */
  value: string;
  /** Applies several settings at once: city, timeZone, coordinates. */
  onChange: (patch: PluginSettings) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<City[] | null>(null);

  useEffect(() => {
    if (!open || index) return;
    let cancelled = false;
    loadCityIndex()
      .then((loaded) => {
        if (!cancelled) setIndex(loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, index]);

  const cities = index && open ? searchCities(index, query) : [];
  const zones = open && query.length >= 2 ? searchZones(zoneList(), query) : [];
  const zonesToShow = zones
    .filter((zone) => !cities.some((city) => city.z === zone))
    .slice(0, 3);

  const pick = (patch: PluginSettings, label: string) => {
    onChange(patch);
    setQuery(label);
    setOpen(false);
  };

  return (
    <div className="city-input">
      <input
        id={id}
        data-lpignore="true"
        value={query}
        placeholder="Search for a city"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-controls={listId}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          // Let a click on a result land before the list closes.
          window.setTimeout(() => setOpen(false), 120);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
          if (event.key === 'Enter' && cities[0]) {
            event.preventDefault();
            const city = cities[0];
            pick(
              {
                city: city.n,
                timeZone: city.z,
                coordinates: formatCoordinates({ lat: city.la, lon: city.lo }),
              },
              city.n,
            );
          }
        }}
      />
      {open &&
        (cities.length > 0 ||
          zonesToShow.length > 0 ||
          (index === null && query.length >= 2)) && (
          <ul id={listId} className="city-results">
            {index === null && query.length >= 2 && (
              <li className="city-results-note">Loading cities…</li>
            )}
            {cities.map((city) => (
              <li key={`${city.n}-${city.c}-${city.la}-${city.lo}`}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    pick(
                      {
                        city: city.n,
                        timeZone: city.z,
                        coordinates: formatCoordinates({
                          lat: city.la,
                          lon: city.lo,
                        }),
                      },
                      city.n,
                    )
                  }
                >
                  <strong>{city.n}</strong>
                  <small>
                    {countryName(city.c)} · {city.z}
                    {city.a[0] &&
                    !city.a[0].toLowerCase().includes(city.n.toLowerCase())
                      ? ` · ${city.a[0]}`
                      : ''}
                  </small>
                </button>
              </li>
            ))}
            {zonesToShow.map((zone) => (
              <li key={zone}>
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() =>
                    pick(
                      {
                        city: timeZoneCity(zone),
                        timeZone: zone,
                        coordinates: '',
                      },
                      timeZoneCity(zone),
                    )
                  }
                >
                  <strong>{timeZoneCity(zone)}</strong>
                  <small>Timezone · {zone}</small>
                </button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}
