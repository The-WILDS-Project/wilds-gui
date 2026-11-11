/*
 * The slit overlay on the guide camera's live view (plan §3.3, Acquisition tab): where the slit
 * is, which way it points (sky PA, East of North) and a handle to turn it, drawn in the browser
 * from the guide camera's calibration (plate scale, slit pixel, orientation, parity, slit size,
 * served by GET /config/guide-camera/cal) and the telescope's own rotator angle.
 *
 * The overlay's coordinates are the pixels of the frame on screen (binned, and cut to the ROI),
 * so the calibration, which is in full-sensor pixels, is mapped through the frame's ROI and
 * binning. The store is shared with the Acquisition tab's offset and rotation panels: a pending
 * PA set by dragging the handle is the one the Rotation panel sends, and a click on the image in
 * "pick" mode hands the sky offset between the slit and the clicked point to the Offsets panel.
 * Nothing here is sent to wilds-control; it only reads. All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const rad = (d) => (d * Math.PI) / 180;
    const EMPTY = { ok: false, vb: "0 0 1 1", w: 0, h: 0, cx: 0, cy: 0 };

    Alpine.store("slit", {
        active: false,        // the Acquisition tab is shown
        cal: null,            // the guide camera's cal values, or null until read
        calVersion: null,
        pendingPa: null,      // a PA being set by the handle or the Rotation panel (degrees), or null
        pick: false,          // the next click on the image picks a star to put on the slit
        pickMark: null,       // where it was picked: {x, y} in image pixels
        pickHandler: null,    // called with (east_arcsec, north_arcsec) when a star is picked

        async load() {
            try {
                const response = await fetch(`${base}/config/guide-camera/cal`);
                if (!response.ok) return;
                const view = await response.json();
                this.cal = view.values;
                this.calVersion = view.version;
            } catch { /* the overlay simply stays off */ }
        },
        get calOk() {
            const c = this.cal;
            if (!c) return false;
            return ["plate_scale_arcsec_px", "slit_pixel_x", "slit_pixel_y", "orientation_deg", "parity", "slit_length_arcsec", "slit_width_arcsec"]
                .every((k) => c[k] !== null && c[k] !== undefined);
        },
        /** What is missing, for the panels to say, or "". */
        get calWhy() {
            return this.calOk ? "" : "The slit overlay needs the guide camera's calibration: plate scale, slit pixel, orientation, parity and slit size (Engineering → Configuration)";
        },
        get show() {
            const cam = Alpine.store("camera");
            return this.active && this.calOk && !!cam.meta && !!cam.url && !cam.view && cam.shown === "dock";
        },

        // -- the sky <-> image geometry --------------------------------------------------------
        /** Unit vectors of sky north and east in the image now (x right, y down). */
        get basis() {
            // The camera turns with the rotator: the slit stays where it is in the image and the sky
            // turns, so north is at the calibrated angle (for PA 0) minus parity times the PA now.
            const s = this.cal.parity;
            const a = -rad(this.cal.orientation_deg - s * (this.currentPa ?? 0));  // clockwise on the screen
            return { N: [Math.sin(a), -Math.cos(a)], E: [s * -Math.cos(a), s * -Math.sin(a)] };
        },
        /** The calibration mapped onto the frame on screen, or null. */
        get geo() {
            const m = Alpine.store("camera").meta;
            if (!this.calOk || !m) return null;
            const c = this.cal, b = m.binning || 1;
            const arc = c.plate_scale_arcsec_px * b;  // arcsec per screen pixel
            return {
                w: m.width, h: m.height, arc,
                cx: (c.slit_pixel_x - (m.roi ? m.roi.x : 0)) / b,
                cy: (c.slit_pixel_y - (m.roi ? m.roi.y : 0)) / b,
                len: c.slit_length_arcsec / arc, wid: c.slit_width_arcsec / arc,
            };
        },
        /** Unit vector of the slit's long axis for a sky PA, in the image. */
        dir(pa) {
            const { N, E } = this.basis, p = rad(pa);
            return [Math.sin(p) * E[0] + Math.cos(p) * N[0], Math.sin(p) * E[1] + Math.cos(p) * N[1]];
        },
        /** The slit's rotation on the screen (clockwise from up) for a sky PA. */
        angle(pa) {
            const d = this.dir(pa);
            return (Math.atan2(d[0], -d[1]) * 180) / Math.PI;
        },
        /** The sky PA of a vector from the slit centre. */
        paOf(vx, vy) {
            const { N, E } = this.basis;
            const e = vx * E[0] + vy * E[1], n = vx * N[0] + vy * N[1];
            return (((Math.atan2(e, n) * 180) / Math.PI) + 360) % 360;
        },
        get currentPa() { return Alpine.store("wilds").telescope?.telemetry?.rot_pa ?? null; },
        get shownPa() { return this.pendingPa ?? this.currentPa ?? 0; },

        /** Everything the SVG draws, in one place (all zeros until the overlay can be drawn). */
        get v() {
            const g = this.geo;
            if (!g) return EMPTY;
            const { z, tx, ty } = Alpine.store("camera").xf;  // marks keep their size on screen when zoomed
            const slit = (pa) => ({ x: g.cx - g.wid / 2, y: g.cy - g.len / 2, w: g.wid, h: g.len, t: `rotate(${this.angle(pa).toFixed(2)} ${g.cx} ${g.cy})` });
            const d = this.dir(this.shownPa);
            const reach = g.len / 2 + Math.max(14, g.w * 0.02) / z;
            const arm = (Math.min(g.w, g.h) * 0.07) / z;
            // the visible part of the frame, in frame pixels: the compass and the readout stay in its corners
            const vx = (f) => (g.w * (f - tx)) / z, vy = (f) => (g.h * (f - ty)) / z;
            const ox = vx(0.9), oy = vy(0.16);
            const { N, E } = this.basis;
            const cur = this.currentPa;
            return {
                ok: true, vb: `0 0 ${g.w} ${g.h}`, w: g.w, h: g.h, cx: g.cx, cy: g.cy,
                now: slit(cur ?? 0), hasNow: cur !== null,
                pending: slit(this.pendingPa ?? 0), hasPending: this.pendingPa !== null,
                handle: { x: g.cx + d[0] * reach, y: g.cy + d[1] * reach, r: Math.max(8, g.w * 0.012) / z },
                stroke: Math.max(1.5, g.w * 0.0025) / z,
                tick: 8 / z,
                compass: { ox, oy, nx: ox + N[0] * arm, ny: oy + N[1] * arm, ex: ox + E[0] * arm, ey: oy + E[1] * arm, f: Math.max(11, g.w * 0.02) / z },
                text: cur === null ? "" : `PA ${cur.toFixed(1)}°` + (this.pendingPa !== null ? `  →  ${this.pendingPa.toFixed(1)}°` : ""),
                font: Math.max(12, g.w * 0.024) / z, textX: vx(0.02), textY: vy(0.96),
            };
        },

        // -- pointing at the overlay --------------------------------------------------------
        point(evt, svg) {
            const matrix = svg.getScreenCTM();
            if (!matrix) return null;
            const pt = svg.createSVGPoint();
            pt.x = evt.clientX; pt.y = evt.clientY;
            return pt.matrixTransform(matrix.inverse());
        },
        /** Grab the handle: the slit follows the pointer, setting the pending PA. */
        startRotate(evt) {
            evt.preventDefault();
            const el = evt.currentTarget, svg = el.ownerSVGElement, g = this.geo;
            if (!g) return;
            el.setPointerCapture(evt.pointerId);
            const move = (e) => {
                const p = this.point(e, svg);
                if (p) this.pendingPa = Math.round(this.paOf(p.x - g.cx, p.y - g.cy) * 10) / 10;
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
        /** A click in pick mode: the sky offset (arcsec, east and north) from the slit to the point. */
        clickPick(evt) {
            const g = this.geo, svg = evt.currentTarget.ownerSVGElement;
            const p = g && this.point(evt, svg);
            if (!p) return;
            const { N, E } = this.basis, vx = p.x - g.cx, vy = p.y - g.cy;
            this.pickMark = { x: p.x, y: p.y };
            this.pick = false;
            this.pickHandler?.((vx * E[0] + vy * E[1]) * g.arc, (vx * N[0] + vy * N[1]) * g.arc);
        },
    });

    const store = Alpine.store("slit");
    document.addEventListener("alpine:initialized", () => {
        store.load();
        // Read again when someone saves the calibration (the status says which version it is at).
        Alpine.effect(() => {
            const v = Alpine.store("wilds").conf_versions?.["guide-camera/cal"];
            if (v !== undefined && v !== store.calVersion) store.load();
        });
    });
});
