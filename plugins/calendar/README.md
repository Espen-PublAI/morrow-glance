# Calendar (Microsoft 365)

Shows a Microsoft 365 calendar: a meeting room, a shared mailbox, or a person's own calendar, all by mailbox address.
Two views: **Room sign** (Free until 14:00 / Busy until 13:30, with what comes
next; the block reverses colours while busy) and **Today** (the day's events,
the current one emphasised).

| Setting       | Type    | Notes                                                                                                                              |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `calendar`    | text    | The mailbox address, e.g. `room-a@example.org`.                                                                                    |
| `label`       | text    | Optional. Defaults to the part before `@`.                                                                                         |
| `showDetails` | boolean | Off hides subjects and locations on the server, so a public screen shows only "Reserved". Private-marked events are always hidden. |

Data is fetched by `server.ts` through Microsoft Graph using **application
permissions**, refreshed every five minutes while a screen shows the block.
Nothing runs in the browser, and credentials never enter the configuration.

## One-time setup in Entra ID (IT admin)

1. Entra admin centre → App registrations → New registration. Name it
   "Morrow Glance", single tenant, no redirect URI.
2. API permissions → Add → Microsoft Graph → **Application permissions** →
   `Calendars.Read` → Grant admin consent.
3. Certificates & secrets → New client secret. Copy the value.
4. Set on the Morrow server (Worker secrets in production, `.dev.vars` locally):

   ```
   MORROW_MS_TENANT_ID=<directory (tenant) id>
   MORROW_MS_CLIENT_ID=<application (client) id>
   MORROW_MS_CLIENT_SECRET=<secret value>
   ```

To limit which mailboxes the app can read, add an Exchange Online application
access policy scoped to the room and shared mailboxes you intend to display.
