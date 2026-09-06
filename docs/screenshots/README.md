# Screenshots

Used by the project README. They show a neutral demo Glance, never a real
install: no company, no colleagues, no private calendars. Keep it that way.

The two configurations they were captured from are beside this file, so they can
be reproduced exactly. Serve them to a throwaway instance rather than your own:

```bash
npm run build:node
MORROW_SQLITE_PATH=/tmp/demo.db PORT=3100 MORROW_ADMIN_TOKEN=demo \
  node dist/standalone/server.js &
curl -X PUT http://127.0.0.1:3100/api/config -H 'Authorization: Bearer demo' \
  -H 'content-type: application/json' --data-binary @docs/screenshots/demo-glance.json
```

Capture at a 2× device pixel ratio so text stays crisp on high-density displays.
The GitHub blocks point at a large public repository and use only the views that
show counts rather than contributor names.

| File                 | Where it is used                                               | Size             |
| -------------------- | -------------------------------------------------------------- | ---------------- |
| `player-white.png`   | README hero                                                    | 1440 × 810 at 2× |
| `player-black.png`   | README design language section                                 | 1440 × 810 at 2× |
| `admin.png`          | README Admin section                                           | 1440 × 900 at 2× |
| `social-preview.png` | GitHub repository social preview, set under Settings → General | 1280 × 640 at 2× |

`public/og.png` is the running app's own Open Graph card, referenced from
`app/layout.tsx` at 1200 × 630. It comes from `demo-social.json`, captured at 1×.

| Configuration      | Used for                                                             |
| ------------------ | -------------------------------------------------------------------- |
| `demo-glance.json` | `player-white.png`, `player-black.png` (`color: black`), `admin.png` |
| `demo-social.json` | `social-preview.png`, `public/og.png`                                |
