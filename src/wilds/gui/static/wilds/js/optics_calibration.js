/*
 * Calibrating the guide camera and the slit from the sky (Engineering → Calibration → Slit,
 * plan §3.3), and moving the slit stage by hand.
 *
 * "Start" is a job on wilds-control (POST /calibration/optics): with the telescope on a star field
 * it closes the slit, takes a frame and plate solves it (plate scale, which way north lies, parity),
 * opens the slit to a measuring width, takes a second frame, and finds the gap in the difference
 * (where the slit is, which way it points, its length and width). The result is a measurement only:
 * it is shown next to the calibration now in use, with whatever looks wrong, and "Apply" writes it
 * into the calibration (POST /calibration/optics/apply) with who and when. The two frames appear in
 * the guide-camera dock as they are taken. The stage card moves the slit to its presets or a width
 * (POST /slit/move). The job's progress comes in the status stream (jobs). All text goes in with
 * x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const wilds = () => Alpine.store("wilds");
    const KIND = "optics-calibration";

    const sessionId = () => {
        try { return localStorage.getItem("wilds.sessionId") || ""; } catch { return ""; }
    };

    async function api(method, path, body) {
        // A job records who started it, so the request names the session as well as the lease.
        const response = await fetch(`${base}${path}`, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-Session-Id": sessionId(),
                "X-Lease-Token": session()?.token || "",
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.message || data.detail || `HTTP ${response.status}`);
            error.status = response.status;
            throw error;
        }
        return data;
    }

    const num = (v, digits) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits));

    // -- the slit stage by hand ------------------------------------------------------------------
    Alpine.data("slitStage", () => ({
        width: 1,            // arcsec, for "Move"
        error: null,
        busy: false,

        get slit() { return wilds().slit; },
        get operational() { return !!this.slit?.lifecycle?.operational; },
        get positionText() {
            const s = this.slit;
            if (!s) return "unknown";
            if (s.moving) return "moving…";
            if (s.position_um === null) return "unknown";
            return `${num(s.position_um / 1000, 3)} mm`;
        },
        get widthText() {
            const w = this.slit?.width_arcsec;
            return w === null || w === undefined ? "" : `${num(w, 2)} arcsec`;
        },
        get presetText() { return this.slit?.preset ?? "between the presets"; },
        get whyNot() {
            if (!session()?.holder) return "Only the session holding control can move the slit";
            const c = wilds().system?.components?.slit;
            if (c && !c.operational) return `slit is not operational: ${(c.why_not_operational || []).join("; ")}`;
            if (this.slit?.moving) return "The slit is moving";
            return "";
        },
        get whyNotWidth() {
            if (this.whyNot) return this.whyNot;
            const s = this.slit;
            const um = this.width * s.um_per_arcsec;
            if (!(this.width > 0) || um < s.min_um || um > s.max_um) {
                return `Width: more than 0 and at most ${num((s.max_um - 0) / s.um_per_arcsec, 1)} arcsec`;
            }
            return "";
        },
        async go(body) {
            this.busy = true; this.error = null;
            try { await api("POST", "/slit/move", body); }
            catch (e) { this.error = String(e.message || e); }
            this.busy = false;
        },
        preset(name) { return this.go({ preset: name }); },
        moveToWidth() {
            if (this.whyNotWidth) return Promise.resolve();
            return this.go({ position_um: this.width * this.slit.um_per_arcsec });
        },
    }));

    // -- the calibration -------------------------------------------------------------------------
    Alpine.data("opticsCalibration", () => ({
        exposure: 4,
        gain: null,          // null: the single-frame group's
        binning: "",         // "": the single-frame group's
        width: 8,            // the measuring gap, arcsec
        cal: null,           // the calibration in use
        result: null,        // the last measurement
        error: null,
        busy: false,
        applying: false,
        wasRunning: null,

        async init() {
            // the dock draws the detected slit on the frame it was found in (slit.js)
            this.$watch("result", (r) => { Alpine.store("slit").detected = r; });
            await Promise.all([this.loadCal(), this.loadLast()]);
            this.$watch("$store.wilds.jobs", () => this.jobsChanged());
            this.$watch("$store.wilds.conf_versions", () => this.loadCal());
        },

        // -- the job in progress -------------------------------------------------------------
        get job() {
            return (wilds().jobs || []).find((j) => j.kind === KIND && (j.state === "running" || j.state === "queued")) || null;
        },
        get percent() { return Math.round(100 * (this.job?.progress?.fraction ?? 0)); },
        async jobsChanged() {
            const running = this.job?.id || null;
            if (this.wasRunning && this.wasRunning !== running) {
                const ended = (wilds().jobs || []).find((j) => j.id === this.wasRunning);
                if (ended?.state === "failed") this.error = ended.error?.message || "The calibration failed";
                else if (ended?.state === "done") { this.error = null; this.result = ended.result; }
            }
            this.wasRunning = running;
        },

        // -- starting it ---------------------------------------------------------------------
        get whyNot() {
            const w = wilds();
            if (!session()?.holder) return "Only the session holding control can run the calibration";
            const parts = w.system?.components || {};
            for (const name of ["guide-camera", "slit"]) {
                const c = parts[name];
                if (c && !c.operational) return `${name} is not operational: ${(c.why_not_operational || []).join("; ")}`;
            }
            if (w.guide_camera?.streaming) return "Stop the video first";
            if (this.job) return "The calibration is running";
            const light = w.light_path?.state;
            if (light === "blocked" || light === "block_requested") return "The light path is blocked: there is no sky to calibrate on";
            const t = w.telescope?.telemetry;
            if (!t?.target) return "The telescope has no target: it must be on a star field (slew to one first)";
            if (t.in_position !== true) return "The telescope is not on target yet";
            if (!(this.exposure >= 0.001 && this.exposure <= 60)) return "Exposure: 0.001 to 60 s";
            if (this.gain !== null && this.gain !== "" && !(this.gain >= 0 && this.gain <= 500)) return "Gain: 0 to 500";
            if (!(this.width > 0)) return "Measuring width: more than 0 arcsec";
            const s = w.slit;
            if (s && this.width * s.um_per_arcsec > s.max_um) return "That width is beyond the slit's travel";
            return "";
        },
        async start() {
            if (this.whyNot) return;
            this.busy = true; this.error = null;
            const body = { exposure_s: this.exposure, slit_width_arcsec: this.width };
            if (this.gain !== null && this.gain !== "") body.gain = this.gain;
            if (this.binning !== "") body.binning = Number(this.binning);
            try { await api("POST", "/calibration/optics", body); }
            catch (e) { this.error = String(e.message || e); }
            this.busy = false;
        },
        cancel() { return Alpine.store("jobs").cancel(this.job.id); },

        // -- what it found ---------------------------------------------------------------------
        async loadCal() {
            try {
                const response = await fetch(`${base}/config/guide-camera/cal`);
                if (response.ok) this.cal = (await response.json()).values;
            } catch { /* the "now" column stays empty */ }
        },
        async loadLast() {
            try { this.result = await api("GET", "/calibration/optics/last"); }
            catch { /* none yet */ }
        },
        /** The rows of the comparison: what was measured, and what the calibration has now. */
        get rows() {
            const m = this.result, c = this.cal || {};
            if (!m) return [];
            const row = (label, unit, measured, now, digits = 3) => ({
                label, unit, measured: num(measured, digits), now: num(now, digits),
            });
            return [
                row("Plate scale", "arcsec/px", m.plate_scale_arcsec_px, c.plate_scale_arcsec_px, 5),
                row("Orientation (north at PA 0)", "°", m.orientation_deg, c.orientation_deg, 2),
                { label: "Parity", unit: "", measured: String(m.parity), now: c.parity === null || c.parity === undefined ? "—" : String(c.parity) },
                row("Slit centre x", "px", m.slit_x, c.slit_pixel_x, 1),
                row("Slit centre y", "px", m.slit_y, c.slit_pixel_y, 1),
                row("Slit angle", "°", m.slit_angle_deg, c.slit_angle_deg ?? c.orientation_deg, 2),
                row("Slit length", "arcsec", m.slit_length_arcsec, c.slit_length_arcsec, 2),
            ];
        },
        get details() {
            const m = this.result;
            if (!m) return [];
            return [
                `Slit width: ${num(m.slit_width_arcsec, 2)} arcsec measured, ${num(m.slit_width_commanded_arcsec, 2)} asked (stage at ${num(m.slit_position_um / 1000, 3)} mm)`,
                `Rotator zero: the slit points ${num(m.rotator_zero_error_deg, 2)}° from where the rotator puts north at PA 0`,
                `Solve: ${m.solve_confidence} (log-odds ${num(m.solve_logodds, 0)}, ${m.solve_stars} stars); the slit stands out by ${num(m.slit_significance, 0)} sigma`,
                `Frames: ${m.exposure_s} s, gain ${m.gain}, bin ${m.binning}, rotator PA ${num(m.rot_pa, 2)}°`,
            ];
        },
        get taken() { return this.result ? new Date(this.result.taken_ms).toLocaleString() : ""; },
        get whyNotApply() {
            if (!session()?.holder) return "Only the session holding control can change the calibration";
            if (!this.result) return "Nothing to apply yet";
            if (this.job) return "The calibration is running";
            return "";
        },
        async apply() {
            if (this.whyNotApply) return;
            this.applying = true; this.error = null;
            try {
                await api("POST", "/calibration/optics/apply", { taken_ms: this.result.taken_ms });
                await this.loadCal();
                showToast("success", "Calibration applied", "The slit overlay and the acquisition use these values now");
            } catch (e) { this.error = String(e.message || e); }
            this.applying = false;
        },
        /** Show one of the two frames in the guide-camera dock. */
        frame(which) {
            const m = this.result;
            if (!m) return;
            const id = which === "closed" ? m.closed_frame_id : m.open_frame_id;
            const camera = Alpine.store("camera");
            // the open-slit frame shows the slit found in it (the viewer draws the corners we give it)
            const corners = which === "open" ? Alpine.store("slit").perimeter(m, m.binning).flat().map((v) => v.toFixed(2)).join(",") : null;
            if (camera) camera.show(`/guide-camera/frames/${id}`, `${which}-slit frame #${id}`, { open: true, perimeter: corners });
        },
    }));
});
