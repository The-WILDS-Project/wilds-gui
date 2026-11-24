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
    "wilds/js/jobs.js",
    "wilds/js/camera.js",
    "wilds/js/config.js",
    "wilds/css/tokens.css",
    "wilds/css/main.css",
    "wilds/css/notifications.css",
    "wilds/css/activity.css",
    "wilds/css/camera.css",
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
    "url",
    [
        "/to/",
        "/io/",
        "/io/products/",
        "/io/engineering/",
        "/io/engineering/calibration/",
        "/io/engineering/configuration/",
    ],
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
    for name in (
        "ui.js",
        "status.js",
        "theme.js",
        "jobs.js",
        "camera.js",
        "config.js",
        "guide_calibration.js",
        "optics_calibration.js",
        "fits_viewer.js",
        "acquisition.js",
        "slit.js",
    ):
        text = Path(finders.find(f"wilds/js/{name}")).read_text()
        assert "innerHTML" not in text and "insertAdjacentHTML" not in text, name


def test_header_shows_the_session_code_with_a_tooltip(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "$store.session.code" in html
    assert 'x-tooltip="$store.session.provenance"' in html
    assert "wilds/js/session.js" in html


def test_holder_code_has_the_holder_origin_tooltip(client: Client) -> None:
    # The control pill's tooltip carries where the holder comes from (status.js, session.js).
    for script in ("status.js", "session.js"):
        assert "holder_info" in Path(finders.find(f"wilds/js/{script}")).read_text()
    for url in ("/io/", "/io/engineering/", "/to/"):
        assert "controlView" in client.get(url).content.decode()


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
        ("/io/products/", "WILDS - Instrument Operator"),
        ("/io/engineering/calibration/", "WILDS - Instrument Operator"),  # no engineering role
        ("/to/", "WILDS - Telescope Operator"),
        ("/io/engineering/", "WILDS - Instrument Operator"),
    ],
)
def test_page_titles(client: Client, url: str, title: str) -> None:
    assert f"<title>{title}</title>" in client.get(url).content.decode()


def test_the_engineering_pages_are_part_of_the_instrument_operators_gui(client: Client) -> None:
    for old, new in (
        ("/eng/", "/io/engineering/"),
        ("/eng/calibration/", "/io/engineering/calibration/"),
        ("/io/calibration/", "/io/engineering/calibration/"),
        ("/io/configuration/", "/io/engineering/configuration/"),
        ("/io/engineering/monitoring/", "/io/monitoring/"),  # Monitoring is in the main sidebar now
    ):
        response = client.get(old)
        assert response.status_code == 302 and response["Location"] == new, old
    html = client.get("/io/").content.decode()
    assert 'data-bs-target="#sub-engineering"' in html  # the Engineering group of the sidebar
    for page in ("calibration", "configuration"):
        assert f'href="/io/engineering/{page}/"' in html
    assert 'href="/io/monitoring/"' in html and 'href="/io/engineering/monitoring/"' not in html


def test_there_is_no_engineering_mode_or_passphrase_box(client: Client) -> None:
    html = client.get("/io/engineering/").content.decode()
    assert "enterEngineering" not in html and "Engineering passphrase" not in html
    assert "$store.session.requestControl()" in html and "Request control" in html
    assert "Release control" not in html and "release()" not in html
    assert "$store.wilds.warnings" in html  # configuration warnings
    assert client.get("/eng/passphrase/").status_code == 302  # an old link still lands in the GUI


def test_to_online_status_is_in_the_header_except_on_the_to_page(client: Client) -> None:
    assert "$store.wilds.toView" in client.get("/io/").content.decode()
    assert "$store.wilds.toView" in client.get("/io/engineering/").content.decode()
    assert "$store.wilds.toView" not in client.get("/to/").content.decode()  # the TO page is the TO


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
        ("/instop/products/", "/io/products/"),
        ("/engineering/calibration/", "/io/engineering/calibration/"),
        ("/instrument-operator/products/", "/io/products/"),
        ("/engineering/", "/io/engineering/"),
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
        ("/io/", "Instrument<br>Operator"),
        ("/io/products/", "Instrument<br>Operator"),  # no area suffix
        ("/io/engineering/configuration/", "Instrument<br>Operator"),
        ("/to/", "Telescope<br>Operator"),
        ("/io/engineering/", "Instrument<br>Operator"),
    ],
)
def test_header_text_is_just_the_role(client: Client, url: str, heading: str) -> None:
    html = client.get(url).content.decode()
    assert f'<div class="ui-title">{heading}</div>' in html


@pytest.mark.parametrize(
    ("url", "has_lt"), [("/io/", True), ("/io/engineering/", True), ("/to/", False)]
)
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
    assert "serverView" in html and ">Server:</span>" in html and ">Server</h6>" in html
    assert "wilds-control: " not in html


@pytest.mark.parametrize(
    "url", ["/to/", "/io/", "/io/products/", "/io/engineering/", "/io/engineering/calibration/"]
)
def test_no_template_comments_leak_into_the_page(client: Client, url: str) -> None:
    """Django's {# #} comments are single-line only; a multi-line one renders as visible text."""
    html = client.get(url).content.decode()
    assert "{#" not in html and "#}" not in html
    assert "{% comment" not in html and "{% endcomment" not in html


def test_header_says_control_not_wilds_control(client: Client) -> None:
    html = client.get("/to/").content.decode()  # the TO page shows who holds control
    assert "$store.wilds.controlView" in html and ">Control:</span>" in html
    assert "WILDS control" not in html
    for url in ("/io/", "/io/engineering/"):  # the operator's pages show this session's status
        html = client.get(url).content.decode()
        assert "$store.session.controlView" in html and ">Control:</span>" in html
        assert "WILDS control" not in html


def test_io_topbar_shows_this_sessions_control_status(client: Client) -> None:
    html = client.get("/io/").content.decode()
    script = Path(finders.find("wilds/js/session.js")).read_text()
    for word in ("granted", "requested", "refused"):
        assert f"{word}:" in script
    assert "$store.session.controlView" in html and ">Control:</span>" in html
    assert "$store.wilds.controlView" not in html  # this page shows the session's own status
    assert "Held by " in script


def test_session_badge_has_the_person_above_the_code(client: Client) -> None:
    html = client.get("/io/").content.decode()
    name = html.index('x-text="$store.session.name"')
    code = html.index('x-text="$store.session.code"')
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


def test_io_sidebar_has_only_operations_and_products(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert 'href="/io/operations/"' in html and 'href="/io/products/"' in html
    for gone in ("/io/calibration/", "/io/configuration/", "/io/engineering/"):
        assert f'href="{gone}"' not in html


def test_monitoring_is_in_the_main_sidebar_and_engineering_has_calibration_and_configuration(
    client: Client,
) -> None:
    html = client.get("/io/engineering/").content.decode()  # opens on Calibration
    for page in ("calibration", "configuration"):
        assert f'href="/io/engineering/{page}/"' in html
    assert 'sidebar-subitem active" title="Calibration"' in html
    assert 'title="Monitoring"' in html and 'sidebar-subitem" title="Monitoring"' not in html
    monitoring = client.get("/io/monitoring/").content.decode()
    assert 'sidebar-item active" title="Monitoring"' in monitoring
    assert "<h4 class=\"mb-0\">Monitoring</h4>" in monitoring
    assert (
        'sidebar-subitem active" title="Calibration"'
        in client.get("/io/engineering/calibration/").content.decode()
    )
    # the group is a submenu of the Instrument Operator's sidebar, next to Operations and Products
    assert 'title="Operations"' in html and 'title="Products"' in html
    assert (
        'sidebar-item active" data-bs-toggle="collapse"' in html
    )  # and is marked while one of its pages is shown


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("/io/calibration/", "/io/engineering/calibration/"),
        ("/io/configuration/", "/io/engineering/configuration/"),
    ],
)
def test_calibration_and_configuration_moved_from_io_to_eng(
    client: Client, old: str, new: str
) -> None:
    response = client.get(old)
    assert response.status_code == 302 and response["Location"] == new
    assert client.get(new).status_code == 200


def test_eng_pages_have_their_own_content(client: Client) -> None:
    mon = client.get("/io/monitoring/").content.decode()
    cal = client.get("/io/engineering/calibration/").content.decode()
    cfg = client.get("/io/engineering/configuration/").content.decode()
    assert "Archon VIS" in mon and "cal_lamps" not in mon and "cfg_slit" not in mon
    for action in (
        "lamps",
        "focus",
        "bias",
        "dark",
        "flat",
    ):  # the slit tab is a real panel now
        assert f"$store.wilds.action('cal_{action}')" in cal
    assert "cal_slit" not in cal
    assert "cal_lamps" not in cfg
    # the placeholder buttons gave way to the generic settings form
    assert "cfg_" not in cfg
    assert 'x-data="settingsForm()"' in cfg and "wilds/js/config.js" in cfg
    assert "settingsForm" not in mon and "settingsForm" not in cal


def test_unknown_eng_page_is_404(client: Client) -> None:
    assert client.get("/io/engineering/nothing/").status_code == 404


@pytest.mark.parametrize(
    "url", ["/to/", "/io/", "/io/products/", "/io/engineering/", "/io/monitoring/"]
)
def test_pages_carry_the_attention_band_and_load_jobs_js(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'x-data="attentionBand()"' in html
    assert "wilds/js/jobs.js" in html and "wilds/css/activity.css" in html


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/products/", "/io/monitoring/"])
def test_the_activity_board_lists_the_components(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'x-data="activityBoard()"' in html
    assert html.count('id="board-components"') == 1
    for key in ("guide-camera", "slit", "adc", "lamps", "archon-vis", "archon-uv"):
        assert key in html


def test_the_old_component_cards_are_gone(client: Client) -> None:
    for url in ("/to/", "/io/", "/io/monitoring/"):
        assert "ui-card" not in client.get(url).content.decode()


def test_the_to_page_can_see_but_not_cancel(client: Client) -> None:
    # No session store on /to, so the board's Cancel buttons are never drawn there.
    assert "wilds/js/session.js" not in client.get("/to/").content.decode()
    assert "$store.jobs.showCancel" in client.get("/to/").content.decode()


def test_the_test_job_card_is_on_the_io_operations_page_in_development(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert "$store.wilds.opmode === 'development'" in html
    assert "startDemo('done', queue)" in html and "startDemo('fail', queue)" in html
    assert "startDemo" not in client.get("/io/products/").content.decode()


def test_request_control_is_hidden_once_control_is_granted(
    client: Client,
) -> None:
    html = client.get("/io/").content.decode()
    wrapper = "x-show=\"$store.session.controlStatus !== 'granted'\""
    assert wrapper in html
    # the button sits inside that wrapper, not beside it
    assert html.index(wrapper) < html.index('@click="$store.session.requestControl()"')


@pytest.mark.parametrize(
    "url", ["/io/", "/io/products/", "/io/engineering/", "/io/engineering/calibration/"]
)
def test_operator_and_engineering_pages_have_the_camera_dock(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'class="camera-dock"' in html and "wilds/js/camera.js" in html
    assert html.index('id="sidebar"') < html.index('class="camera-dock"')  # sidebar, main, dock


def test_engineering_pages_use_the_app_tooltips_not_native_titles(client: Client) -> None:
    for url in (
        "/io/engineering/",
        "/io/engineering/calibration/",
        "/io/engineering/configuration/",
    ):
        html = client.get(url).content.decode()
        assert 'title="Undo' not in html, url
    cfg = client.get("/io/engineering/configuration/").content.decode()
    assert "x-tooltip=\"'Undo this edit'\"" in cfg and 'x-tooltip="f.help"' in cfg
    assert 'x-tooltip="whyNotSave"' in cfg


def test_session_no_longer_lists_the_replaced_cfg_actions() -> None:
    text = Path(finders.find("wilds/js/session.js")).read_text()
    assert "cfg_" not in text


def test_the_form_ignores_a_status_older_than_its_own_save() -> None:
    text = Path(finders.find("wilds/js/config.js")).read_text()
    assert "seen <= this.loaded.version" in text


def test_x_show_beats_bootstrap_display_utilities() -> None:
    """d-flex is !important, so without this rule an x-show="false" d-flex element stays visible
    (the settings form's 'changed elsewhere' banner was always shown)."""
    css = Path(finders.find("wilds/css/main.css")).read_text()
    assert '[x-show][style*="display: none"] { display: none !important; }' in css


def test_the_configuration_panel_chooses_components_with_tabs(client: Client) -> None:
    cfg = client.get("/io/engineering/configuration/").content.decode()
    assert 'class="nav nav-tabs' in cfg and 'role="tab"' in cfg


def test_a_group_of_settings_is_a_pane_of_its_own(client: Client) -> None:
    """The camera keeps separate single-frame and video settings; the form shows each group in
    its own pane, and the dock's exposure and gain are the video ones."""
    cfg = client.get("/io/engineering/configuration/").content.decode()
    assert 'x-for="f in paneFields"' in cfg and 'x-for="p in panes"' in cfg
    text = Path(finders.find("wilds/js/config.js")).read_text()
    assert "get panes()" in text and "!f.nullable" in text
    dock = client.get("/io/engineering/configuration/").content.decode()
    assert "s.settings.video.exposure_s" in dock
    assert "{ video: { exposure_s: Number(exposure) } }" in dock


@pytest.mark.parametrize("url", ["/", "/to/", "/io/monitoring/"])
def test_every_page_header_shows_wilds_opstate(client: Client, url: str) -> None:
    page = client.get(url, follow=True).content.decode()
    assert "$store.wilds.opView" in page and ">WILDS:</span>" in page


def test_the_to_page_offers_startup_and_shutdown_by_opstate(client: Client) -> None:
    to = client.get("/to/").content.decode()
    assert '@click="toggleWilds()"' in to  # one button, see the test of the WILDS panel below
    text = Path(finders.find("wilds/js/to.js")).read_text()
    # shut down when started up, start up in any other state
    assert 'this.opstate === "startedup"' in text and "this.startup()" in text
    assert "/system/startup" in text and "/system/shutdown" in text


def test_the_header_content_is_centred_vertically_in_the_bar() -> None:
    """The bar is taller than its content, so the logo and the two-line Operator titles hang from
    the top unless the bar centres them."""
    css = Path(finders.find("wilds/css/main.css")).read_text()
    header = css[css.index(".ui-header {") : css.index("}", css.index(".ui-header {"))]
    assert "display: flex" in header and "align-items: center" in header


def test_js9_is_vendored_with_its_licence_and_files() -> None:
    js9 = Path(finders.find("vendor/js9-3.9/js9.min.js")).parent
    for name in (
        "LICENSE",
        "js9support.min.js",
        "js9plugins.min.js",
        "js9.css",
        "js9support.css",
        "astroemw.js",
        "astroemw.wasm",
        "js9worker.js",
    ):
        assert (js9 / name).is_file(), name
    assert "MIT" in (js9 / "LICENSE").read_text()
    assert (js9 / "images" / "gears.png").is_file()


def test_the_viewer_page_loads_js9_and_takes_a_path_on_control(client: Client) -> None:
    page = client.get("/viewer/?path=/guide-camera/frames/1").content.decode()
    for part in (
        "vendor/js9-3.9/js9.min.js",
        "vendor/js9-3.9/js9.css",
        "JS9Menubar",
        'class="JS9"',
        "wilds/js/fits_viewer.js",
        "data-control-url",
    ):
        assert part in page, part
    script = Path(finders.find("wilds/js/fits_viewer.js")).read_text()
    assert 'path.startsWith("/")' in script and 'path.startsWith("//")' in script  # only control
    assert "JS9.Preload" in script and "zscale" in script


def test_the_viewer_has_a_fits_header_button_that_shows_text_only(client: Client) -> None:
    page = client.get("/viewer/?path=/guide-camera/frames/1").content.decode()
    assert 'id="viewer-header-btn"' in page and 'id="viewer-header-text"' in page
    script = Path(finders.find("wilds/js/fits_viewer.js")).read_text()
    assert "GetFITSHeader" in script and "innerHTML" not in script


def test_the_dock_has_a_splitter_that_keeps_its_width(client: Client) -> None:
    dock = client.get("/io/engineering/calibration/").content.decode()
    assert 'class="dock-splitter"' in dock and 'role="separator"' in dock
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "wilds-camera-width" in script and "setPointerCapture" in script


def test_every_page_shows_the_cover_pill_and_the_calibration_card_moves_the_cover(
    client: Client,
) -> None:
    for url in ("/io/engineering/calibration/", "/to/"):
        page = client.get(url).content.decode()
        assert "lightView" in page, url  # the header's Light pill says what the cover does
        assert "Light cover:" not in page, url  # and the old Light cover pill is gone from it
    assert (
        "coverView" in client.get("/io/engineering/calibration/").content.decode()
    )  # the Cover tab's pill
    card = client.get("/io/engineering/calibration/").content.decode()
    assert "move('close')" in card and "move('open')" in card
    assert "Close the cover" in card and "Open the cover" in card
    status = Path(finders.find("wilds/js/status.js")).read_text()
    assert "cover:" in status and "get coverView" in status and "light_path" not in status


def test_the_engineering_calibration_page_has_a_cover_tab(client: Client) -> None:
    page = client.get("/io/engineering/calibration/").content.decode()
    assert "['cover', 'Cover']" in page and "tab === 'cover'" in page
    assert "wilds/js/cover.js" in page and 'x-data="coverControl"' in page


def test_moving_the_cover_first_reminds_the_operator_to_tell_the_to(client: Client) -> None:
    script = Path(finders.find("wilds/js/cover.js")).read_text()
    assert "uiConfirm(" in script and "Telescope Operator" in script
    assert script.index("uiConfirm(") < script.index("fetch(`${base}/cover/")
    assert "/cover/${action}" in script


def test_the_to_page_has_no_light_dropdown_any_more(client: Client) -> None:
    page = client.get("/to/").content.decode()
    assert "Light to WILDS" not in page and "ui-pill-select-box" not in page
    script = Path(finders.find("wilds/js/to.js")).read_text()
    assert "/light-path" not in script and "toLight" not in script


def test_the_calibration_page_has_the_guide_camera_card(client: Client) -> None:
    page = client.get("/io/engineering/calibration/").content.decode()
    assert 'x-data="guideCalibration()"' in page and "wilds/js/guide_calibration.js" in page
    assert "Take " in page and "Calibration sessions" in page
    assert "guideCalibration" not in client.get("/io/monitoring/").content.decode()


def test_the_slit_tab_has_the_stage_and_the_optics_calibration(client: Client) -> None:
    page = client.get("/io/engineering/calibration/").content.decode()
    assert 'x-data="slitStage()"' in page and 'x-data="opticsCalibration()"' in page
    assert "wilds/js/optics_calibration.js" in page
    assert "Apply to the calibration" in page and "Measuring gap" in page
    assert "Closed-slit frame" in page and "Open-slit frame" in page
    script = Path(finders.find("wilds/js/optics_calibration.js")).read_text()
    for path in (
        "/calibration/optics",
        "/calibration/optics/apply",
        "/calibration/optics/last",
        "/slit/move",
    ):
        assert path in script
    assert "opticsCalibration" not in client.get("/io/monitoring/").content.decode()


def test_the_overlay_follows_the_stages_width_and_the_measured_slit_angle() -> None:
    script = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "slit?.width_arcsec" in script and "slit_angle_deg" in script and "zeroError" in script


def test_the_dock_and_the_viewer_draw_the_detected_slit(client: Client) -> None:
    dock = client.get("/io/engineering/calibration/").content.decode()
    assert (
        'aria-label="Detected slit"' in dock and "slit-detected" in dock and "detectedView" in dock
    )
    slit = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "open_frame_id" in slit and "perimeter(" in slit  # only on the frame it was found in
    viewer = Path(finders.find("wilds/js/fits_viewer.js")).read_text()
    assert 'params.get("perimeter")' in viewer and "AddRegions" in viewer
    cam = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "perimeter" in cam and "&perimeter=" in cam
    calib = Path(finders.find("wilds/js/optics_calibration.js")).read_text()
    assert 'Alpine.store("slit").detected' in calib


def test_the_dock_can_open_the_latest_frame_in_the_viewer(client: Client) -> None:
    dock = client.get("/io/monitoring/").content.decode()
    assert "/viewer/?path=" in dock and "last_frame_id" in dock


def test_the_activity_board_has_a_shutter_column(client: Client) -> None:
    assert '"key": "shutter"' in client.get("/io/monitoring/").content.decode()


def test_the_viewer_may_be_framed_by_our_own_pages_only(client: Client) -> None:
    """The guide-camera dock shows it in a frame; Django's default X-Frame-Options: DENY would
    leave a broken-page icon there."""
    assert client.get("/viewer/").headers["X-Frame-Options"] == "SAMEORIGIN"
    assert client.get("/io/engineering/").headers["X-Frame-Options"] == "DENY"


def test_the_dock_shows_stored_frames_in_place_of_the_video(client: Client) -> None:
    dock = client.get("/io/monitoring/").content.decode()
    assert "$store.camera.view" in dock and "Stored frame" in dock and "camera.live()" in dock
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "last_calibration_frame_id" in script and "guide-camera-dark" in script
    assert "/viewer/?embed=1" in script and "&w=" in script


def test_the_calibration_page_has_a_tab_per_thing_to_calibrate(client: Client) -> None:
    page = client.get("/io/engineering/calibration/").content.decode()
    for label in ("Guide camera", "Lamps", "Slit", "ADC", "Focus", "Science cameras"):
        assert f"'{label}'" in page, label
    assert 'role="tab"' in page and "wilds-cal-tab" in page
    # the science cameras' dark, bias and flat are under their own tab, the guide camera's card under its
    science = page[page.index("tab === 'science-cameras'") :]
    for action in ("cal_dark", "cal_bias", "cal_flat"):
        assert action in science
    assert 'x-data="guideCalibration()"' in page[: page.index("tab === 'lamps'")]


def test_the_streaming_controls_are_not_shown_beside_a_stored_frame(client: Client) -> None:
    """Start, exposure, gain and the cooler belong to the video; a stored frame replaces them."""
    dock = client.get("/io/monitoring/").content.decode()
    controls = dock[dock.index('class="dock-controls"') : dock.index('class="dock-controls"') + 160]
    assert "!$store.camera.view" in controls


def test_each_entry_has_a_discard_button_that_asks_first(client: Client) -> None:
    page = client.get("/io/engineering/calibration/").content.decode()
    assert '@click="discard(e)"' in page and "Discard these frames" in page
    script = Path(finders.find("wilds/js/guide_calibration.js")).read_text()
    assert "uiConfirm(" in script and '"DELETE"' in script
    # the confirmation comes before the request
    assert script.index("uiConfirm(") < script.index('api("DELETE"')
    # a dock that was showing the discarded entry goes back to the video
    assert "camera.live()" in script


def test_every_header_indicator_is_the_same_pill(client: Client) -> None:
    html = client.get("/io/engineering/").content.decode()
    for label in ("Control", "TO", "TCS", "Mode", "WILDS", "Light"):
        assert f'<span class="pill-label">{label}:</span>' in html, label
    assert 'class="badge ui-pill' in html and 'pill-label">Server:' in html
    css = Path(finders.find("wilds/css/tokens.css")).read_text()
    assert "text-transform: uppercase" in css


def test_the_operations_page_has_a_tab_per_operation_with_test_for_development(
    client: Client,
) -> None:
    page = client.get("/io/operations/").content.decode()
    for tab in (
        "'acquisition', 'Acquisition'",
        "'focus', 'Focus'",
        "'guiding', 'Guiding'",
        "'test', 'Test'",
    ):
        assert tab in page, tab
    assert "wilds-ops-tab" in page and "opmode === 'development'" in page
    assert "Test job" in page  # inside the Test tab
    assert "Start guiding" in page and "Stop guiding" in page  # greyed until control can guide
    assert "panels come here" not in page


def test_the_acquisition_tab_has_the_target_entry_and_the_slew(client: Client) -> None:
    page = client.get("/io/operations/").content.decode()
    assert 'x-data="acquisitionTarget()"' in page and "wilds/js/acquisition.js" in page
    for part in ("Resolve", "RA (J2000)", "Slit PA", '@click="slew()"'):
        assert part in page, part
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    assert "/telescope/slew" in script and "/resolve?name=" in script and "Slew" in script
    # only the coordinates go to the server: the name is for Resolve alone
    assert "{ ...t, rot_pa: Number(this.pa) }" in script and "name: this.name" not in script
    assert "acquisitionTarget" not in client.get("/io/products/").content.decode()


def test_the_acquisition_tab_adjusts_offsets_and_rotation_with_the_slit_overlay(
    client: Client,
) -> None:
    page = client.get("/io/operations/").content.decode()
    for part in (
        'x-data="acquisitionOffsets()"',
        'x-data="acquisitionRotation()"',
        "Adjust offsets",
        "Adjust rotation",
        "Start acquisition",
    ):
        assert part in page, part
    assert "$store.slit.active = shown === 'acquisition'" in page
    dock = client.get("/io/operations/").content.decode()
    assert (
        "wilds/js/slit.js" in dock and 'class="dock-overlay"' in dock and ":view-box.camel" in dock
    )
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    assert (
        "/telescope/offset" in script
        and "/telescope/rotator" in script
        and "/telescope/offset/absorb" in script
    )
    slit = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "/config/guide-camera/cal" in slit and "setPointerCapture" in slit


def test_the_to_page_shows_the_tcs_but_has_nothing_to_approve(client: Client) -> None:
    page = client.get("/to/").content.decode()
    assert "tcsView" in page and "answerPending" not in page and "Approve" not in page
    script = Path(finders.find("wilds/js/to.js")).read_text()
    assert "/dev/telescope/" not in script and "answerPending" not in script


def test_the_live_view_can_be_zoomed_and_panned(client: Client) -> None:
    dock = client.get("/io/operations/").content.decode()
    for part in (
        'class="dock-zoombar"',
        'class="dock-zoom"',
        "zoomToSlit()",
        "zoomReset()",
        "$store.camera.wheel($event)",
        "startPan($event)",
    ):
        assert part in dock, part
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "setZoom(" in script and "get zoomStyle()" in script


def test_the_acquisition_tab_has_the_slit_control(client: Client) -> None:
    page = client.get("/io/operations/").content.decode()
    assert 'x-data="acquisitionSlit()"' in page and 'id="slit-slider"' in page
    assert (
        'aria-label="Opening in microns"' in page and 'aria-label="Opening in arcseconds"' in page
    )
    assert "apply()" in page
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    assert "/slit/move" in script and "% open" in script


def test_explanations_are_an_info_icon_with_the_tooltip_on_it(client: Client) -> None:
    info = (Path(finders.find("wilds/css/tokens.css"))).read_text()
    assert ".ui-info-icon" in info
    dock = client.get("/io/operations/").content.decode()
    # the guide-camera dock's labels: the icon is inside the label, the tooltip is on the icon
    assert 'class="bi bi-info-circle ui-info-icon"' in dock
    assert "x-tooltip=\"'Exposure: 0.001 to 60 s'\"" in dock and 'style="cursor: help;"' not in dock


def test_the_cover_shows_where_its_state_comes_from_and_whether_the_light_reaches_wilds(
    client: Client,
) -> None:
    card = client.get("/io/engineering/calibration/").content.decode()
    assert "sensorText" in card and "lightPath" in card
    script = Path(finders.find("wilds/js/cover.js")).read_text()
    assert "c.sensed" in script and "to_wilds" in script
    status = Path(finders.find("wilds/js/status.js")).read_text()
    assert "get lightView" in status and "to_wilds === false" in status


def test_the_light_pill_says_whether_wilds_gets_light_from_the_cube(client: Client) -> None:
    html = client.get("/io/engineering/").content.decode()
    assert "$store.wilds.lightView" in html
    status = Path(finders.find("wilds/js/status.js")).read_text()
    view = status[status.index("get lightView()") : status.index("get tcsText()")]
    assert '"yes"' in view and "ui-success" in view and '"no"' in view and "ui-danger" in view
    assert "tip:" in view  # the reason, as a tooltip


def test_the_slit_overlay_draws_a_gap_that_grows_from_the_fixed_jaw(client: Client) -> None:
    script = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "slit_side" in script and "WORKING_WIDTH_ARCSEC" in script  # one jaw moves
    assert "d.gap_x" in script  # the calibration's gap is drawn about its own middle
    page = client.get("/io/engineering/calibration/").content.decode()
    assert "only one jaw moves" in page.lower()
    optics = Path(finders.find("wilds/js/optics_calibration.js")).read_text()
    assert "Fixed jaw edge x" in optics and "Gap grows to" in optics


def test_the_to_page_has_the_same_dock_and_its_activity_panel_at_the_bottom(client: Client) -> None:
    html = client.get("/to/").content.decode()
    assert 'class="camera-dock"' in html and "wilds/js/camera.js" in html  # the same dock
    assert html.count("activity_board") <= 1 and 'class="ui-bottom"' in html
    # the activity panel is below the main area (after the dock), not a column beside the controls
    assert html.index('class="camera-dock"') < html.index('class="ui-bottom"')
    assert html.index("Instrument activity") > html.index('class="camera-dock"')


def test_the_dock_has_a_start_stop_button_for_whoever_holds_control(client: Client) -> None:
    dock = client.get("/io/operations/").content.decode()
    head = dock[dock.index('class="dock-head"') : dock.index('class="dock-viewbar')]
    assert "$store.slit.canOperate" in head and "canStream" not in head  # one rule: a holder
    script = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "canStream" not in script
    body = script[script.index("get canOperate()") :]
    rule = body[: body.index("},")]
    assert "holder" in rule and "engineering" not in rule  # not the TO, not a viewer
    assert "$store.camera.start()" in head and "$store.camera.stop()" in head
    assert "bi-stop-fill" in head and "bi-play-fill" in head


def test_the_fixed_jaw_is_marked_apart_from_the_rest_of_the_slit_rectangle(client: Client) -> None:
    dock = client.get("/io/operations/").content.decode()
    assert 'class="slit-fixed"' in dock and "slit-fixed-pending" in dock
    css = Path(finders.find("wilds/css/camera.css")).read_text()
    assert ".slit-fixed" in css and ".slit-now" in css
    now = css[css.index(".slit-now") :].split("}")[0]
    fixed = css[css.index(".slit-fixed") :].split("}")[0]
    assert (
        now.split("stroke:")[1].split(";")[0] != fixed.split("stroke:")[1].split(";")[0]
    )  # another colour
    script = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "edge," in script  # the line is where the gap starts, turning with the rectangle


def test_the_io_slit_panel_is_scaled_to_the_stages_range_between_its_hard_stops(
    client: Client,
) -> None:
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    stage = script[script.index('Alpine.data("acquisitionSlit"') :]
    assert "get maxUm() { return this.slit?.max_um" in stage  # the upper hard stop, 4 arcsec
    assert "get minUm() { return this.slit?.min_um" in stage  # the lower one, 0.5 arcsec
    assert "open_um" not in stage and "s.max_um" not in stage
    page = client.get("/io/operations/").content.decode()
    assert "percent of its range" in page and "narrowest (" in page and "widest (" in page


def test_a_tooltip_that_is_open_is_not_touched_unless_its_text_changed(client: Client) -> None:
    script = Path(finders.find("wilds/js/ui.js")).read_text()
    directive = script[script.index('Alpine.directive("tooltip"') :].split("});\n});")[0]
    # the status stream re-evaluates every expression with each video frame; setContent re-shows
    # an open tooltip, so an unchanged text must return before it
    assert "if (text === last) return;" in directive
    assert directive.index("if (text === last) return;") < directive.index("setContent(")


def test_the_to_wilds_panel_has_one_button_for_the_action_that_applies(client: Client) -> None:
    page = client.get("/to/").content.decode()
    panel = page[page.index('class="bi bi-power me-2"></i>WILDS') : page.index("bi-person-check")]
    assert panel.count("<button") == 1  # not a Start up and a Shut down side by side
    assert "isStartedUp ? 'Shut down' : 'Start up'" in panel and "toggleWilds()" in panel
    script = Path(finders.find("wilds/js/to.js")).read_text()
    assert 'get isStartedUp() { return this.opstate === "startedup"; }' in script
    assert "this.isStartedUp ? this.shutdown() : this.startup()" in script


def test_nothing_in_the_gui_knows_an_engineering_mode_any_more(client: Client) -> None:
    for name in ("acquisition", "session", "status", "to", "slit", "cover", "optics_calibration"):
        script = Path(finders.find(f"wilds/js/{name}.js")).read_text()
        for gone in (
            "s.engineering",
            "this.engineering",
            "c.engineering",
            "enterEngineering",
            "hb.engineering",
            "view.engineering",
        ):
            assert gone not in script, (name, gone)
        assert "Engineering mode does not command" not in script


def test_a_pending_adjustment_survives_the_status_stream_after_a_job_has_finished(
    client: Client,
) -> None:
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    # Alpine's $watch calls back on every change of anything its getter read (the status stream
    # replaces the jobs about once a second), so "state is done" alone cleared the pending offset
    # and angle again and again after the first job. The job handled is remembered instead.
    assert "function whenDone(component, then)" in script and "id !== handled" in script
    assert script.count("whenDone(this,") == 2  # the offsets and the rotation panels
    assert (
        '(state) => { if (state === "done")' not in script
        and 'if (state === "done") {' not in script
    )
    optics = Path(finders.find("wilds/js/optics_calibration.js")).read_text()
    assert (
        "v !== this.calVersion" in optics
    )  # the calibration is read again only when its version moves


def test_the_sidebar_submenu_listeners_come_before_it_is_opened(client: Client) -> None:
    script = Path(finders.find("wilds/js/ui.js")).read_text()
    side = script[script.index('.querySelectorAll(".sidebar-submenu")') :]
    # opening the submenu of the page shown must turn its arrow: the listeners are attached first
    assert side.index('addEventListener("show.bs.collapse"') < side.index(".show();")


def test_the_operations_page_has_an_adc_tab_with_the_angles_and_the_tracking_switch(
    client: Client,
) -> None:
    html = client.get("/io/operations/").content.decode()
    assert "['adc', 'ADC']" in html and "shown === 'adc'" in html
    assert 'x-data="adcPanel()"' in html and "wilds/js/adc.js" in html
    for word in ("Pairs now", "They make", "Tracking", "Set by hand", 'aria-label="ADC tracking"'):
        assert word in html, word
    assert "setTracking($event.target.checked)" in html and "apply()" in html
    assert "adcMonitor" not in html  # the stage details are not the operator's tab


def test_the_stage_details_of_the_adc_are_on_monitoring(client: Client) -> None:
    html = client.get("/io/monitoring/").content.decode()
    assert 'x-data="adcMonitor()"' in html and "wilds/js/adc.js" in html
    assert "adcPanel" not in html
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    for detail in (
        "Stage 1 reads",
        "Stage 2 reads",
        "zero point",
        "Weather used",
        "Atmosphere",
        "Last look",
    ):
        assert detail in script, detail
    # Configuration does not load it; Calibration does, for the stage references
    assert "wilds/js/adc.js" not in client.get("/io/engineering/configuration/").content.decode()
    assert "adcMonitor" not in client.get("/io/engineering/calibration/").content.decode()


def test_the_adc_panel_refuses_a_hand_move_while_tracking_and_without_control(
    client: Client,
) -> None:
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    assert "Only the session holding control can command the ADC" in script
    assert "Tracking is on: switch it off to set the pairs by hand" in script
    assert "/adc/tracking" in script and "/adc/move" in script
    status = Path(finders.find("wilds/js/status.js")).read_text()
    assert "adc: null" in status


def test_the_adc_views_share_getters_by_descriptor_not_by_object_spread(client: Client) -> None:
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    # `{...common}` would run the getters once and freeze their values: the panel stayed "unknown"
    assert "...common" not in script and "getOwnPropertyDescriptors(common)" in script


def test_the_adc_is_optional_and_everything_that_relies_on_it_observes_the_installed_toggle(
    client: Client,
) -> None:
    adc = Path(finders.find("wilds/js/adc.js")).read_text()
    assert "get installed() { return this.adc?.installed !== false; }" in adc
    assert (
        'if (!this.installed) return "The ADC is not installed"' in adc
    )  # every command greyed, with the reason
    assert "not in the instrument" in adc  # the Monitoring card says so
    panel = client.get("/io/operations/").content.decode()
    assert 'x-show="!installed"' in panel and "Engineering → Configuration → adc" in panel
    assert ':disabled="!editing || !installed"' in panel  # Reset too
    assert "$store.wilds.adc?.installed === false" in panel  # the tab itself is dimmed
    board = client.get("/io/").content.decode()
    assert "absent(c.key)" in board  # the activity board's ADC card
    jobs = Path(finders.find("wilds/js/jobs.js")).read_text()
    assert "present === false" in jobs
    css = Path(finders.find("wilds/css/activity.css")).read_text()
    assert ".board-comp.absent" in css
    cal = client.get("/io/engineering/calibration/").content.decode()
    assert (
        'x-data="adcCalibration()"' in cal
        and "(Engineering → Configuration → adc → Installed)" in cal
    )


def test_calibration_adc_has_the_reference_to_the_stage_position_of_both_pairs(
    client: Client,
) -> None:
    cal = client.get("/io/engineering/calibration/").content.decode()
    assert "tab === 'adc'" in cal and 'x-data="adcCalibration()"' in cal
    assert "cal_adc" not in cal  # the placeholder button is gone
    for text in (
        "Reference to stage position",
        "Stage reads now",
        "Use the current reading",
        "Pair would be at",
    ):
        assert text in cal, text
    assert 'x-for="n in [1, 2]"' in cal  # one row per pair
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    block = script[
        script.index('Alpine.data("adcCalibration"') : script.index('Alpine.data("adcMonitor"')
    ]
    assert "zero${n}_deg" in block and "stage${n}_deg" in block
    assert (
        "PUT" in block and "/config/adc/cal" in block and "version: current.version" in block
    )  # versioned, recorded
    assert "Tracking is on" in block  # not while the pairs follow the telescope
    assert "wilds/js/adc.js" in cal


def test_calibration_adc_can_jog_a_stage_in_its_own_coordinates(client: Client) -> None:
    cal = client.get("/io/engineering/calibration/").content.decode()
    for text in (
        "Jog a stage",
        'aria-label="Step in degrees"',
        "go to",
        "jogBy(n, -1)",
        "jogBy(n, 1)",
        "goTo(n)",
    ):
        assert text in cal, text
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    block = script[
        script.index('Alpine.data("adcCalibration"') : script.index('Alpine.data("adcMonitor"')
    ]
    assert '"/adc/jog"' in block and "by_deg" in block and "to_deg" in block
    assert "Tracking is on: switch it off to jog a stage" in block  # as the server refuses it
    assert "whyNotCommand" in block  # not installed, not the holder: greyed out with the reason


def test_an_adc_command_shows_the_status_it_answers_with_at_once(client: Client) -> None:
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    # otherwise the buttons stay greyed "moving" until the status stream next says it has stopped
    assert 'if (data && "pair1_deg" in data && "tracking" in data) wilds().adc = data;' in script


@pytest.mark.parametrize("url", ["/io/", "/io/engineering/calibration/", "/to/"])
def test_the_dock_has_a_column_of_indicators_on_every_page_with_a_dock(
    client: Client, url: str
) -> None:
    html = client.get(url).content.decode()
    assert (
        'class="dock-body"' in html
        and 'class="dock-main"' in html
        and 'class="dock-column"' in html
    )
    assert html.index('class="dock-main"') < html.index(
        'class="dock-column"'
    )  # to the right of the content
    for name in ("adcIndicator", "slitIndicator", "coverIndicator"):
        assert f'x-data="{name}()"' in html, name
    assert "wilds/js/indicators.js" in html
    # shown at the full dock size only, and the head's button hides it
    assert "$store.camera.indicators && $store.camera.shown === 'dock'" in html
    assert 'aria-label="Indicators"' in html and "toggleIndicators()" in html


def test_the_adc_indicator_draws_two_rings_with_ticks_the_parallactic_line_and_the_dispersion_arrow(
    client: Client,
) -> None:
    html = client.get("/io/").content.decode()
    block = html[html.index('x-data="adcIndicator()"') : html.index('x-data="slitIndicator()"')]
    assert (
        block.count("ind-ring ind-ring-") == 2 and block.count("ind-tick ind-tick-") == 2
    )  # one per pair
    assert "ind-index" in block  # the fixed reference index the ticks start from
    assert "ringStyle(a1)" in block and "ringStyle(a2)" in block  # each turns with its own stage
    assert "ind-parallactic" in block and "ind-arrow" in block and "ind-goal" in block
    script = Path(finders.find("wilds/js/indicators.js")).read_text()
    assert "wrap(v - this[key])" in script  # unwrapped: a ring never turns the long way round
    assert "pair1_deg" in script and "pair2_deg" in script and "goal${n}_deg" in script
    css = Path(finders.find("wilds/css/camera.css")).read_text()
    assert "transition: transform 1s linear" in css and "prefers-reduced-motion" in css


def test_indicators_jump_to_their_panel_only_where_there_is_a_session(client: Client) -> None:
    script = Path(finders.find("wilds/js/indicators.js")).read_text()
    assert 'const linkable = () => !!Alpine.store("session");' in script  # the TO page has none
    assert (
        '"wilds-ops-tab", "adc"' in script
        and '"wilds-cal-tab", "slit"' in script
        and '"wilds-cal-tab", "cover"' in script
    )
    assert (
        "...base" not in script and "getOwnPropertyDescriptors" in script
    )  # getters, not their values
    assert "Click: the ADC tab" in script


def test_the_indicator_column_is_remembered_per_browser_and_the_adc_indicator_dims_when_not_installed(
    client: Client,
) -> None:
    camera = Path(finders.find("wilds/js/camera.js")).read_text()
    assert (
        'const INDICATORS_KEY = "wilds-dock-indicators"' in camera
        and "toggleIndicators()" in camera
    )
    html = client.get("/io/").content.decode()
    assert "absent: !installed" in html


def test_no_indicator_draws_svg_through_a_template(client: Client) -> None:
    # <template x-if> clones HTML elements: a <line> made that way is not SVG and never draws
    html = client.get("/io/").content.decode()
    column = html[html.index('class="dock-column"') : html.index("</aside>")]
    assert "x-if" not in column
    for part in (
        'class="ind-goal ind-tick-1" x-show="goal(1)"',
        'class="ind-parallactic" x-show="parallactic"',
    ):
        assert part in column, part
    assert (
        'y1="7" y2="16"' in column.replace('x1="50" ', "").replace(' x2="50" ', " ")
        or 'y1="7"' in column
    )  # the tick is on the ring


def test_the_parallactic_line_is_the_telescopes_own_and_does_not_need_adc_tracking(
    client: Client,
) -> None:
    script = Path(finders.find("wilds/js/indicators.js")).read_text()
    block = script[
        script.index('Alpine.data("adcIndicator"') : script.index('Alpine.data("slitIndicator"')
    ]
    # from the telescope's telemetry (a target has a parallactic angle whether or not the ADC tracks)
    assert "wilds().telescope?.telemetry" in block and "parallactic_angle_deg" in block
    parallactic = block[block.index("get parallactic()") : block.index("goal(n)")]
    assert "this.target" not in parallactic and "adc.target" not in parallactic
    assert "get parallacticDir()" in block and "direction_offset_deg" in block


def test_the_parallactic_line_is_orange_like_the_slits_fixed_jaw(client: Client) -> None:
    css = Path(finders.find("wilds/css/camera.css")).read_text()
    line = css[css.index(".dock-ind .ind-parallactic") :].split("}")[0]
    assert "stroke: #ff7a1a" in line  # the app's orange, as the fixed-jaw line of the slit overlay


def test_the_adc_scale_has_degree_marks_every_30_degrees_and_is_a_bit_thicker(
    client: Client,
) -> None:
    html = client.get("/io/").content.decode()
    block = html[html.index('x-data="adcIndicator()"') : html.index('x-data="slitIndicator()"')]
    assert (
        block.count('class="ind-mark"') == 8 and block.count('class="ind-mark ind-mark-major"') == 3
    )
    # 11 marks: 30, 60, 90 ... 330 degrees (the reference index is the 0): the 90s, 180 and 270 are longer
    css = Path(finders.find("wilds/css/camera.css")).read_text()
    scale = css[css.index(".dock-ind .ind-scale") :].split("}")[0]
    assert "stroke-width: 1.8" in scale  # was 1
    assert "x-for" not in block  # the marks are written out: a template does not make SVG


def test_operations_adc_can_park_both_pairs_at_their_reference(client: Client) -> None:
    html = client.get("/io/operations/").content.decode()
    panel = html[html.index('x-data="adcPanel()"') :]
    assert '@click="park()"' in panel and "Park" in panel and "whyNotPark" in panel
    # Reset is still only for undoing typed values
    assert ':disabled="!editing || !installed" @click="reset()"' in panel
    script = Path(finders.find("wilds/js/adc.js")).read_text()
    block = script[
        script.index('Alpine.data("adcPanel"') : script.index('Alpine.data("adcCalibration"')
    ]
    assert "{ pair1_deg: 0, pair2_deg: 0 }" in block  # both pairs, to the reference
    assert (
        "The pairs are already at their reference" in block and "whyNotMove" in block
    )  # greyed out like the other moves
    assert "nearZero" in script


def test_a_horizontal_line_separates_the_indicators_in_the_column(client: Client) -> None:
    css = Path(finders.find("wilds/css/camera.css")).read_text()
    rule = css[css.index(".dock-ind + .dock-ind") :].split("}")[0]
    assert (
        "border-top: 1px solid var(--ui-border)" in rule
    )  # between each indicator and the one above
    html = client.get("/io/").content.decode()
    column = html[html.index('class="dock-column"') : html.index("</aside>")]
    assert (
        column.count('class="dock-ind"') == 3
    )  # so two lines: none above the first or below the last
