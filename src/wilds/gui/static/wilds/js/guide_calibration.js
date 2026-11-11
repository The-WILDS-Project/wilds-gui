/*
 * The guide camera's dark and bias frames (Engineering → Calibration, plan §3.17).
 *
 * Taking them is a job on wilds-control (POST /guide-camera/calibration/frames): it takes N frames
 * with the camera's own settings and files them and their median in the active calibration
 * session. A dark needs the light path blocked, which the Telescope Operator does on request
 * (/light-path: ask, wait for the TO's acknowledgement, take the darks, ask for the light back). Sessions are time-stamped folders on
 * the control machine; one is active, and any can be made active again. A stored image opens in
 * the JS9 viewer page. The job's progress comes in the status stream (jobs); the session list is
 * read again whenever a calibration job ends. All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const wilds = () => Alpine.store("wilds");
    const KINDS = ["guide-camera-dark", "guide-camera-bias"];
    const ROOT = "/guide-camera/calibration";

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
        if (!response.ok) throw new Error(data.message || data.detail || `HTTP ${response.status}`);
        return data;
    }

    Alpine.data("guideCalibration", () => ({
        kind: "dark",
        count: 10,
        match: "single_frame",
        ownExposure: false,
        exposure: 1,
        requireStable: true,
        sessions: [],
        chosen: null,        // the session id being looked at
        label: "",
        error: null,
        busy: false,
        wasRunning: null,

        async init() {
            await this.load();
            this.$watch("$store.wilds.jobs", () => this.jobsChanged());
        },

        // -- the job in progress ---------------------------------------------------------
        get job() {
            return (wilds().jobs || []).find((j) => KINDS.includes(j.kind) && (j.state === "running" || j.state === "queued")) || null;
        },
        get percent() { return Math.round(100 * (this.job?.progress?.fraction ?? 0)); },
        async jobsChanged() {
            const running = this.job?.id || null;
            if (this.wasRunning && this.wasRunning !== running) {
                const ended = (wilds().jobs || []).find((j) => j.id === this.wasRunning);
                if (ended?.state === "failed") this.error = ended.error?.message || "The calibration job failed";
                else if (ended?.state === "done") this.error = null;
                await this.load(true);
            }
            this.wasRunning = running;
        },

        // -- what a run would use ----------------------------------------------------------
        get group() { return wilds().guide_camera?.settings?.[this.match] || null; },
        get groupText() {
            const g = this.group;
            if (!g) return "";
            const roi = g.roi ? `ROI ${g.roi.width}×${g.roi.height}` : "full sensor";
            const exposure = this.kind === "bias" ? "shortest exposure" : `${this.ownExposure ? this.exposure : g.exposure_s} s`;
            return `${exposure}, gain ${g.gain}, offset ${g.offset}, bin ${g.binning}, ${roi}`;
        },
        get whyNot() {
            const w = wilds();
            if (!session()?.holder) return "Only the session holding control can take frames";
            const parts = w.system?.components || {};
            const camera = parts["guide-camera"];
            if (camera && !camera.operational) return `guide-camera is not operational: ${(camera.why_not_operational || []).join("; ")}`;
            if (w.guide_camera?.streaming) return "Stop the video first";
            if (this.job) return "A calibration run is in progress";
            if (this.kind === "dark" && this.lightState !== "blocked") return "A dark needs the light blocked: ask the TO to block it first";
            if (this.requireStable && w.guide_camera?.cooler?.state === "cooling") return "The sensor is still cooling to its setpoint";
            if (this.count < 1 || this.count > 200 || !Number.isInteger(this.count)) return "Frames: a whole number from 1 to 200";
            if (this.kind === "dark" && this.ownExposure && !(this.exposure >= 0.001 && this.exposure <= 60)) return "Exposure: 0.001 to 60 s";
            return "";
        },

        // -- the light path: ask the TO (plan §3.17) -----------------------------------------
        get light() { return wilds().light_path; },
        get lightState() { return this.light?.state ?? "unknown"; },
        get lightPending() { return this.lightState === "block_requested" || this.lightState === "unblock_requested"; },
        get whyNotAsk() {
            if (!session()?.holder) return "Only the session holding control can ask the TO";
            return "";
        },
        async asLight(path) {
            this.error = null;
            try { await api("POST", `/light-path/${path}`, {}); }
            catch (e) { this.error = String(e.message || e); }
        },

        async take() {
            if (this.whyNot) return;
            this.busy = true; this.error = null;
            const body = { kind: this.kind, count: this.count, match: this.match, require_stable_cooler: this.requireStable };
            if (this.kind === "dark" && this.ownExposure) body.exposure_s = this.exposure;
            try { await api("POST", `${ROOT}/frames`, body); }
            catch (e) { this.error = String(e.message || e); }
            this.busy = false;
        },
        cancel() { return Alpine.store("jobs").cancel(this.job.id); },

        // -- sessions ---------------------------------------------------------------------
        async load(keepChoice = false) {
            try {
                this.sessions = await api("GET", `${ROOT}/sessions`);
                const active = this.sessions.find((s) => s.active);
                if (!keepChoice || !this.sessions.some((s) => s.id === this.chosen)) this.chosen = (active || this.sessions[0])?.id ?? null;
                else if (active && this.wasRunning) this.chosen = active.id;
            } catch (e) { this.error = String(e.message || e); }
        },
        get current() { return this.sessions.find((s) => s.id === this.chosen) || null; },
        sessionText(s) {
            const when = new Date(s.created_ms).toLocaleString();
            const n = s.entries.length;
            return `${when}${s.label ? ` · ${s.label}` : ""} · ${n} ${n === 1 ? "entry" : "entries"}${s.active ? " (active)" : ""}`;
        },
        async newSession() {
            try {
                const made = await api("POST", `${ROOT}/sessions`, { label: this.label || null });
                this.label = "";
                await this.load();
                this.chosen = made.id;
                showToast("success", "New calibration session", "It is the active one now");
            } catch (e) { this.error = String(e.message || e); }
        },
        async activate() {
            try {
                await api("POST", `${ROOT}/sessions/${encodeURIComponent(this.chosen)}/activate`, {});
                await this.load(true);
                showToast("success", "Session activated", "Calibration frames are filed there now");
            } catch (e) { this.error = String(e.message || e); }
        },

        // -- entries -----------------------------------------------------------------------
        filePath(entry, name) { return `${ROOT}/sessions/${encodeURIComponent(this.chosen)}/entries/${entry.id}/${name}`; },
        viewUrl(entry, name) {
            const title = `${entry.id} ${name === "master.fits" ? "master" : name} (${this.chosen})`;
            return `/viewer/?path=${encodeURIComponent(this.filePath(entry, name))}&title=${encodeURIComponent(title)}`;
        },
        /** Show a stored image in the guide-camera dock (a tab of its own where there is no dock). */
        view(entry, name) {
            const title = `${entry.id} ${name === "master.fits" ? "master" : name}`;
            const camera = Alpine.store("camera");
            if (camera) camera.show(this.filePath(entry, name), title, { open: true });
            else window.open(this.viewUrl(entry, name), "_blank", "noopener");
        },
        /** Delete an entry's frames and master from the control machine, after asking. */
        async discard(entry) {
            const what = `${entry.id} (${entry.count} ${entry.count === 1 ? "frame" : "frames"}, ${entry.exposure_s} s, gain ${entry.gain})`;
            const ok = await uiConfirm(`Discard ${what}? Its frames and its master are deleted from the disk.`, {
                title: "Discard calibration frames", ok: "Discard", cancel: "Keep",
            });
            if (!ok) return;
            const path = this.filePath(entry, "");
            try {
                await api("DELETE", `${ROOT}/sessions/${encodeURIComponent(this.chosen)}/entries/${entry.id}`);
                const camera = Alpine.store("camera");
                if (camera?.view?.path?.startsWith(path)) camera.live();  // the dock was showing it
                await this.load(true);
                showToast("success", "Discarded", `${entry.id} is gone`);
            } catch (e) { this.error = String(e.message || e); }
        },
        when(ms) { return new Date(ms).toLocaleString([], { dateStyle: "short", timeStyle: "medium" }); },
        roiText(roi) { return roi ? `${roi.width}×${roi.height} @ ${roi.x},${roi.y}` : "full"; },
    }));
});
