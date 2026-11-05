from pathlib import Path

import pytest
from django.contrib.staticfiles import finders
from django.test import Client

STATIC_IN_BASE = [
    "wilds/js/theme.js",
    "wilds/js/ui.js",
    "wilds/js/status.js",
    "wilds/css/tokens.css",
    "wilds/css/main.css",
    "wilds/css/notifications.css",
    "wilds/img/weizmann-logo.png",
    "vendor/bootstrap-5.3.3/bootstrap.min.css",
    "vendor/bootstrap-5.3.3/bootstrap.bundle.min.js",
    "vendor/bootstrap-icons-1.11.3/bootstrap-icons.min.css",
    "vendor/bootstrap-icons-1.11.3/fonts/bootstrap-icons.woff2",
    "vendor/htmx-2.0.4/htmx.min.js",
    "vendor/alpinejs-3.14.8/alpine.min.js",
]


@pytest.fixture
def client() -> Client:
    return Client()


def test_root_redirects_to_io(client: Client) -> None:
    response = client.get("/")
    assert response.status_code == 302
    assert response["Location"] == "/io/"


@pytest.mark.parametrize(
    "url", ["/to/", "/io/", "/io/calibration/", "/io/products/", "/io/engineering/"]
)
def test_pages_render(client: Client, url: str) -> None:
    response = client.get(url)
    assert response.status_code == 200
    html = response.content.decode()
    assert 'data-bs-theme="dark"' in html  # dark by default
    assert "cdn." not in html and "unpkg" not in html  # everything served locally


def test_unknown_io_page_is_404(client: Client) -> None:
    assert client.get("/io/nope/").status_code == 404


def test_to_page_has_no_sidebar(client: Client) -> None:
    assert 'id="sidebar"' not in client.get("/to/").content.decode()
    assert 'id="sidebar"' in client.get("/io/").content.decode()


@pytest.mark.parametrize("path", STATIC_IN_BASE)
def test_static_files_exist(path: str) -> None:
    assert finders.find(path), path


def test_vendored_libraries_keep_their_licences() -> None:
    vendor = Path(finders.find("vendor/htmx-2.0.4/htmx.min.js")).parents[1]
    for lib in vendor.iterdir():
        assert (lib / "LICENSE").is_file(), lib.name


def test_ui_js_never_inserts_html() -> None:
    """Session names come from anonymous visitors, so no innerHTML / insertAdjacentHTML."""
    for name in ("ui.js", "status.js", "theme.js"):
        text = Path(finders.find(f"wilds/js/{name}")).read_text()
        assert "innerHTML" not in text and "insertAdjacentHTML" not in text, name
