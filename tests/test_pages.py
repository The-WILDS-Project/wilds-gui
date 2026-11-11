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
    "url", ["/to/", "/io/", "/io/products/", "/eng/", "/eng/calibration/", "/eng/configuration/"]
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
    for url in ("/io/", "/eng/", "/to/"):
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
        ("/eng/calibration/", "WILDS - Engineering"),
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


def test_eng_page_asks_for_the_passphrase(client: Client) -> None:
    html = client.get("/eng/").content.decode()
    assert "$store.session.enterEngineering(this.passphrase)" in html
    assert "$store.session.release()" in html
    assert "$store.wilds.warnings" in html  # configuration warnings


def test_to_online_status_is_in_the_header_except_on_the_to_page(client: Client) -> None:
    assert "$store.wilds.toView" in client.get("/io/").content.decode()
    assert "$store.wilds.toView" in client.get("/eng/").content.decode()
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
        ("/engineering/calibration/", "/eng/calibration/"),
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
        ("/io/", "Instrument<br>Operator"),
        ("/io/products/", "Instrument<br>Operator"),  # no area suffix
        ("/eng/configuration/", "Engineering"),
        ("/to/", "Telescope<br>Operator"),
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
    assert "serverView" in html and ">Server:</span>" in html and ">Server</h6>" in html
    assert "wilds-control: " not in html


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/products/", "/eng/", "/eng/calibration/"])
def test_no_template_comments_leak_into_the_page(client: Client, url: str) -> None:
    """Django's {# #} comments are single-line only; a multi-line one renders as visible text."""
    html = client.get(url).content.decode()
    assert "{#" not in html and "#}" not in html
    assert "{% comment" not in html and "{% endcomment" not in html


def test_header_says_control_not_wilds_control(client: Client) -> None:
    for url in ("/to/", "/eng/"):  # these show who holds control
        html = client.get(url).content.decode()
        assert "$store.wilds.controlView" in html and ">Control:</span>" in html
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


def test_io_sidebar_has_only_operations_and_products(client: Client) -> None:
    html = client.get("/io/").content.decode()
    assert 'href="/io/operations/"' in html and 'href="/io/products/"' in html
    for gone in ("/io/calibration/", "/io/configuration/", "/io/engineering/"):
        assert f'href="{gone}"' not in html


def test_eng_sidebar_has_monitoring_calibration_and_configuration(client: Client) -> None:
    html = client.get("/eng/").content.decode()
    for page in ("monitoring", "calibration", "configuration"):
        assert f'href="/eng/{page}/"' in html
    assert 'sidebar-item active" title="Monitoring"' in html
    assert (
        'sidebar-item active" title="Calibration"'
        in client.get("/eng/calibration/").content.decode()
    )


@pytest.mark.parametrize(
    ("old", "new"),
    [("/io/calibration/", "/eng/calibration/"), ("/io/configuration/", "/eng/configuration/")],
)
def test_calibration_and_configuration_moved_from_io_to_eng(
    client: Client, old: str, new: str
) -> None:
    response = client.get(old)
    assert response.status_code == 302 and response["Location"] == new
    assert client.get(new).status_code == 200


def test_eng_pages_have_their_own_content(client: Client) -> None:
    mon = client.get("/eng/").content.decode()
    cal = client.get("/eng/calibration/").content.decode()
    cfg = client.get("/eng/configuration/").content.decode()
    assert "Archon VIS" in mon and "cal_lamps" not in mon and "cfg_slit" not in mon
    for action in ("lamps", "slit", "adc", "focus", "bias", "dark", "flat"):
        assert f"$store.wilds.action('cal_{action}')" in cal
    assert "cal_lamps" not in cfg and "Archon VIS" not in cal
    # the placeholder buttons gave way to the generic settings form
    assert "cfg_" not in cfg
    assert 'x-data="settingsForm()"' in cfg and "wilds/js/config.js" in cfg
    assert "settingsForm" not in mon and "settingsForm" not in cal


def test_unknown_eng_page_is_404(client: Client) -> None:
    assert client.get("/eng/nothing/").status_code == 404


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/products/", "/eng/", "/eng/monitoring/"])
def test_pages_carry_the_attention_band_and_load_jobs_js(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'x-data="attentionBand()"' in html
    assert "wilds/js/jobs.js" in html and "wilds/css/activity.css" in html


@pytest.mark.parametrize("url", ["/to/", "/io/", "/io/products/", "/eng/monitoring/"])
def test_the_activity_board_lists_the_components(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'x-data="activityBoard()"' in html
    assert html.count('id="board-components"') == 1
    for key in ("guide-camera", "slit", "adc", "lamps", "archon-vis", "archon-uv"):
        assert key in html


def test_the_old_component_cards_are_gone(client: Client) -> None:
    for url in ("/to/", "/io/", "/eng/monitoring/"):
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


def test_request_control_is_hidden_once_control_is_granted(client: Client) -> None:
    html = client.get("/io/").content.decode()
    wrapper = "x-show=\"$store.session.controlStatus !== 'granted'\""
    assert wrapper in html
    # the button sits inside that wrapper, not beside it
    assert html.index(wrapper) < html.index('@click="$store.session.requestControl()"')


@pytest.mark.parametrize("url", ["/io/", "/io/products/", "/eng/", "/eng/calibration/"])
def test_operator_and_engineering_pages_have_the_camera_dock(client: Client, url: str) -> None:
    html = client.get(url).content.decode()
    assert 'class="camera-dock"' in html and "wilds/js/camera.js" in html
    assert html.index('id="sidebar"') < html.index('class="camera-dock"')  # sidebar, main, dock


def test_the_to_page_has_no_camera_dock(client: Client) -> None:
    assert "camera-dock" not in client.get("/to/").content.decode()


def test_engineering_pages_use_the_app_tooltips_not_native_titles(client: Client) -> None:
    for url in ("/eng/", "/eng/calibration/", "/eng/configuration/"):
        html = client.get(url).content.decode()
        assert 'title="Undo' not in html, url
    cfg = client.get("/eng/configuration/").content.decode()
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
    cfg = client.get("/eng/configuration/").content.decode()
    assert 'class="nav nav-tabs' in cfg and 'role="tab"' in cfg


def test_a_group_of_settings_is_a_pane_of_its_own(client: Client) -> None:
    """The camera keeps separate single-frame and video settings; the form shows each group in
    its own pane, and the dock's exposure and gain are the video ones."""
    cfg = client.get("/eng/configuration/").content.decode()
    assert 'x-for="f in paneFields"' in cfg and 'x-for="p in panes"' in cfg
    text = Path(finders.find("wilds/js/config.js")).read_text()
    assert "get panes()" in text and "!f.nullable" in text
    dock = client.get("/eng/configuration/").content.decode()
    assert "s.settings.video.exposure_s" in dock
    assert "{ video: { exposure_s: Number(exposure) } }" in dock


@pytest.mark.parametrize("url", ["/", "/to/", "/eng/monitoring/"])
def test_every_page_header_shows_wilds_opstate(client: Client, url: str) -> None:
    page = client.get(url, follow=True).content.decode()
    assert "$store.wilds.opView" in page and ">WILDS:</span>" in page


def test_the_to_page_offers_startup_and_shutdown_by_opstate(client: Client) -> None:
    to = client.get("/to/").content.decode()
    assert '@click="startup()"' in to and '@click="shutdown()"' in to
    text = Path(finders.find("wilds/js/to.js")).read_text()
    # start up unless started up already, shut down unless shut down already
    assert 'this.opstate === "startedup"' in text and 'this.opstate === "shutdown"' in text
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
    dock = client.get("/eng/calibration/").content.decode()
    assert 'class="dock-splitter"' in dock and 'role="separator"' in dock
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "wilds-camera-width" in script and "setPointerCapture" in script


def test_every_page_shows_the_light_pill_and_the_calibration_card_asks_the_to(client: Client) -> None:
    for url in ("/eng/calibration/", "/to/"):
        assert "lightView" in client.get(url).content.decode(), url
    card = client.get("/eng/calibration/").content.decode()
    assert "asLight('block-request')" in card and "asLight('restore-request')" in card
    assert "Ask the TO to block the light" in card and "Ask the TO to restore the light" in card
    status = Path(finders.find("wilds/js/status.js")).read_text()
    assert "light_path" in status and "get lightView" in status


def test_the_to_page_answers_light_requests(client: Client) -> None:
    page = client.get("/to/").content.decode()
    assert "Light to WILDS" in page and "lightDone()" in page and "lightRefuse()" in page
    script = Path(finders.find("wilds/js/to.js")).read_text()
    assert "/light-path/acknowledge" in script and "/light-path/refuse" in script
    assert "/light-path/state" in script


def test_the_calibration_page_has_the_guide_camera_card(client: Client) -> None:
    page = client.get("/eng/calibration/").content.decode()
    assert 'x-data="guideCalibration()"' in page and "wilds/js/guide_calibration.js" in page
    assert "Take " in page and "Calibration sessions" in page
    assert "guideCalibration" not in client.get("/eng/monitoring/").content.decode()


def test_the_dock_can_open_the_latest_frame_in_the_viewer(client: Client) -> None:
    dock = client.get("/eng/monitoring/").content.decode()
    assert "/viewer/?path=" in dock and "last_frame_id" in dock


def test_the_activity_board_has_a_shutter_column(client: Client) -> None:
    assert '"key": "shutter"' in client.get("/eng/monitoring/").content.decode()


def test_the_viewer_may_be_framed_by_our_own_pages_only(client: Client) -> None:
    """The guide-camera dock shows it in a frame; Django's default X-Frame-Options: DENY would
    leave a broken-page icon there."""
    assert client.get("/viewer/").headers["X-Frame-Options"] == "SAMEORIGIN"
    assert client.get("/eng/").headers["X-Frame-Options"] == "DENY"


def test_the_dock_shows_stored_frames_in_place_of_the_video(client: Client) -> None:
    dock = client.get("/eng/monitoring/").content.decode()
    assert "$store.camera.view" in dock and "Stored frame" in dock and "camera.live()" in dock
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "last_calibration_frame_id" in script and "guide-camera-dark" in script
    assert "/viewer/?embed=1" in script and "&w=" in script


def test_the_calibration_page_has_a_tab_per_thing_to_calibrate(client: Client) -> None:
    page = client.get("/eng/calibration/").content.decode()
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
    dock = client.get("/eng/monitoring/").content.decode()
    controls = dock[dock.index('class="dock-controls"') : dock.index('class="dock-controls"') + 160]
    assert "!$store.camera.view" in controls


def test_each_entry_has_a_discard_button_that_asks_first(client: Client) -> None:
    page = client.get("/eng/calibration/").content.decode()
    assert '@click="discard(e)"' in page and "Discard these frames" in page
    script = Path(finders.find("wilds/js/guide_calibration.js")).read_text()
    assert "uiConfirm(" in script and '"DELETE"' in script
    # the confirmation comes before the request
    assert script.index("uiConfirm(") < script.index('api("DELETE"')
    # a dock that was showing the discarded entry goes back to the video
    assert "camera.live()" in script


def test_every_header_indicator_is_the_same_pill(client: Client) -> None:
    html = client.get("/eng/").content.decode()
    for label in ("Control", "TO", "TCS", "WILDS", "Light"):
        assert f'<span class="pill-label">{label}:</span>' in html, label
    assert 'class="badge ui-pill' in html and 'pill-label">Server:' in html
    css = Path(finders.find("wilds/css/tokens.css")).read_text()
    assert "text-transform: uppercase" in css


def test_the_operations_page_has_a_tab_per_operation_with_test_for_development(client: Client) -> None:
    page = client.get("/io/operations/").content.decode()
    for tab in ("'acquisition', 'Acquisition'", "'focus', 'Focus'", "'guiding', 'Guiding'", "'test', 'Test'"):
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
    assert "/telescope/slew" in script and "/resolve?name=" in script and "Slew now" in script
    # only the coordinates go to the server: the name is for Resolve alone
    assert "{ ...t, rot_pa: Number(this.pa) }" in script and "name: this.name" not in script
    assert "acquisitionTarget" not in client.get("/io/products/").content.decode()


def test_the_acquisition_tab_adjusts_offsets_and_rotation_with_the_slit_overlay(client: Client) -> None:
    page = client.get("/io/operations/").content.decode()
    for part in ('x-data="acquisitionOffsets()"', 'x-data="acquisitionRotation()"', "Adjust offsets", "Adjust rotation", "Start acquisition"):
        assert part in page, part
    assert "$store.slit.active = shown === 'acquisition'" in page
    dock = client.get("/io/operations/").content.decode()
    assert "wilds/js/slit.js" in dock and 'class="dock-overlay"' in dock and ":view-box.camel" in dock
    script = Path(finders.find("wilds/js/acquisition.js")).read_text()
    assert "/telescope/offset" in script and "/telescope/rotator" in script and "/telescope/offset/absorb" in script
    slit = Path(finders.find("wilds/js/slit.js")).read_text()
    assert "/config/guide-camera/cal" in slit and "setPointerCapture" in slit


def test_the_to_page_shows_what_waits_for_the_to(client: Client) -> None:
    page = client.get("/to/").content.decode()
    assert "answerPending(true)" in page and "answerPending(false)" in page and "pending.detail" in page
    script = Path(finders.find("wilds/js/to.js")).read_text()
    assert "/dev/telescope/" in script and "telemetry?.pending" in script


def test_the_live_view_can_be_zoomed_and_panned(client: Client) -> None:
    dock = client.get("/io/operations/").content.decode()
    for part in ('class="dock-zoombar"', 'class="dock-zoom"', "zoomToSlit()", "zoomReset()", "$store.camera.wheel($event)", "startPan($event)"):
        assert part in dock, part
    script = Path(finders.find("wilds/js/camera.js")).read_text()
    assert "setZoom(" in script and "get zoomStyle()" in script
