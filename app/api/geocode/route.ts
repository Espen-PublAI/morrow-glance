import { authorizeConfigWrite } from '@/lib/morrow/server-auth';
import { readBodyWithLimit } from '@/lib/morrow/sources';

/**
 * `GET /api/geocode?q=<text>` → places matching the text, for Admin's city
 * picker. Proxies Open-Meteo's geocoding API (GeoNames data, CC BY 4.0) so the
 * long tail of villages and towns is searchable without bundling them. Admin
 * only: it is gated like a configuration write so a public deployment cannot
 * be used as a free geocoder.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 5_000;

interface OpenMeteoResult {
  name?: string;
  admin1?: string;
  admin2?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  population?: number;
}

export interface PlaceResult {
  name: string;
  /** Region and country, for disambiguation: "Buskerud, Norway". */
  region: string;
  countryCode: string;
  timeZone: string;
  lat: number;
  lon: number;
  population: number;
}

export async function GET(request: Request) {
  const authorization = authorizeConfigWrite(request);
  if (!authorization.ok) {
    return Response.json(
      { error: authorization.message },
      { status: authorization.status },
    );
  }

  const query =
    new URL(request.url).searchParams.get('q')?.trim().slice(0, 80) ?? '';
  if (query.length < 2) return Response.json({ results: [] });

  const url = new URL(GEOCODE_URL);
  url.searchParams.set('name', query);
  url.searchParams.set('count', '8');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent':
          'Morrow Glance (+https://github.com/Espen-PublAI/morrow-glance)',
      },
    });
    if (!response.ok)
      return Response.json(
        { error: 'Place search is unavailable.' },
        { status: 502 },
      );
    const body = JSON.parse(await readBodyWithLimit(response)) as {
      results?: OpenMeteoResult[];
    };
    const results: PlaceResult[] = (body.results ?? [])
      .filter(
        (r) =>
          r.name &&
          r.timezone &&
          typeof r.latitude === 'number' &&
          typeof r.longitude === 'number',
      )
      .map((r) => ({
        name: r.name ?? '',
        region: [r.admin1, r.country].filter(Boolean).join(', '),
        countryCode: r.country_code ?? '',
        timeZone: r.timezone ?? 'UTC',
        lat: Number((r.latitude ?? 0).toFixed(4)),
        lon: Number((r.longitude ?? 0).toFixed(4)),
        population: r.population ?? 0,
      }));
    return Response.json(
      { results },
      { headers: { 'cache-control': 'private, max-age=300' } },
    );
  } catch {
    return Response.json(
      { error: 'Place search is unavailable.' },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
