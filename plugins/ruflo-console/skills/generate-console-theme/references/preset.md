# Theme preset contract

Return exactly this version 1 object shape. All keys are required; omit additional keys.

| Field | Value |
| --- | --- |
| `version` | Integer `1` |
| `name` | A trimmed name of 1 to 40 characters; start with a Unicode letter or number, then use only Unicode letters, numbers, spaces, dots, underscores, or hyphens |
| `palette.head` | Heading, accent, and border color |
| `palette.ok` | Success color |
| `palette.bad` | Failure color |
| `palette.warn` | Warning color |
| `palette.info` | Main information text color |
| `palette.background` | Background color |
| Every palette value | String matching `#RRGGBB` with six hexadecimal digits |
| `motion.speed` | Finite number from `0.25` through `2`, inclusive; `1` is the standard rate |
| `motion.stars` | Boolean enabling decorative stars |
| `motion.globe` | Boolean enabling the decorative globe |
| `motion.topology` | Boolean enabling decorative topology motion |

These are palette and motion parameters for existing responsive Orbital visuals. They do not add arbitrary renderers, change refresh rate preferences, or provide system health data. The host must preserve reduced-motion settings and actual operational state. Disabled decoration must not hide the live topology's operational information.

## Example: calm violet observatory

```json
{
  "version": 1,
  "name": "Violet Observatory",
  "palette": {
    "head": "#C5A3FF",
    "ok": "#83D9AB",
    "bad": "#FF8C94",
    "warn": "#F2CE7E",
    "info": "#DBDDE8",
    "background": "#0C0D16"
  },
  "motion": {
    "speed": 0.65,
    "stars": true,
    "globe": true,
    "topology": true
  }
}
```

Treat the example as a schema illustration; vary its design to match the user's request.
