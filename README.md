# wilds-gui

The WILDS web GUI, in Django:

- **`/to`**: the Telescope Operator's page. It shows instrument status, the control
  requests, and grant and revoke.
- **`/io`**: the Instrument Operator's GUI. It has a page per area (operations,
  calibration, products, configuration, engineering).

The browser talks to **wilds-control** (`WILDS_CONTROL_URL`, default
`http://localhost:8001`) directly, for commands, status and video. Django serves pages and
holds no hardware state. See `claude/plans/control-and-gui.md`.

## Run

```sh
../.venv/bin/python manage.py runserver 8000
```

Then open <http://localhost:8000/io/> or <http://localhost:8000/to/>.

## Look

The style and components are copied from the
[MAST GUI](https://github.com/The-MAST-project/MAST_gui) and adapted. Each file names its
MAST origin.

- **Tokens.** `static/wilds/css/tokens.css` holds the MAST palette as `--ui-*` tokens.
  They map onto Bootstrap 5.3's own colour variables, so the dark theme works too.
- **Dark by default.** The header button switches between light and dark, and each browser
  remembers its choice.
- **Plain text only.** Toasts, the banner, `uiConfirm()` and tooltips insert plain text,
  never HTML.
- **Greyed-out controls.** `components/action_button.html` greys a control out and shows
  the reason, both taken from the status stream (plan §3.12).

Libraries are pinned and kept in `static/vendor/`, each with its licence. Nothing is loaded
from a CDN.

| Library | Version |
|---|---|
| Bootstrap | 5.3.3 |
| Bootstrap Icons | 1.11.3 |
| htmx | 2.0.4 |
| Alpine.js | 3.14.8 |

## Test

```sh
../.venv/bin/python -m pytest
```
