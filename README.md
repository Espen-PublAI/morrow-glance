# Morrow Glance

A calm, open-source ambient display for browsers: wall TVs, tablets, kiosk screens. Inspired by TRMNL, Linear, and reMarkable.

Morrow keeps content, layout, and output separate:

- **Morrow Player** presents a responsive Glance in any modern browser.
- **Morrow Screens** describe the screens the Glance is designed for, such as a 4K TV or an upright tablet.
- **Morrow Plugins** provide content and views without coupling integrations to the Player.
- **Morrow Server** stores one shared configuration in Cloudflare D1 and serves it to Admin and every Player.

A clean installation intentionally starts with an empty Glance. There is no sample content or simulated data.

## Run locally

Morrow requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the Player and `http://localhost:3000/admin` for Admin. A local D1 database is created automatically under `.wrangler/`.

Other scripts:

| Script           | Purpose                                                      |
| ---------------- | ------------------------------------------------------------ |
| `npm run check`  | Format check, lint, typecheck, and unit tests (what CI runs) |
| `npm test`       | Unit tests only                                              |
| `npm run format` | Fix formatting                                               |
| `npm run build`  | Production build into `dist/`                                |

## Admin

Admin is the visual control surface for the system. It supports:

- display name, location, timezone, paper colour, and page rotation;
- adding, naming, and removing pages;
- dragging plugins from the library onto the page grid, moving blocks, and resizing them from a corner handle, with keyboard nudging for accessibility;
- adding screens from presets or as a custom size.

Save writes the configuration to Morrow Server. Every Player also keeps a local copy of the last configuration it received, so a screen keeps showing its Glance if the server is temporarily unavailable.

## Screens

A screen is a reference size the layout is designed against plus a refresh interval. The Player adapts to the real viewport, so the same Glance works on a phone held in the hand and a television on the wall. Open `/?screen=<id>` on a device to make its Player follow that screen's refresh interval; without the parameter the default screen applies.

A clean install has one screen, **Browser · adaptive**. Admin can add more from the built-in presets or as a custom size:

| Preset             | Reference size |
| ------------------ | -------------: |
| Browser · adaptive |    1920 × 1080 |
| Tablet · portrait  |    1024 × 1366 |
| TV · 4K            |    3840 × 2160 |

Presets live in `lib/morrow/screens/`, one file each. Adding a new kind of screen is a new file and one line in `lib/morrow/screens/index.ts`.

## API

| Endpoint                      | Purpose                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/config`             | Read the shared Morrow configuration. Returns its version stamp in `x-morrow-updated-at`.                       |
| `PUT /api/config`             | Validate and save the shared configuration. Send the stamp as `If-Match` to be told about conflicts with `409`. |
| `GET /api/data`               | Latest data for every block with a data source, refreshing stale poll sources on the way.                       |
| `POST /api/webhooks/:blockId` | Deliver JSON to a block that uses the webhook strategy. Requires `MORROW_WEBHOOK_TOKEN`.                        |

Invalid configurations are rejected with `400` and a message naming the field, for example `pages[0].blocks[2]: extends past the last column`.

## Configure a Glance in code

`morrow.config.ts` is the clean-install fallback and defines the same structure that Admin saves. All durations are in seconds. The palette stays deliberately limited:

```ts
color: 'white'; // 'white' | 'grey' | 'black'
```

Every page owns a grid and plugin blocks. The default page is empty:

```ts
{
  id: 'glance',
  label: 'Glance',
  layout: { columns: 12, rows: 5 },
  blocks: [],
}
```

With multiple pages, the Player automatically enables tabs, rotation, touch gestures, and keyboard navigation.

## Design language

The Player borrows from e-paper companions and from Linear and reMarkable: one ink on one paper, dotted hairlines where two blocks meet, and a single quiet footer under a very faint rule that carries the display name, date, location, and time as plain text. There is no header; the whole screen above the footer belongs to blocks. Hairlines and the footer scale with the viewport, so a 4K television reads like a 7-inch panel held closer. Typography is one system with two weights, and every size is a token that scales with the block or the viewport, so plugins by different authors set the same way. Blocks never have fills or shadows, so a layout reads the same in white, grey, and black. Dividers and the halftone derive from the ink colour, which is why a new theme only needs `--paper` and `--ink`.

Anything read from the API, the database, or the browser passes through `parseMorrowConfig` in `lib/morrow/config.ts`, which strips unknown keys, checks ranges and ids, and refuses overlapping blocks. Older configurations that stored `rotationMs` or `deviceProfiles` are migrated on read.

## Data sources

A block can get live data without anyone writing code. In Admin, select a block whose plugin accepts data and choose a source:

| Strategy    | How it works                                                                                                                                                                                                           | Good for                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Static**  | No source. The view renders from its settings.                                                                                                                                                                         | Clocks, notes, labels.                                                                                         |
| **Poll**    | Morrow Server fetches a public HTTPS JSON URL on an interval you choose (at least 60 s). It fetches lazily, whenever a Player asks for data and the interval has elapsed, so nothing runs while no screen is watching. | Open APIs: weather, transit, air quality, public counters.                                                     |
| **Webhook** | An external system sends JSON to `POST /api/webhooks/<blockId>`. Each delivery replaces the block's data.                                                                                                              | Anything with credentials or internal data: Power Automate, n8n, Home Assistant, a script in your own network. |

Views receive the data as a `data` prop. The built-in **Value** plugin shows one field from it with a dotted path such as `main.temp`.

Safety rules that are enforced, not just documented: poll URLs must be public HTTPS, and loopback, private, link-local, and internal-looking hosts are refused so the server cannot be pointed at its own network. Responses and webhook bodies are capped at 64 KB, polls time out after eight seconds, and redirects are not followed. Webhooks are disabled until `MORROW_WEBHOOK_TOKEN` is set. Keep credentials out of poll URLs: the configuration is readable by every Player, so an authenticated source should push data with a webhook instead. Everything delivered to a block is public to whoever can open a Player.

## Plugins

A plugin is a folder under `plugins/` with a `plugin.tsx` that exports `plugin`, its own `plugin.css`, and a `README.md`. Every such folder is discovered automatically; there is no registry to edit. Folders starting with an underscore are ignored, which is how `plugins/_template/` stays out of the library.

```text
plugins/
  clock/      plugin.tsx · plugin.css · README.md
  text/       plugin.tsx · plugin.css · README.md
  _template/  copy me to start a new plugin
```

Views are ordinary React components that receive the current time, the display's timezone, the block's settings, and, when the block has a data source, its latest `data`. Set `acceptsData: true` in the manifest to let Admin offer poll and webhook sources for the plugin. They render inside a CSS container, so size text with container units such as `cqmin` rather than `vw`; the same view then scales correctly in the Player and on the Admin canvas. Use the `plugin-view` and `plugin-label` classes for the shared padding and label style.

```tsx
import { Sparkles } from 'lucide-react';

import { readStringSetting } from '@/lib/morrow/settings';
import { definePlugin } from '@/lib/morrow/types';

import './plugin.css';

export const plugin = definePlugin({
  manifest: {
    id: 'example.plugin',
    name: 'Example',
    version: '0.1.0',
    description: 'A short description.',
    refreshSeconds: 300,
    views: [{ id: 'default', name: 'Default' }],
    settings: [{ id: 'label', label: 'Label', type: 'text' }],
    defaultSize: { span: 6, rowSpan: 2 },
    minSize: { span: 2, rowSpan: 1 },
  },
  icon: Sparkles,
  views: {
    default: function DefaultView({ now, settings }) {
      return (
        <div className="plugin-view">
          <span className="plugin-label">
            {readStringSetting(settings, 'label')}
          </span>
          <strong>{now.toLocaleTimeString()}</strong>
        </div>
      );
    },
  },
});
```

**Installed versus enabled.** Everything in `plugins/` is installed, ships with the build, and appears in Admin's library. An install can hide plugins it does not want by listing their ids in `disabledPlugins` in `morrow.config.ts` or through the config API. A newly added plugin is enabled by default, and blocks that already use a disabled plugin keep rendering.

**Sharing plugins.** Contribute a plugin by opening a pull request that adds its folder. The README in the folder is its documentation. As the catalogue grows, plugins can also be published as npm packages and dropped into `plugins/` by a project; the folder contract stays the same. Morrow deliberately does not load plugin code at runtime from URLs, because every screen would then execute arbitrary code.

See `CONTRIBUTING.md` for the full module map and conventions.

## Storage and access

Morrow Server uses the Cloudflare D1 binding named `DB`. The schema lives in `migrations/0001_morrow_config.sql`; local development creates the same table automatically. For a hosted database run:

```bash
npx wrangler d1 migrations apply <database-name> --remote
```

Access is deliberately simple:

- **Development is open on localhost.** With no token configured, the dev server accepts saves from localhost so a fresh checkout works immediately.
- **Production requires a token.** A production build refuses every save until `MORROW_ADMIN_TOKEN` is set, and Admin shows a clear message saying so. Enter the token in Admin; the browser keeps it only for the current tab. The hostname check is not used in production because a proxy may forward `Host: localhost`.
- **Two admins cannot overwrite each other.** Every save carries the version stamp of the configuration it started from. If someone else saved in between, the API answers `409`, Admin explains, and offers a reload.
- **Reads are public.** `GET /api/config` has no authentication, because a Player is meant to be opened on any screen. Do not put anything on a Glance that must stay private, and keep a hosted instance behind a network you trust or a proxy that adds access control.

See `.env.example` for all variables. Locally they go in `.dev.vars` (copy `.dev.vars.example`), because the Cloudflare runtime does not read the shell environment; in production set them as Worker secrets.

## Deploy

Morrow is built with [vinext](https://github.com/cloudflare/vinext) and targets Cloudflare Workers with D1. Run `npm run build`, then deploy `dist/` with Wrangler or `npx @vinext/cloudflare deploy`. Set `MORROW_ADMIN_TOKEN` and `MORROW_PUBLIC_URL` as Worker secrets or variables, and bind a D1 database as `DB`. Set `MORROW_BUILD_ID` to the git SHA at deploy time; Players compare it on every poll and reload themselves once the new id has answered twice in a row, at most once every ten minutes, so wall screens pick up new releases without anyone touching them and never loop during a gradual rollout.

The repository also carries `@openai/sites-vite-plugin` and `.openai/hosting.json`, which package the same build for OpenAI Sites hosting. They do not affect other targets.

## Project shape

```text
app/                         Player, Admin, and the config API
components/                  Player and Admin components
db/                          D1 configuration storage
lib/morrow/                  Contracts, validation, grid math, screens, access checks
migrations/                  Durable storage schema
plugins/                     Installed plugins and their views
morrow.config.ts             Clean-install fallback configuration
```

The initial plugin library contains only real system primitives: a world clock with digital, analog, and map views, a user-authored text block, and a Value block that shows one field from live data. `plugins/_template/` is a starting point for new ones.

## Direction

The platform boundary is now in place. The next additions can remain small and focused: per-screen layout hints, richer page scheduling, and real integration plugins that fetch through Morrow Server without placing credentials on a display.

## Contributing

Issues, ideas, and focused pull requests are welcome. Read `CONTRIBUTING.md` first. Keep the core small; integrations should remain plugins.

## Data credits

The world clock's city search uses [GeoNames](https://www.geonames.org/) data (CC BY 4.0), and its map uses [Natural Earth](https://www.naturalearthdata.com/) land shapes (public domain), both bundled as compact generated files under `lib/morrow/geo/`. Regenerate them with `npm run geo`.

## License

MIT
