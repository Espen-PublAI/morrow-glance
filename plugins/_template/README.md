# Example plugin

Copy this folder to `plugins/<your-name>/` and edit `plugin.tsx`. Keep this
README: it is the plugin's documentation in the catalogue.

Checklist before opening a pull request:

- [ ] `manifest.id` is namespaced and unique (`yourname.thing`).
- [ ] Every view scales with its block (container units, no `vw`).
- [ ] Settings are read through `lib/morrow/settings.ts`.
- [ ] The README lists settings and views.
- [ ] `npm run check` passes.
