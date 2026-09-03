# Calendar (Microsoft 365)

Shows a Microsoft 365 calendar: a meeting room, a shared mailbox, or a person's own calendar, all by mailbox address.
Two views: **Room sign** (Free until 14:00 / Busy until 13:30, with what comes
next; the block reverses colours while busy) and **Today** (the day's events,
the current one emphasised).

Two ways to connect. The published link needs no IT involvement; the mailbox
address needs a one-time Entra ID registration but is live and works for rooms.

| Setting       | Type    | Notes                                                                                                                              |
| ------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `icsUrl`      | secret  | A calendar published from Outlook. Stored on the server for this block only, never in the configuration.                           |
| `calendar`    | text    | Alternatively, a mailbox address such as `room-a@example.org`, read through Microsoft Graph.                                       |
| `label`       | text    | Optional. Defaults to the part before `@`.                                                                                         |
| `showDetails` | boolean | Off hides subjects and locations on the server, so a public screen shows only "Reserved". Private-marked events are always hidden. |

Data is fetched by `server.ts`, refreshed every five minutes while a screen
shows the block. Nothing runs in the browser, and links and credentials never
enter the configuration.

## Publish a calendar from Outlook (no IT needed)

1. Outlook on the web → Settings → Calendar → **Shared calendars** → Publish a
   calendar. Choose the calendar and "Can view all details" (or "Can view
   titles and locations"), then Publish.
2. Copy the **ICS** link and paste it into the block's "Published calendar
   link" field in Admin, then press Save next to it.
3. Outlook refreshes published calendars every few hours, so changes appear
   with some delay. For live room signs use the Graph path below.

The link is a secret: anyone with it can read the calendar. Morrow keeps it in
its database, scoped to the block, and removes it when the block is deleted.
Recurring events, exceptions, cancellations, and private events are handled.

## Read through Microsoft Graph (live, rooms)

Data is read with **application permissions**, so no one signs in on a screen.

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
