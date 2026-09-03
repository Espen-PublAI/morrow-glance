import {
  DEFAULT_ROTATION_SECONDS,
  DEFAULT_SCREEN_ID,
  DEFAULT_SCREENS,
} from '@/lib/morrow/defaults';
import {
  DATA_SOURCE_KINDS,
  MORROW_COLORS,
  type BlockDataSource,
  type GlanceBlock,
  type GlanceLayout,
  type GlancePage,
  type MorrowConfig,
  type PluginSettings,
  type ScreenProfile,
} from '@/lib/morrow/types';

/**
 * Configuration parsing and validation.
 *
 * `parseMorrowConfig` accepts untrusted JSON (from the API, D1, or
 * localStorage) and returns a clean `MorrowConfig` with unknown keys removed,
 * or throws a `MorrowConfigError` that names the offending path.
 */

export class MorrowConfigError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'MorrowConfigError';
    this.path = path;
  }
}

/** Upper bounds that keep a hostile payload from becoming a stored problem. */
export const CONFIG_LIMITS = {
  idLength: 64,
  nameLength: 120,
  labelLength: 80,
  pages: 50,
  blocksPerPage: 200,
  screens: 50,
  gridSize: 48,
  pixels: 8192,
  refreshSeconds: 60 * 60 * 24 * 7,
  rotationSeconds: 60 * 60 * 24,
  settingKeys: 50,
  settingTextLength: 10_000,
  disabledPlugins: 200,
  urlLength: 2048,
  pollIntervalMin: 60,
  pollIntervalMax: 60 * 60 * 24,
} as const;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

type Json = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new MorrowConfigError(path, message);
}

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Json;
}

function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected a list');
  if (value.length > max) fail(path, `at most ${max} items are allowed`);
  return value;
}

function text(
  value: unknown,
  path: string,
  { max, allowEmpty = false }: { max: number; allowEmpty?: boolean },
): string {
  if (typeof value !== 'string') fail(path, 'expected text');
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) fail(path, 'must not be empty');
  if (trimmed.length > max) fail(path, `must be ${max} characters or fewer`);
  return trimmed;
}

function id(value: unknown, path: string): string {
  const candidate = text(value, path, { max: CONFIG_LIMITS.idLength });
  if (!ID_PATTERN.test(candidate)) {
    fail(path, 'may only contain letters, digits, ".", "_" and "-"');
  }
  return candidate;
}

function integer(
  value: unknown,
  path: string,
  { min, max }: { min: number; max: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected a number');
  }
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) {
    fail(path, `must be between ${min} and ${max}`);
  }
  return rounded;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  path: string,
  options: T,
): T[number] {
  if (typeof value !== 'string' || !options.includes(value)) {
    fail(path, `expected one of ${options.join(', ')}`);
  }
  return value;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

function timeZone(value: unknown, path: string): string {
  const candidate = text(value, path, { max: CONFIG_LIMITS.nameLength });
  if (!isValidTimeZone(candidate))
    fail(path, `unknown timezone "${candidate}"`);
  return candidate;
}

function settings(value: unknown, path: string): PluginSettings | undefined {
  if (value === undefined || value === null) return undefined;
  const source = object(value, path);
  const keys = Object.keys(source);
  if (keys.length > CONFIG_LIMITS.settingKeys) {
    fail(path, `at most ${CONFIG_LIMITS.settingKeys} settings are allowed`);
  }

  const result: PluginSettings = {};
  for (const key of keys) {
    const entry = source[key];
    const entryPath = `${path}.${key}`;
    if (entry === undefined || entry === null) continue;
    if (typeof entry === 'boolean') {
      result[key] = entry;
    } else if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) fail(entryPath, 'expected a finite number');
      result[key] = entry;
    } else if (typeof entry === 'string') {
      if (entry.length > CONFIG_LIMITS.settingTextLength) {
        fail(
          entryPath,
          `must be ${CONFIG_LIMITS.settingTextLength} characters or fewer`,
        );
      }
      result[key] = entry;
    } else {
      fail(entryPath, 'settings may only hold text, numbers, or booleans');
    }
  }
  return result;
}

function layout(value: unknown, path: string): GlanceLayout {
  const source = object(value, path);
  const bounds = { min: 1, max: CONFIG_LIMITS.gridSize };
  return {
    columns: integer(source.columns, `${path}.columns`, bounds),
    rows: integer(source.rows, `${path}.rows`, bounds),
  };
}

function dataSource(value: unknown, path: string): BlockDataSource | undefined {
  if (value === undefined || value === null) return undefined;
  const source = object(value, path);
  const kind = oneOf(source.kind, `${path}.kind`, DATA_SOURCE_KINDS);
  if (kind === 'webhook') return { kind };
  const url = text(source.url, `${path}.url`, { max: CONFIG_LIMITS.urlLength });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fail(`${path}.url`, 'must be an absolute URL');
  }
  if (parsed.protocol !== 'https:') fail(`${path}.url`, 'must use https');
  return {
    kind,
    url: parsed.toString(),
    intervalSeconds: integer(
      source.intervalSeconds,
      `${path}.intervalSeconds`,
      {
        min: CONFIG_LIMITS.pollIntervalMin,
        max: CONFIG_LIMITS.pollIntervalMax,
      },
    ),
  };
}

function block(value: unknown, path: string, grid: GlanceLayout): GlanceBlock {
  const source = object(value, path);
  const column = integer(source.column, `${path}.column`, {
    min: 1,
    max: grid.columns,
  });
  const span = integer(source.span, `${path}.span`, {
    min: 1,
    max: grid.columns,
  });
  const row = integer(source.row, `${path}.row`, { min: 1, max: grid.rows });
  const rowSpan = integer(source.rowSpan, `${path}.rowSpan`, {
    min: 1,
    max: grid.rows,
  });
  if (column + span - 1 > grid.columns)
    fail(path, 'extends past the last column');
  if (row + rowSpan - 1 > grid.rows) fail(path, 'extends past the last row');

  const result: GlanceBlock = {
    id: id(source.id, `${path}.id`),
    plugin: id(source.plugin, `${path}.plugin`),
    view: id(source.view, `${path}.view`),
    column,
    span,
    row,
    rowSpan,
  };
  const parsedSettings = settings(source.settings, `${path}.settings`);
  if (parsedSettings) result.settings = parsedSettings;
  const parsedSource = dataSource(source.data, `${path}.data`);
  if (parsedSource) result.data = parsedSource;
  return result;
}

function page(value: unknown, path: string): GlancePage {
  const source = object(value, path);
  const grid = layout(source.layout, `${path}.layout`);
  const blocks = array(
    source.blocks ?? [],
    `${path}.blocks`,
    CONFIG_LIMITS.blocksPerPage,
  ).map((entry, index) => block(entry, `${path}.blocks[${index}]`, grid));

  const seen = new Set<string>();
  const occupied = new Set<string>();
  for (const entry of blocks) {
    if (seen.has(entry.id))
      fail(`${path}.blocks`, `duplicate block id "${entry.id}"`);
    seen.add(entry.id);
    for (const cell of cellsOf(entry)) {
      if (occupied.has(cell)) {
        fail(`${path}.blocks`, `block "${entry.id}" overlaps another block`);
      }
      occupied.add(cell);
    }
  }

  return {
    id: id(source.id, `${path}.id`),
    label: text(source.label, `${path}.label`, {
      max: CONFIG_LIMITS.labelLength,
      allowEmpty: true,
    }),
    layout: grid,
    blocks,
  };
}

/** Grid cells covered by a block, as `row:column` keys. */
export function cellsOf(block: {
  column: number;
  span: number;
  row: number;
  rowSpan: number;
}): string[] {
  const cells: string[] = [];
  for (let r = block.row; r < block.row + block.rowSpan; r += 1) {
    for (let c = block.column; c < block.column + block.span; c += 1) {
      cells.push(`${r}:${c}`);
    }
  }
  return cells;
}

function screen(value: unknown, path: string): ScreenProfile {
  const source = object(value, path);
  const pixels = { min: 1, max: CONFIG_LIMITS.pixels };
  return {
    id: id(source.id, `${path}.id`),
    name: text(source.name, `${path}.name`, { max: CONFIG_LIMITS.nameLength }),
    width: integer(source.width, `${path}.width`, pixels),
    height: integer(source.height, `${path}.height`, pixels),
    refreshSeconds: integer(source.refreshSeconds, `${path}.refreshSeconds`, {
      min: 1,
      max: CONFIG_LIMITS.refreshSeconds,
    }),
  };
}

/**
 * Configurations written before screens existed stored `deviceProfiles` with
 * a `transport`. Keep the browser ones; image-output profiles are dropped.
 */
function legacyScreens(source: Json): unknown {
  if (source.screens !== undefined) return source.screens;
  const legacy = source.deviceProfiles;
  if (!Array.isArray(legacy)) return undefined;
  return legacy.filter(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Json).transport !== 'image',
  );
}

function rotationSeconds(source: Json): number {
  // Configurations written before 0.1.0 stored `rotationMs`.
  const legacy = source.rotationMs;
  const value =
    source.rotationSeconds ??
    (typeof legacy === 'number' ? legacy / 1000 : undefined) ??
    DEFAULT_ROTATION_SECONDS;
  return integer(value, 'rotationSeconds', {
    min: 1,
    max: CONFIG_LIMITS.rotationSeconds,
  });
}

/**
 * Turn untrusted input into a valid `MorrowConfig`.
 *
 * Missing screens fall back to the built-in browser screen so older
 * configurations keep working. Everything else must be present and valid.
 */
export function parseMorrowConfig(input: unknown): MorrowConfig {
  const source = object(input, '');

  // New-format input must be fully valid; legacy input is repaired where possible.
  const strict = source.screens !== undefined;
  const rawScreens = legacyScreens(source);
  const parsedScreens =
    rawScreens === undefined
      ? []
      : array(rawScreens, 'screens', CONFIG_LIMITS.screens).map(
          (entry, index) => screen(entry, `screens[${index}]`),
        );
  const screens =
    parsedScreens.length > 0 || strict
      ? parsedScreens
      : DEFAULT_SCREENS.map((preset) => ({ ...preset }));
  if (screens.length === 0) fail('screens', 'at least one screen is required');
  const screenIds = new Set<string>();
  for (const entry of screens) {
    if (screenIds.has(entry.id))
      fail('screens', `duplicate screen id "${entry.id}"`);
    screenIds.add(entry.id);
  }

  const requestedDefault =
    source.defaultScreenId ?? source.defaultDeviceProfileId;
  let defaultScreenId = screens[0]?.id ?? DEFAULT_SCREEN_ID;
  if (requestedDefault !== undefined) {
    const candidate = id(requestedDefault, 'defaultScreenId');
    if (screenIds.has(candidate)) defaultScreenId = candidate;
    else if (strict) fail('defaultScreenId', `no screen has id "${candidate}"`);
  }

  const pages = array(source.pages, 'pages', CONFIG_LIMITS.pages).map(
    (entry, index) => page(entry, `pages[${index}]`),
  );
  if (pages.length === 0) fail('pages', 'a Glance needs at least one page');
  const pageIds = new Set<string>();
  for (const entry of pages) {
    if (pageIds.has(entry.id)) fail('pages', `duplicate page id "${entry.id}"`);
    pageIds.add(entry.id);
  }

  const disabledPlugins = Array.from(
    new Set(
      array(
        source.disabledPlugins ?? [],
        'disabledPlugins',
        CONFIG_LIMITS.disabledPlugins,
      ).map((entry, index) => id(entry, `disabledPlugins[${index}]`)),
    ),
  );

  return {
    name: text(source.name, 'name', { max: CONFIG_LIMITS.nameLength }),
    location: text(source.location ?? '', 'location', {
      max: CONFIG_LIMITS.nameLength,
      allowEmpty: true,
    }),
    timeZone: timeZone(source.timeZone, 'timeZone'),
    color: oneOf(source.color, 'color', MORROW_COLORS),
    rotationSeconds: rotationSeconds(source),
    defaultScreenId,
    screens,
    pages,
    disabledPlugins,
  };
}

/**
 * Validate a configuration written in code (for example `morrow.config.ts`).
 * Throws at module load so a broken fallback is caught immediately.
 */
export function defineMorrowConfig<const TConfig extends MorrowConfig>(
  config: TConfig,
): TConfig {
  parseMorrowConfig(config);
  return config;
}
