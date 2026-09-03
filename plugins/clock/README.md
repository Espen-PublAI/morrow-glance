# Clock

A world clock. Pick a city and see its time as digits or as a clock face. When
the city's zone differs from the display's, the clock also shows the offset
(`+7h`, `−5:30`) and whether it is already tomorrow or still yesterday there.

| Setting    | Type     | Notes                                                                                                              |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `timeZone` | timezone | Type a city such as `Tokyo` or `New York`; the field matches the IANA zone list. Defaults to the display timezone. |
| `label`    | text     | Optional. Defaults to the city name taken from the zone.                                                           |

Views: `digital`, `analog`. Default size 4 × 2, minimum 2 × 1. Time is shown to
the minute, so the analog face has hour and minute hands only.

Cities that are not in the IANA list (most smaller towns) are not matched
directly. Pick the nearest listed city in the same zone and set the label to
the town's name.
