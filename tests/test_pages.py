from pathlib import Path

import pytest
from django.contrib.staticfiles import finders
from django.test import Client

STATIC_IN_BASE = [
    "wilds/js/theme.js",
    "wilds/js/ui.js",
    "wilds/js/status.js",
    "wilds/js/clock.js",
    "wilds/js/session.js",
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


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/calibration/", "/io/products/", "/eng/"])
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


def test_header_shows_the_session_code_with_a_tooltip(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "$store.session.code" in html
    assert 'x-tooltip="$store.session.provenance"' in html
    assert "wilds/js/session.js" in html


def test_holder_code_has_the_holder_origin_tooltip(client: Client) -> None:
    # /io shows it inside the control-status tooltip; /eng and /to on the holder's own code.
    assert "$store.wilds.control.holder_info" in client.get("/io/").content.decode()
    for url in ("/eng/", "/to/"):
        html = client.get(url).content.decode()
        assert 'x-tooltip="$store.wilds.control.holder_info"' in html


def test_to_page_lists_sessions_with_provenance_tooltips(client: Client) -> None:
    html = client.get("/to/").content.decode()
    assert "wilds/js/to.js" in html
    assert 'x-data="toSessions()"' in html
    for who in ("holder", "r", "v"):
        assert f'x-tooltip="{who}.provenance"' in html


def test_to_js_is_served(client: Client) -> None:
    assert finders.find("wilds/js/to.js")


def test_request_control_is_wired_to_the_session_store(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert '@click="$store.session.requestControl()"' in html
    assert 'x-tooltip="$store.session.provenance"' in html
    assert "Session code: <strong>—</strong>" not in html


def test_to_page_has_grant_refuse_and_revoke(client: Client) -> None:
    html = client.get("/to/").content.decode()
    for call in ('@click="grant(r)"', '@click="refuse(r)"', '@click="revoke()"'):
        assert call in html
    assert 'action="revoke"' not in html


@pytest.mark.parametrize(
    ("url", "title"),
    [
        ("/io/", "WILDS - Instrument Operator"),
        ("/io/calibration/", "WILDS - Instrument Operator"),
        ("/to/", "WILDS - Telescope Operator"),
        ("/eng/", "WILDS - Engineering"),
    ],
)
def test_page_titles(client: Client, url: str, title: str) -> None:
    assert f"<title>{title}</title>" in client.get(url).content.decode()


def test_io_engineering_moved_to_eng(client: Client) -> None:
    response = client.get("/io/engineering/")
    assert response.status_code == 302 and response["Location"] == "/eng/"
    assert "/io/engineering/" not in client.get("/io/").content.decode()  # not in the sidebar


def test_eng_page_asks_for_the_passphrase_and_has_the_calibration_access_points(
    client: Client,
) -> None:
    html = client.get("/eng/").content.decode()
    assert "$store.session.enterEngineering(this.passphrase)" in html
    assert "$store.session.release()" in html
    assert "$store.wilds.warnings" in html  # default-passphrase warning
    for action in ("lamps", "slit", "adc", "focus", "bias", "dark", "flat"):
        assert f"$store.wilds.action('cal_{action}')" in html


def test_to_online_status_is_in_the_header_except_on_the_to_page(client: Client) -> None:
    assert "$store.wilds.to.online" in client.get("/io/").content.decode()
    assert "$store.wilds.to.online" in client.get("/eng/").content.decode()
    assert "TO: " not in client.get("/to/").content.decode()  # the TO page is the TO


def test_io_page_warns_when_the_to_is_offline(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "The Telescope Operator is offline" in html
    assert "$store.wilds.to.online === false" in html


@pytest.mark.parametrize(
    ("alias", "canonical"),
    [
        ("/telescope-operator/", "/to/"),
        ("/telop/", "/to/"),
        ("/instrument-operator/", "/io/"),
        ("/instop/", "/io/"),
        ("/instop/calibration/", "/io/calibration/"),
        ("/instrument-operator/products/", "/io/products/"),
        ("/engineering/", "/eng/"),
    ],
)
def test_alias_paths_redirect_to_the_canonical_page(
    client: Client, alias: str, canonical: str
) -> None:
    response = client.get(alias)
    assert response.status_code == 302 and response["Location"] == canonical
    assert client.get(canonical).status_code == 200


def test_alias_without_a_trailing_slash_gets_there_too(client: Client) -> None:
    response = client.get("/telop", follow=True)
    assert response.redirect_chain[-1][0] == "/to/" and response.status_code == 200


@pytest.mark.parametrize(
    ("url", "heading"),
    [
        ("/io/", "Instrument Operator"),
        ("/io/calibration/", "Instrument Operator"),  # no area suffix
        ("/to/", "Telescope Operator"),
        ("/eng/", "Engineering"),
    ],
)
def test_header_text_is_just_the_role(client: Client, url: str, heading: str) -> None:
    html = client.get(url).content.decode()
    assert f'<div class="ui-title">{heading}</div>' in html


@pytest.mark.parametrize(("url", "has_lt"), [("/io/", True), ("/eng/", True), ("/to/", False)])
def test_header_clocks_follow_the_title(client: Client, url: str, has_lt: bool) -> None:
    html = client.get(url).content.decode()
    assert html.index('class="ui-title"') < html.index('class="ui-clocks"')
    assert "$store.clock.ldt" in html and "$store.clock.ut" in html
    assert ("$store.clock.lt" in html) is has_lt
    assert "wilds/js/clock.js" in html


def test_to_page_has_no_session(client: Client) -> None:
    html = client.get("/to/").content.decode()
    assert "wilds/js/session.js" not in html  # no name prompt, not in its own viewers list
    assert "$store.session" not in html  # no badge
    assert "$store.session" in client.get("/io/").content.decode()


def test_the_link_is_called_the_server(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "'server: ' +" in html and ">Server</h6>" in html
    assert "wilds-control: " not in html


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/calibration/", "/eng/"])
def test_no_template_comments_leak_into_the_page(client: Client, url: str) -> None:
    """Django's {# #} comments are single-line only; a multi-line one renders as visible text."""
    html = client.get(url).content.decode()
    assert "{#" not in html and "#}" not in html
    assert "{% comment" not in html and "{% endcomment" not in html


def test_header_says_control_not_wilds_control(client: Client) -> None:
    for url in ("/to/", "/eng/"):  # these show who holds control
        html = client.get(url).content.decode()
        assert "Control: <em>nobody</em>" in html
        assert "WILDS control" not in html


def test_io_topbar_shows_this_sessions_control_status(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "$store.session.controlStatus" in html
    for word in ("Granted", "Requested", "Refused"):
        assert f"'{word}'" in html
    assert "<span>Control:</span>" in html
    assert "Control: <em>nobody</em>" not in html  # the holder moved into the tooltip
    assert "Held by " in html


def test_session_badge_has_the_person_above_the_code(client: Client) -> None:
    html = client.get("/io/").content.decode()
    name = html.index('x-text="$store.session.name"')
    code = html.index('x-text="$store.session.code" x-tooltip')
    assert name < code
    assert '<div x-text="$store.session.name"></div>' in html  # its own line


def test_own_css_and_js_carry_a_version_so_a_change_busts_the_browser_cache(client: Client) -> None:
    import re

    html = client.get("/to/").content.decode()
    urls = re.findall(r'(?:href|src)="(/static/wilds/(?:css|js)/[^"]+)"', html)
    assert urls and all(re.search(r"\?v=\d+$", u) for u in urls), urls
    assert "/static/wilds/js/to.js?v=" in html


def test_the_version_changes_when_a_static_file_changes(tmp_path, monkeypatch) -> None:
    import os

    from wilds.gui import context_processors as cp

    (tmp_path / "a.css").write_text("x")
    monkeypatch.setattr(cp, "_STATIC", tmp_path)
    monkeypatch.setattr(cp.settings, "DEBUG", True)
    os.utime(tmp_path / "a.css", (1000, 1000))
    assert cp._asset_version() == 1000
    os.utime(tmp_path / "a.css", (2000, 2000))
    assert cp._asset_version() == 2000


def test_clock_labels_are_bold_by_markup_not_only_by_css(client: Client) -> None:
    html = client.get("/io/").content.decode()
    for label in ("LDT", "UT", "LT"):
        assert f'<strong class="ui-clock-label">{label}</strong>' in html
