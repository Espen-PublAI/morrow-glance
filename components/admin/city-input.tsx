'use client';

import { useEffect, useId, useState } from 'react';

import { readStoredAdminToken, searchPlacesRemote } from '@/lib/morrow/client';
import { timeZoneCity } from '@/lib/morrow/format';
import {
  formatCoordinates,
  loadCityIndex,
  mergePlaces,
  placeFromCity,
  placeFromCoordinatesQuery,
  searchCities,
  searchZones,
  type City,
  type Place,
} from '@/lib/morrow/geo';
import type { PluginSettings } from '@/lib/morrow/types';

/**
 * Search for any place and store it with its timezone and coordinates.
 * Results come from three sources, in this order: the bundled index (instant,
 * large cities), the online geocoder (villages and towns, via Morrow Server),
 * and typed coordinates for spots no geocoder knows. Raw IANA zones remain a
 * fallback for time-only uses.
 */

const REMOTE_DEBOUNCE_MS = 250;

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
  displayTimeZone,
  onChange,
}: {
  id: string;
  /** The stored city name. */
  value: string;
  /** Used when typed coordinates have no zone of their own. */
  displayTimeZone: string;
  /** Applies several settings at once: city, timeZone, coordinates. */
  onChange: (patch: PluginSettings) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<City[] | null>(null);
  const [remote, setRemote] = useState<{ query: string; places: Place[] }>({
    query: '',
    places: [],
  });

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

  // Ask the geocoder a moment after typing stops; results are tagged with
  // their query so a slow answer never replaces a newer one.
  useEffect(() => {
    if (
      !open ||
      query.trim().length < 3 ||
      placeFromCoordinatesQuery(query, displayTimeZone)
    )
      return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchPlacesRemote(query.trim(), readStoredAdminToken())
        .then((results) => {
          if (cancelled) return;
          setRemote({
            query,
            places: results.map((r) => ({ ...r, origin: 'remote' as const })),
          });
        })
        .catch(() => undefined);
    }, REMOTE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, displayTimeZone]);

  const local =
    index && open
      ? searchCities(index, query).map((c) => placeFromCity(c, countryName))
      : [];
  const remotePlaces = remote.query === query ? remote.places : [];
  const typed = placeFromCoordinatesQuery(query, displayTimeZone);
  const places = typed ? [typed] : mergePlaces(local, remotePlaces);
  const zones =
    open && query.length >= 2 && places.length < 3
      ? searchZones(zoneList(), query)
          .filter((zone) => !places.some((p) => p.timeZone === zone))
          .slice(0, 2)
      : [];
  const searching =
    open && query.trim().length >= 3 && !typed && remote.query !== query;

  const pick = (place: Place) => {
    onChange({
      city: place.name,
      timeZone: place.timeZone,
      coordinates: formatCoordinates({ lat: place.lat, lon: place.lon }),
    });
    setQuery(place.name);
    setOpen(false);
  };

  return (
    <div className="city-input">
      <input
        id={id}
        data-lpignore="true"
        value={query}
        placeholder="Search any place, or type coordinates"
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
          if (event.key === 'Enter' && places[0]) {
            event.preventDefault();
            pick(places[0]);
          }
        }}
      />
      {open && (places.length > 0 || zones.length > 0 || searching) && (
        <ul id={listId} className="city-results">
          {places.map((place) => (
            <li key={`${place.name}-${place.lat}-${place.lon}`}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(place)}
              >
                <strong>{place.name}</strong>
                <small>
                  {place.region}
                  {place.origin !== 'coordinates'
                    ? ` · ${place.timeZone}`
                    : ` · ${displayTimeZone}`}
                </small>
              </button>
            </li>
          ))}
          {zones.map((zone) => (
            <li key={zone}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange({
                    city: timeZoneCity(zone),
                    timeZone: zone,
                    coordinates: '',
                  });
                  setQuery(timeZoneCity(zone));
                  setOpen(false);
                }}
              >
                <strong>{timeZoneCity(zone)}</strong>
                <small>Timezone only · {zone}</small>
              </button>
            </li>
          ))}
          {searching && (
            <li className="city-results-note">Searching more places…</li>
          )}
        </ul>
      )}
    </div>
  );
}
