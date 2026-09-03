# Value

Shows one figure or word from the block's data. Give the block a data source
in Admin (poll a public JSON URL, or receive a webhook), then point `path` at
the field you want.

| Setting | Type | Notes                                                                                          |
| ------- | ---- | ---------------------------------------------------------------------------------------------- |
| `label` | text | Shown above the value in small caps.                                                           |
| `path`  | text | Dotted path into the JSON, e.g. `main.temp` or `items[0].name`. Empty shows the whole payload. |
| `unit`  | text | Appended after the value, e.g. `°C` or `%`.                                                    |

Views: `big`. Default size 4 × 2, minimum 2 × 1. Shows "Waiting for data" until
the first fetch or delivery, and the last error under the value if a fetch fails.
