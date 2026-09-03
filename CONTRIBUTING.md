# Contributing to Morrow Glance

Thanks for helping. Morrow is small on purpose: a shared configuration, a
browser Player, screens the layout is designed for, and plugins that supply
content. Most contributions are a new plugin, a new screen preset, or a
focused fix in one of those areas.

## Setup

```bash
npm install
npm run dev
```

Node.js 22.13 or newer. The dev server runs on `http://localhost:3000` with a
local D1 database under `.wrangler/` that is created automatically.

Before opening a pull request:

```bash
npm run check   # format, lint, typecheck, unit tests
npm run build   # production build, same as CI
```

`npm run format` fixes formatting.

## How the code is organised

Data flows in one direction: **config → renderer → output**.

```
morrow.config.ts        Clean-install fallback configuration
lib/morrow/
  types.ts              Contracts: MorrowConfig, ScreenProfile, plugins
  config.ts             parseMorrowConfig: untrusted JSON → valid config
  defaults.ts           Clean-install screens and grid defaults
  screens/              Screen presets, one file each, plus lookups
  layout.ts             Grid math: placement, snapping, resizing, presets
  sources.ts            Data source rules: URL safety, staleness, JSON paths
  format.ts             Time and date formatting
  settings.ts           Typed readers for plugin settings
  client.ts             Browser access: API client + localStorage fallback
  server-auth.ts        Token check for Admin writes
db/                     Morrow Server persistence (Cloudflare D1): config and block data
app/
  page.tsx              Player at /
  admin/                Admin at /admin
  api/config            GET/PUT the shared configuration
  api/data              Latest block data; refreshes stale poll sources
  api/webhooks/[id]     Receives pushed JSON for a webhook block
components/
  morrow-display.tsx    Player: polling, rotation, gestures
  glance-renderer.tsx   One page of blocks on a CSS grid (Player + Admin)
  admin/                Admin console: canvas, drag hook, inspector, library
plugins/
  index.ts              Auto-discovers plugins/<name>/plugin.tsx; nothing to edit
  clock/                Reference plugin: a clock
  text/                 Reference plugin: user-authored text
  value/                Reference plugin: one field from live data
  weather/              Reference plugin: derives its own source from a city
  calendar/             Reference plugin: server module with credentials (Graph)
  server.ts             Registry of plugins/<name>/server.ts (server only)
  _template/            Copy to start a new plugin (underscore folders are skipped)
```

Rules of thumb:

- **`lib/morrow` has no React state and no I/O.** It is plain functions and
  types, which is why it has unit tests and the rest mostly does not.
- **Everything that touches the network or storage goes through
  `parseMorrowConfig`.** The API, D1, and localStorage all hand untrusted data
  to the same validator.
- **Plugins never import from `components/` or `app/`.** They receive
  everything they need as props.
- **Admin never reaches into plugin markup.** Plugin browser views use CSS
  container-query units so they scale inside any block.

## Adding a plugin

1. Copy `plugins/_template/` to `plugins/<your-name>/`.
2. In `plugin.tsx`, set a namespaced `manifest.id` such as `yourname.thing`,
   fill in the manifest, and write your view. Keep `export const plugin`;
   discovery looks for that name.
3. Style it in `plugin.css`. Blocks are CSS containers, so use container
   units (`cqmin`, `cqi`) and theme colours (`--ink`, `--faint`, `--paper`).
4. Read settings through `lib/morrow/settings.ts` rather than indexing the
   settings object. Setting types: `text`, `textarea`, `timezone`, `city`,
   `boolean`, and `secret` (stored server-side per block, delivered to
   `server.ts` in `context.secrets`, never to views).
   A `city` setting also fills its sibling settings `timeZone` and
   `coordinates` when a city is picked, so views can use them directly.
5. Describe settings and views in the folder's `README.md`.
6. Restart the dev server. The plugin appears in Admin's Plugins list and
   library. `npm test` includes a discovery test that checks ids and views.

If the plugin needs live data, set `acceptsData: true` in the manifest and
read the `data` prop. Admin then lets each block choose a poll URL or a
webhook, and Morrow Server does the fetching and storage. Do not fetch from
the view: credentials would end up in the browser and on the screen. See
`plugins/value/` for the pattern and `lib/morrow/sources.ts` for the helpers
that pick fields out of JSON.

If the plugin knows where its data lives, declare `source(settings)` in the
manifest and return a poll source built from the settings, as
`plugins/weather/` does from a city's coordinates. The server uses it when the
block has no hand-configured source, and the same safety rules apply.

If the plugin needs credentials or a non-JSON API, add `plugins/<name>/server.ts`
exporting `server` from `definePluginServer`. It runs only in Morrow Server,
receives the block settings, the environment, and the display timezone, and
returns the data the views get. Set `serverFetch: true` in the manifest so
Admin shows the data status. Never import `server.ts` from a view. See
`plugins/calendar/` for the pattern, including redacting sensitive fields on
the server so they never reach a Player.

## Adding a screen preset

1. Create `lib/morrow/screens/<name>.ts` exporting a `ScreenProfile` with a
   URL-safe id, a name, a reference width and height, and a refresh interval.
2. Append it to `screenPresets` in `lib/morrow/screens/index.ts`.
3. It appears in Admin's "Add…" menu under Screens. Saved configurations keep
   their own copy, so editing a preset later never changes an existing screen.

## Typography

One system, two weights. Do not set ad-hoc weights, letter-spacing, or pixel
sizes in a plugin or component; use the tokens from `app/globals.css`.

| Role    | Use                                                    | Tokens / class                                                |
| ------- | ------------------------------------------------------ | ------------------------------------------------------------- |
| Display | Large numerals and headlines: clock digits, a value    | `.type-display`, sizes `--type-display-xl` / `--type-display` |
| Title   | Short prose set large: the text block                  | `--type-title`, weight regular                                |
| Label   | Small caps above content: block labels, admin headings | `.plugin-label` / `.type-label`, `--type-label`               |
| Meta    | Secondary line under a value: city, offset, unit, note | `.plugin-meta` / `.type-meta`, `--type-meta`                  |
| Mono    | Ids, page counts, coordinates                          | `.type-mono`                                                  |

Weights are `--weight-regular` (400) and `--weight-medium` (500). Tracking is
`--tracking-display` for display sizes and `--tracking-label` for labels.

Sizes come in two scales. Plugin views scale with their block through the
container-relative tokens set on `.plugin-view` (`--type-display-xl`,
`--type-display`, `--type-title`, `--type-label`, `--type-meta`, `--space-block`,
`--space-gap`). Each token is the smaller of a height-led and a width-led
value, so text fills a wide block and never overflows a narrow one; if you
need a size the tokens do not cover, follow the same `min(Xcqmin, Ycqi)`
shape. Player chrome scales with the viewport. Admin uses a fixed
scale of 10, 11, 12, and 13 px; nothing smaller.

## Changing the configuration shape

`MorrowConfig` is a public format that lives in users' databases. When you add
or rename a field:

1. Update the type in `lib/morrow/types.ts`.
2. Update `parseMorrowConfig` in `lib/morrow/config.ts`, keeping a read path
   for the old shape (see how `rotationMs` and `deviceProfiles` are migrated).
3. Add a test in `lib/morrow/__tests__/config.test.ts`.
4. Update `README.md`.

## Style

- TypeScript strict mode with `noUncheckedIndexedAccess`; prefer narrowing
  over assertions.
- Formatting is enforced by `oxfmt`; linting by `oxlint`. Both run in CI.
- Keep modules single-purpose and give each a short header comment saying what
  it owns.
- Prefer small pull requests that do one thing.

## Reporting issues

Open a GitHub issue with what you expected, what happened, and the output of
`npm run check` if relevant. For security concerns, please do not open a public
issue; contact the maintainers directly.
