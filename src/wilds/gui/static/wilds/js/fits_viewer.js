/*
 * The FITS viewer page (templates/viewer/index.html, plan §3.17).
 *
 * ?path=/guide-camera/calibration/... names a file on wilds-control; it is made into a URL on
 * the control server only (a path that does not start with a single "/" is refused, so the
 * page cannot be pointed at another site). ?title= is shown, as text, in the bar and the tab.
 * ?embed=1 is the page inside the camera dock: no title bar, sized to the frame it is in (&w= and
 * &h= give that size; without them the window's).
 * ?perimeter=x1,y1,...,x4,y4 draws a polygon through those corners (array indices of the image, as
 * the slit calibration gives them) in cyan: the slit it found in this frame.
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
    // The header: JS9 has it under File > display ... > FITS header, which is easy to miss and
    // opens a small floating window; this shows it in a panel over the viewer instead.
    const panel = document.getElementById("viewer-header");
    const text = document.getElementById("viewer-header-text");
    const find = document.getElementById("viewer-header-find");
    let cards = [];
    const draw = () => {
        const q = find.value.trim().toLowerCase();
        text.textContent = cards.filter((c) => !q || c.toLowerCase().includes(q)).join("\n");
    };
    document.getElementById("viewer-header-btn").addEventListener("click", () => {
        let raw = "";
        try { raw = JS9.GetFITSHeader(true) || ""; } catch (e) { raw = ""; }
        if (!raw) { fail("The image is not loaded yet, so there is no header to show"); return; }
        fail("");
        cards = raw.split("\n").map((c) => c.trimEnd()).filter((c) => c && c !== "END");
        find.value = "";
        draw();
        panel.hidden = false;
        find.focus();
    });
    document.getElementById("viewer-header-close").addEventListener("click", () => { panel.hidden = true; });
    find.addEventListener("input", draw);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") panel.hidden = true; });
    // the corners, as JS9 image coordinates (1-based: the first array index is pixel 1)
    const nums = (params.get("perimeter") || "").split(",").map(Number);
    const corners = nums.length === 8 && nums.every(Number.isFinite)
        ? [0, 2, 4, 6].map((i) => ({ x: nums[i] + 1, y: nums[i + 1] + 1 })) : null;
    const drawPerimeter = (im) => {
        if (!corners) return;
        JS9.AddRegions("polygon", { pts: corners, color: "#00e5ff", movable: false, removable: false, rotatable: false }, im ? { display: im } : undefined);
    };
    JS9.Preload(`${base}${path}`, { scaleclipping: "zscale", colormap: "grey", scale: "linear", zoom: "tofit", onload: drawPerimeter });
})();
