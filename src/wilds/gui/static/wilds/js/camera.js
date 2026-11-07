/*
 * The guide-camera dock (templates/components/camera_dock.html, plan §3.8).
 *
 * "camera" store: the live video and the dock's size. Frames arrive on wilds-control's
 * WS /guide-camera/stream as a JSON metadata message followed by the JPEG as a binary message;
 * the server drops frames a slow viewer cannot take, so this only ever draws the newest.
 * The camera's settings, cooler and streaming flag come from the status stream ("wilds" store,
 * guide_camera), not from here. Commands (start/stop, exposure, gain, cooler) need the lease.
 *
 * The socket is open only while the dock is shown (a hidden dock costs the server nothing),
 * and reconnects with backoff. All text goes in with x-text; the image is a blob: URL.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const SIZES = ["thumb", "dock", "off"];
    const SIZE_KEY = "wilds-camera-size";
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
        link: "off",          // off | connecting | live | lost
        meta: null,           // the metadata of the frame on screen
        url: null,            // blob: URL of that frame
        fps: null,
        busy: false,          // a command is in flight

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
