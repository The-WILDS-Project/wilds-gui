/*
 * The guide-camera dock (templates/components/camera_dock.html, plan §3.8).
 *
 * "camera" store: the live video and the dock's size. Frames arrive on wilds-control's
 * WS /guide-camera/stream as a JSON metadata message followed by the JPEG as a binary message;
 * the server drops frames a slow viewer cannot take, so this only ever draws the newest.
 * The camera's settings, cooler and streaming flag come from the status stream ("wilds" store,
 * guide_camera), not from here. Commands (start/stop, exposure, gain, cooler) need the lease.
 *
 * The dock also shows stored frames in place of the live video: while a dark or bias run is
 * going (each frame as it is taken, then the master), and when a stored image is opened from
 * the Calibration page. They are the JS9 viewer page (/viewer/?embed=1) in a frame inside the dock;
 * starting the video, or the Live button, brings the video back.
 *
 * The socket is open only while the dock is shown (a hidden dock costs the server nothing),
 * and reconnects with backoff. All text goes in with x-text; the image is a blob: URL.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const SIZES = ["thumb", "dock", "off"];
    const SIZE_KEY = "wilds-camera-size";
    const WIDTH_KEY = "wilds-camera-width";
    const MIN_WIDTH = 320;
    const maxWidth = () => Math.max(MIN_WIDTH, Math.min(1000, Math.round(window.innerWidth * 0.7)));
    const NARROW = window.matchMedia("(max-width: 1199.98px)");  // too narrow for the full dock

    const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
    const session = () => Alpine.store("session");

    async function problem(response) {
        const body = await response.json().catch(() => ({}));
        return body.message || body.detail || `HTTP ${response.status}`;
    }

    Alpine.store("camera", {
        size: SIZES.includes(read(SIZE_KEY)) ? read(SIZE_KEY) : "dock",  // thumb | dock | off
        narrow: NARROW.matches,
        width: Number(read(WIDTH_KEY)) || 540,  // px, the full dock; set by the splitter
        dragging: false,
        zoom: 1,              // the live view's magnification (1 = the whole frame)
        cx: 0.5,              // the point of the frame in the middle of the dock, as fractions
        cy: 0.5,
        link: "off",          // off | connecting | live | lost
        meta: null,           // the metadata of the frame on screen
        url: null,            // blob: URL of that frame
        fps: null,
        busy: false,          // a command is in flight
        view: null,           // a stored frame shown instead of the video: {title, src}, or null

        /** What is drawn: a narrow window cannot hold the full dock. */
        get shown() { return this.narrow && this.size === "dock" ? "thumb" : this.size; },
        get status() { return Alpine.store("wilds").guide_camera; },
        get streaming() { return !!this.status?.streaming; },
        get dot() {
            if (this.link === "lost") return "error";
            if (this.link === "live" && this.streaming) return "ok";
            return "unknown";
        },
        get headline() {
            if (this.view) return "Stored frame";
            if (this.link === "lost") return "Video link lost, retrying";
            if (this.link === "connecting") return "Connecting";
            if (!this.status) return "No camera status";
            return this.streaming ? "Streaming" : "Stopped";
        },
        get frameText() {
            const m = this.meta;
            if (!m) return "";
            const parts = [`#${m.id}`, `${m.width}×${m.height}`];
            if (m.binning > 1) parts.push(`bin ${m.binning}`);
            if (this.fps) parts.push(`${this.fps.toFixed(1)} fps`);
            return parts.join(" · ");
        },
        get aspect() { return this.meta ? `${this.meta.width} / ${this.meta.height}` : "3 / 2"; },
        get tempText() {
            const t = this.status?.cooler?.temperature_c;
            return t === null || t === undefined ? "" : `${t.toFixed(1)} °C`;
        },
        get coolerText() {
            const c = this.status?.cooler;
            if (!c) return "";
            if (!c.supported) return "no cooler";
            if (c.state === "off") return "cooler off";
            const target = c.setpoint_c === null ? "" : ` ${c.setpoint_c.toFixed(0)} °C`;
            const power = c.power_pct === null ? "" : ` · ${Math.round(c.power_pct)} %`;
            return `${c.state === "stable" ? "at" : "cooling to"}${target}${power}`;
        },

        /** Show a file on wilds-control (a path) in the dock's viewer instead of the video.
         *  ``open`` brings the dock up even if it is hidden or small (a click asked for it). */
        show(path, title, { open = false, size = null } = {}) {
            if (!path || !path.startsWith("/") || path.startsWith("//")) return;
            // The viewer sizes JS9 to the frame it is shown in; a frame that is hidden at the
            // moment it loads measures nothing, so the dock says how big it will be.
            const box = document.querySelector(".dock-view");
            const w = size?.w || (box && box.clientWidth) || 516;
            const h = size?.h || (box && box.clientHeight) || 480;
            const src = `/viewer/?embed=1&w=${w}&h=${h}&path=${encodeURIComponent(path)}&title=${encodeURIComponent(title || "")}`;
            if (this.view?.src !== src) this.view = { title: title || path, src, path };
            if (open && this.size !== "dock") this.setSize("dock");
        },
        live() { this.view = null; },

        // -- zooming the live view (the frame is scaled and moved inside the dock) -----------------
        /** The transform that shows magnification ``zoom`` around (cx, cy), kept inside the frame. */
        get xf() {
            const z = this.zoom, clamp = (t) => Math.min(0, Math.max(1 - z, t));
            return { z, tx: clamp(0.5 - z * this.cx), ty: clamp(0.5 - z * this.cy) };
        },
        get zoomStyle() {
            const { z, tx, ty } = this.xf;
            return this.shown === "dock" && z > 1 ? `transform: translate(${tx * 100}%, ${ty * 100}%) scale(${z})` : "";
        },
        /** Set the magnification, keeping the point under (sx, sy) (fractions of the dock frame) fixed. */
        setZoom(z2, sx = 0.5, sy = 0.5) {
            const { z, tx, ty } = this.xf;
            z2 = Math.min(16, Math.max(1, z2));
            const px = (sx - tx) / z, py = (sy - ty) / z;  // the frame point under the cursor
            this.zoom = z2;
            this.cx = (z2 * px + 0.5 - sx) / z2;
            this.cy = (z2 * py + 0.5 - sy) / z2;
            const n = this.xf;  // after the clamp, so the centre is where the frame really is
            this.cx = (0.5 - n.tx) / z2;
            this.cy = (0.5 - n.ty) / z2;
        },
        zoomBy(k) { this.setZoom(this.zoom * k); },
        zoomReset() { this.zoom = 1; this.cx = this.cy = 0.5; },
        /** Magnify around the slit, so that it fills a good part of the view. */
        zoomToSlit() {
            const g = Alpine.store("slit")?.geo;
            if (!g) return;
            this.zoom = 1;
            this.setZoom(Math.min(12, Math.max(2, (0.6 * g.h) / g.len)));
            this.cx = g.cx / g.w; this.cy = g.cy / g.h;
            this.setZoom(this.zoom);  // clamp
        },
        wheel(evt) {
            if (this.shown !== "dock") return;
            const r = evt.currentTarget.getBoundingClientRect();
            this.setZoom(this.zoom * (evt.deltaY < 0 ? 1.25 : 0.8), (evt.clientX - r.left) / r.width, (evt.clientY - r.top) / r.height);
        },
        /** Drag the magnified frame (not on the slit's handle, nor while picking a star). */
        startPan(evt) {
            if (this.zoom <= 1 || evt.button !== 0 || Alpine.store("slit")?.pick || evt.target.closest?.(".slit-handle")) return;
            const el = evt.currentTarget, r = el.getBoundingClientRect(), x0 = evt.clientX, y0 = evt.clientY, c0 = [this.cx, this.cy];
            el.setPointerCapture(evt.pointerId);
            const move = (e) => {
                this.cx = c0[0] - (e.clientX - x0) / r.width / this.zoom;
                this.cy = c0[1] - (e.clientY - y0) / r.height / this.zoom;
                const n = this.xf;
                this.cx = (0.5 - n.tx) / this.zoom; this.cy = (0.5 - n.ty) / this.zoom;
            };
            const end = () => {
                el.removeEventListener("pointermove", move);
                el.removeEventListener("pointerup", end);
                el.removeEventListener("pointercancel", end);
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", end);
            el.addEventListener("pointercancel", end);
        },

        /** The splitter between the page and the dock: the dock's width, kept in this browser. */
        setWidth(w, { save = true } = {}) {
            this.width = Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));
            if (save) write(WIDTH_KEY, String(this.width));
        },
        drag(event) {
            event.preventDefault();
            const handle = event.currentTarget;
            handle.setPointerCapture(event.pointerId);  // keep the events over the viewer's frame
            this.dragging = true;
            const move = (e) => this.setWidth(window.innerWidth - e.clientX, { save: false });
            const end = () => {
                handle.removeEventListener("pointermove", move);
                handle.removeEventListener("pointerup", end);
                handle.removeEventListener("pointercancel", end);
                this.dragging = false;
                this.setWidth(this.width);
                this.refit();
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
        },
        nudge(event) {
            const step = event.shiftKey ? 80 : 20;
            if (event.key === "ArrowLeft") this.setWidth(this.width + step);
            else if (event.key === "ArrowRight") this.setWidth(this.width - step);
            else return;
            event.preventDefault();
            this.refit();
        },
        /** The viewer in the dock sizes itself when it loads: load it again at the new size. */
        refit() {
            if (!this.view) return;
            const { path, title } = this.view;
            setTimeout(() => {  // after the dock has taken its new width
                const box = document.querySelector(".dock-view");
                const size = { w: box.clientWidth, h: box.clientHeight };  // measured while shown
                this.view = null;
                setTimeout(() => this.show(path, title, { size }), 0);
            }, 50);
        },

        setSize(size) {
            if (!SIZES.includes(size)) return;
            this.size = size;
            write(SIZE_KEY, size);
            size === "off" ? close() : open();
        },

        /** A command to wilds-control as the holder; shows the refusal if there is one. */
        async command(what, method, path, body) {
            this.busy = true;
            try {
                const response = await fetch(`${base}${path}`, {
                    method,
                    headers: { "Content-Type": "application/json", "X-Lease-Token": session()?.token || "" },
                    body: body === undefined ? undefined : JSON.stringify(body),
                });
                if (!response.ok) throw new Error(await problem(response));
            } catch (e) {
                showToast("error", `Could not ${what}`, String(e.message || e));
            } finally {
                this.busy = false;
            }
        },
        start() { return this.command("start the camera", "POST", "/guide-camera/start"); },
        stop() { return this.command("stop the camera", "POST", "/guide-camera/stop"); },
        setting(what, body) { return this.command(`set the ${what}`, "PUT", "/guide-camera/settings", body); },
        cooler(body) { return this.command("change the cooler", "PUT", "/guide-camera/cooler", body); },
    });
    const store = Alpine.store("camera");
    NARROW.addEventListener("change", (e) => { store.narrow = e.matches; });

    // -- stored frames in the dock -------------------------------------------------------

    const CALIBRATION = ["guide-camera-dark", "guide-camera-bias"];
    let following = null;     // the calibration job being shown, by id
    let shownFrame = null;    // the newest calibration frame already shown
    // Started once every store exists (this script may run before status.js has made "wilds").
    const follow = () => Alpine.effect(() => {
        const w = Alpine.store("wilds");
        const jobs = w.jobs || [];
        const frameId = w.guide_camera?.last_calibration_frame_id ?? null;
        const streaming = !!w.guide_camera?.streaming;
        const running = jobs.find((j) => CALIBRATION.includes(j.kind) && (j.state === "running" || j.state === "queued"));
        if (streaming && store.view) { store.live(); return; }  // starting the video wins
        if (running) {
            if (following !== running.id) { following = running.id; shownFrame = frameId; }  // an older run's frame is not news
            if (frameId !== null && frameId !== shownFrame && store.size !== "off") {
                shownFrame = frameId;
                store.show(`/guide-camera/frames/${frameId}`, `${running.kind.replace("guide-camera-", "")} frame #${frameId}`);
            }
        } else if (following) {
            const ended = jobs.find((j) => j.id === following);
            following = null;
            const r = ended?.state === "done" ? ended.result : null;
            if (r?.master && store.size !== "off") {
                store.show(`/guide-camera/calibration/sessions/${r.session}/entries/${r.entry}/${r.master}`, `${r.entry} master`);
            }
        }
    });
    document.addEventListener("alpine:initialized", follow);

    // -- the video socket ----------------------------------------------------------------

    let socket = null;
    let retry = 1000;
    let retryTimer = null;
    let pending = null;       // the metadata message waiting for its JPEG
    let arrivals = [];        // performance.now() of recent frames, for the frame rate
    const wanted = () => store.size !== "off" && !!base;

    function open() {
        if (socket || !wanted()) return;
        clearTimeout(retryTimer);
        store.link = "connecting";
        let ws;
        try {
            ws = new WebSocket(`${base.replace(/^http/, "ws")}/guide-camera/stream`);
        } catch {
            store.link = "lost";
            return;
        }
        socket = ws;
        ws.binaryType = "blob";
        ws.addEventListener("open", () => { store.link = "live"; retry = 1000; });
        ws.addEventListener("message", (e) => frame(e.data));
        ws.addEventListener("close", () => {
            if (socket !== ws) return;  // closed on purpose
            socket = null;
            pending = null;
            if (!wanted()) { store.link = "off"; return; }
            store.link = "lost";
            retryTimer = setTimeout(open, retry);
            retry = Math.min(retry * 2, 30000);
        });
    }

    function close() {
        clearTimeout(retryTimer);
        const ws = socket;
        socket = null;
        pending = null;
        store.link = "off";
        store.fps = null;
        if (ws) ws.close();
    }

    function frame(data) {
        if (typeof data === "string") {
            try { pending = JSON.parse(data); } catch { pending = null; }
            return;
        }
        const meta = pending;
        pending = null;
        if (!meta || store.meta?.id === meta.id) return;  // no metadata, or the same frame twice
        const old = store.url;
        store.url = URL.createObjectURL(data);
        store.meta = meta;
        if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);  // after the image has swapped

        const now = performance.now();
        arrivals = arrivals.filter((t) => now - t < 3000);
        arrivals.push(now);
        store.fps = arrivals.length > 1 ? ((arrivals.length - 1) * 1000) / (now - arrivals[0]) : null;
    }

    // Frames stopped coming (camera stopped, or exposures are long): the rate is no longer true.
    setInterval(() => {
        if (store.fps !== null && !arrivals.some((t) => performance.now() - t < 3000)) store.fps = null;
    }, 1000);

    document.addEventListener("alpine:initialized", open);
    // A bfcache restore keeps the page but not its socket.
    window.addEventListener("pageshow", (e) => { if (e.persisted) open(); });
    window.addEventListener("pagehide", close);
});
