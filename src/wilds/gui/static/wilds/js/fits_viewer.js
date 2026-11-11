/*
 * The FITS viewer page (templates/viewer/index.html, plan §3.17).
 *
 * ?path=/guide-camera/calibration/... names a file on wilds-control; it is made into a URL on
 * the control server only (a path that does not start with a single "/" is refused, so the
 * page cannot be pointed at another site). ?title= is shown, as text, in the bar and the tab.
 * ?embed=1 is the page inside the camera dock: no title bar, sized to the frame it is in (&w= and
 * &h= give that size; without them the window's).
 * JS9.Preload queues the image before JS9 starts; a dark or bias gets the zscale stretch that
 * shows its structure.
 */
(() => {
    const params = new URLSearchParams(window.location.search);
    const path = params.get("path") || "";
    const title = params.get("title") || path.split("/").pop() || "Image";
    const base = document.body.dataset.controlUrl;
    const fail = (message) => { document.getElementById("viewer-error").textContent = message; };

    const embed = params.get("embed") === "1";
    if (embed) {
        document.querySelector(".viewer-bar").hidden = true;
        document.body.dataset.embed = "1";
    }
    // JS9 takes its size from data-width / data-height: fit the window (menus, colorbar and
    // status line take about 190 px of the height).
    const given = (name, fallback) => {
        const n = Number(params.get(name));
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const width = Math.max(280, given("w", window.innerWidth) - 24);
    const height = Math.max(200, given("h", window.innerHeight) - (embed ? 190 : 230));
    for (const el of document.querySelectorAll(".JS9, .JS9Menubar, .JS9Toolbar, .JS9Colorbar, .JS9Statusbar")) {
        el.setAttribute("data-width", `${width}px`);
        if (el.classList.contains("JS9")) el.setAttribute("data-height", `${height}px`);
    }
    document.getElementById("viewer-title").textContent = title;
    document.title = `WILDS - ${title}`;
    if (!path.startsWith("/") || path.startsWith("//")) {
        fail("No image given: this page needs ?path=/… on wilds-control");
        return;
    }
    if (typeof JS9 === "undefined") {
        fail("JS9 did not load");
        return;
    }
    JS9.Preload(`${base}${path}`, { scaleclipping: "zscale", colormap: "grey", scale: "linear", zoom: "tofit" });
})();
