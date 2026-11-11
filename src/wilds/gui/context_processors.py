from pathlib import Path

from django.conf import settings
from django.http import HttpRequest

_STATIC = Path(__file__).parent / "static" / "wilds"
_cached: int | None = None


def _asset_version() -> int:
    """Newest modification time of our own CSS and JS, used as ``?v=`` on their URLs.

    The static server sends ``Last-Modified`` but no ``Cache-Control``, so browsers decide
    for themselves how long to reuse a file (hours, for one last changed days ago) and a
    plain reload keeps a stale stylesheet. A changed file gets a new URL instead. Computed
    on every request under DEBUG so edits show up at once; once per process otherwise.
    """
    global _cached
    if _cached is not None and not settings.DEBUG:
        return _cached
    version = max(
        (int(p.stat().st_mtime) for p in _STATIC.rglob("*") if p.is_file()),
        default=0,
    )
    _cached = version
    return version


# The activity board's columns: wilds-control's component names, as they appear in /status.
BOARD_COMPONENTS = [
    {"key": "guide-camera", "label": "Guide camera"},
    {"key": "shutter", "label": "Shutter"},
    {"key": "slit", "label": "Slit"},
    {"key": "adc", "label": "ADC"},
    {"key": "lamps", "label": "Lamps"},
    {"key": "archon-vis", "label": "Archon VIS"},
    {"key": "archon-uv", "label": "Archon UV"},
]


def wilds(request: HttpRequest) -> dict[str, object]:
    return {
        "wilds_control_url": settings.WILDS_CONTROL_URL,
        "asset_version": _asset_version(),
        "board_components": BOARD_COMPONENTS,
    }
