# Weather

Forecast for any place on Earth from MET Norway's Locationforecast, the data
behind Yr. Pick a city and the plugin derives its own data source from the
stored coordinates; Morrow Server fetches the forecast once an hour while a
screen shows the block.

| Setting | Type | Notes                                                                       |
| ------- | ---- | --------------------------------------------------------------------------- |
| `city`  | city | Search by name. Stores `timeZone` and `coordinates`, which the plugin uses. |
| `label` | text | Optional. Defaults to the city name.                                        |

Views: `now` (icon, temperature, wind, rain), `today` (the next twelve hours in
two-hour steps), `week` (seven days with high, low, and rain). Default size
4 × 2, minimum 2 × 1. Times and days use the city's own timezone.

Data: [MET Norway](https://api.met.no/), CC BY 4.0. The views credit "MET Norway"
in their footnote as the licence asks. Requests carry an identifying User-Agent
set in `db/block-data.ts`.
