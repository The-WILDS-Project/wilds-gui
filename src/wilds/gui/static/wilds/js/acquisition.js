/*
 * The Acquisition tab's target entry (Instrument Operator → Operations, plan §3.3, §3.12):
 * coordinates (or a name, which Resolve turns into coordinates through wilds-control's
 * GET /resolve), the slit's sky PA, and the slew with its progress. Only the coordinates are sent.
 *
 * The slew is a job on wilds-control (POST /telescope/slew). Nobody approves it: the TCS acts on
 * it while it accepts external commands (the header's "TCS: accepts/rejects"; the button says why
 * not when it rejects). The job's message says which step it is at (sent, in progress, done),
 * and progress is read from the telescope's own telemetry there, never assumed from having sent.
 * All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const wilds = () => Alpine.store("wilds");

    const sessionId = () => {
        try { return localStorage.getItem("wilds.sessionId") || ""; } catch { return ""; }
    };

    async function api(method, path, body) {
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

    /** "12.5", "12:30:00", "12 30 00" or "12h30m00s" -> number, or null. ``parts`` are h/d, m, s. */
    function sexagesimal(text) {
        const t = String(text).trim().replace(/[hdms°′″'"]/gi, " ").replace(/:/g, " ").trim();
        if (!t) return null;
        const bits = t.split(/\s+/);
        if (bits.length > 3 || bits.some((b) => !/^[-+]?\d+(\.\d+)?$/.test(b))) return null;
        const sign = bits[0].startsWith("-") ? -1 : 1;
        const [a, b = 0, c = 0] = bits.map((x) => Math.abs(Number(x)));
        if (b >= 60 || c >= 60) return null;
        return sign * (a + b / 60 + c / 3600);
    }

    const two = (n) => String(n).padStart(2, "0");
    /** hours -> "12h 30m 05.0s" */
    function hms(hours) {
        let s = Math.round(hours * 3600 * 10) / 10;
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return `${two(h)}h ${two(m)}m ${s.toFixed(1).padStart(4, "0")}s`;
    }
    /** degrees -> "+41° 16′ 09″" */
    function dms(deg) {
        const sign = deg < 0 ? "-" : "+";
        let s = Math.round(Math.abs(deg) * 3600);
        const d = Math.floor(s / 3600); s -= d * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return `${sign}${two(d)}° ${two(m)}′ ${two(s)}″`;
    }

    /** hours -> "03:30:00.00" (what the RA field is filled with) */
    function raField(hours) {
        let s = Math.round(hours * 3600 * 100) / 100;
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return `${two(h)}:${two(m)}:${s.toFixed(2).padStart(5, "0")}`;
    }
    /** degrees -> "+21:15:00.0" */
    function decField(deg) {
        let s = Math.round(Math.abs(deg) * 3600 * 10) / 10;
        const d = Math.floor(s / 3600); s -= d * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return `${deg < 0 ? "-" : "+"}${two(d)}:${two(m)}:${s.toFixed(1).padStart(4, "0")}`;
    }

    // The rule: if both coordinates are valid, the name is ignored. A name is only ever asked
    // about with Resolve, which puts what it found in the coordinate fields; what is sent to
    // wilds-control is the coordinates and nothing else.
    Alpine.data("acquisitionTarget", () => ({
        name: "",
        ra: "",
        dec: "",
        pa: 0,                   // the slit's sky PA, degrees East of North
        found: null,             // what Resolve said, while the fields still hold it: {name, ...}
        resolving: false,
        error: null,
        jobId: null,
        sending: false,

        // -- the target ----------------------------------------------------------------------
        /** {ra_hours, dec_deg} to send, or null unless both coordinates are valid. */
        get target() {
            const ra = sexagesimal(this.ra);
            const dec = sexagesimal(this.dec);
            if (ra === null || dec === null || ra < 0 || ra >= 24 || dec < -90 || dec > 90) return null;
            return { ra_hours: ra, dec_deg: dec };
        },
        get coordinatesText() {
            const t = this.target;
            return t ? `${hms(t.ra_hours)}  ${dms(t.dec_deg)}` : "";
        },
        get nameHint() {
            if (this.target && this.name.trim()) return "Ignored while both coordinates are valid; Resolve replaces them";
            return this.name.trim() ? "Resolve to fill in the coordinates" : "";
        },
        async resolve() {
            const asked = this.name.trim();
            if (!asked) return;
            this.resolving = true; this.error = null; this.found = null;
            try {
                const r = await api("GET", `/resolve?name=${encodeURIComponent(asked)}`);
                this.ra = raField(r.ra_j2000_hours);
                this.dec = decField(r.dec_j2000_degs);
                this.found = { ...r, asked, ra: this.ra, dec: this.dec };
            } catch (e) { this.error = String(e.message || e); }
            this.resolving = false;
        },
        /** Where the coordinates came from, while the fields still hold what Resolve found. */
        get matchText() {
            const r = this.found;
            if (!r || r.ra !== this.ra || r.dec !== this.dec) return "";
            const who = [r.resolver, r.database].filter(Boolean).join(" / ");
            return `${r.asked} resolved${r.canonical_name ? `, matched ${r.canonical_name}` : ""} (${who})`;
        },

        // -- the slew --------------------------------------------------------------------------
        get label() { return "Slew"; },
        get paValid() { return Number.isFinite(Number(this.pa)) && String(this.pa).trim() !== ""; },
        get whyNot() {
            const s = session();
            if (!s?.holder) return "Request control first: only the holder can command the telescope";
            if (s.engineering) return "Engineering mode does not command the telescope";
            const action = wilds().action("slew");
            if (!action.ok) return action.why || "The telescope is not available";
            if (this.job) return "A telescope command is in progress";
            if (!this.target) return "Enter valid coordinates (RA and Dec), or a name and Resolve";
            if (!this.paValid) return "Slit PA: a number of degrees";
            return "";
        },
        async slew() {
            if (this.whyNot) return;
            const t = this.target;
            this.sending = true; this.error = null;
            try {
                const job = await api("POST", "/telescope/slew", { ...t, rot_pa: Number(this.pa) });
                this.jobId = job.id;
            } catch (e) { this.error = String(e.message || e); }
            this.sending = false;
        },

        // -- following the job -------------------------------------------------------------
        get job() {
            const j = (wilds().jobs || []).find((x) => x.id === this.jobId);
            return j && (j.state === "running" || j.state === "queued") ? j : null;
        },
        get last() {
            const j = (wilds().jobs || []).find((x) => x.id === this.jobId);
            return j && !(j.state === "running" || j.state === "queued") ? j : null;
        },
        get percent() { return Math.round(100 * (this.job?.progress?.fraction ?? 0)); },
        get outcome() {
            const j = this.last;
            if (!j) return null;
            if (j.state === "done") return { cls: "ui-success", text: `On target ${j.result?.target ?? ""}` };
            if (j.state === "cancelled") return { cls: "ui-secondary", text: "Cancelled" };
            return { cls: "ui-danger", text: j.error?.message || "The slew failed" };
        },
        cancel() { return Alpine.store("jobs").cancel(this.job.id); },

        // -- what the telescope says ---------------------------------------------------------
        get telescope() { return wilds().telescope?.telemetry || null; },
        get nowText() {
            const t = this.telescope;
            if (!t || !t.target) return "No target yet";
            const where = t.in_position === false ? "moving" : "in position";
            return `${t.target.name}  ${hms(t.target.ra_hours)}  ${dms(t.target.dec_deg)} · ${where} · slit PA ${t.rot_pa?.toFixed(1) ?? "?"}°`;
        },
    }));

    // -- adjusting: offsets and rotation (the slit overlay, static/wilds/js/slit.js) -------------

    const slit = () => Alpine.store("slit");

    /** Why this session cannot command the telescope now (for ``action``), or "". */
    function commandWhyNot(action) {
        const s = session();
        if (!s?.holder) return "Request control first: only the holder can command the telescope";
        if (s.engineering) return "Engineering mode does not command the telescope";
        const a = wilds().action(action);
        return a.ok ? "" : a.why || "The telescope is not available";
    }

    /** Following one job at a time: ``jobId``, the job while it runs, and how it ended. */
    function withJob(obj) {
        return Object.defineProperties(obj, Object.getOwnPropertyDescriptors({
            jobId: null,
            get job() {
                const j = (wilds().jobs || []).find((x) => x.id === this.jobId);
                return j && (j.state === "running" || j.state === "queued") ? j : null;
            },
            get last() {
                const j = (wilds().jobs || []).find((x) => x.id === this.jobId);
                return j && !(j.state === "running" || j.state === "queued") ? j : null;
            },
            get percent() { return Math.round(100 * (this.job?.progress?.fraction ?? 0)); },
            get outcome() {
                const j = this.last;
                if (!j) return null;
                if (j.state === "done") return { cls: "ui-success", text: "Done" };
                if (j.state === "cancelled") return { cls: "ui-secondary", text: "Cancelled" };
                return { cls: "ui-danger", text: j.error?.message || "It failed" };
            },
            cancel() { return Alpine.store("jobs").cancel(this.job.id); },
            /** Send a command as a job, and follow it. */
            async submit(path, body) {
                this.sending = true; this.error = null;
                try { this.jobId = (await api("POST", path, body)).id; }
                catch (e) { this.error = String(e.message || e); }
                this.sending = false;
            },
        }));
    }

    // -- the slit stage: where it is, and a slider to move it (POST /slit/move) ----------------
    Alpine.data("acquisitionSlit", () => ({
        pendingUm: null,     // what the slider and the boxes hold, in microns; null: follow the stage
        sending: false,
        error: null,

        get slit() { return wilds().slit; },
        get known() { return this.slit?.position_um !== null && this.slit?.position_um !== undefined; },
        get perArcsec() { return this.slit?.um_per_arcsec || 124.69; },
        get maxUm() { return this.slit?.max_um ?? 21000; },
        get minUm() { return this.slit?.min_um ?? 0; },
        /** The stage's opening now: "10500 µm · 84.2 arcsec · 50 % of travel". */
        get nowText() {
            const s = this.slit;
            if (!s || !this.known) return "unknown";
            const um = s.position_um;
            const span = (s.max_um - s.min_um) || 1;
            const text = `${um.toFixed(um < 100 ? 1 : 0)} µm · ${(um / this.perArcsec).toFixed(um < 100 ? 3 : 2)} arcsec · ${(100 * (um - s.min_um) / span).toFixed(1)} % open`;
            return s.moving ? `${text} (moving…)` : text;
        },
        get percentNow() {
            const s = this.slit;
            return this.known ? Math.max(0, Math.min(100, 100 * (s.position_um - s.min_um) / ((s.max_um - s.min_um) || 1))) : 0;
        },
        get presetText() { return this.slit?.preset ? `at the ${this.slit.preset} preset` : ""; },

        // what the controls hold: the pending value, or the stage's own position
        get um() { return this.pendingUm ?? (this.known ? this.slit.position_um : this.minUm); },
        get arcsec() { return this.um / this.perArcsec; },
        // A box being typed in keeps what was typed (it is not rewritten from the other units).
        editing: null,       // "um" | "arcsec" | null
        typed: "",
        get umText() { return this.editing === "um" ? this.typed : this.um.toFixed(this.um < 100 ? 1 : 0); },
        get arcsecText() { return this.editing === "arcsec" ? this.typed : this.arcsec.toFixed(this.arcsec < 1 ? 3 : 2); },
        setUm(text, box = null) {
            this.editing = box; this.typed = String(text);
            const n = String(text).trim() === "" ? null : Number(text);
            this.pendingUm = Number.isFinite(n) ? n : null;
        },
        setArcsec(text) {
            this.editing = "arcsec"; this.typed = String(text);
            const n = String(text).trim() === "" ? null : Number(text);
            this.pendingUm = Number.isFinite(n) ? n * this.perArcsec : null;
        },
        done() { this.editing = null; },
        reset() { this.pendingUm = null; this.editing = null; },
        get changed() { return this.pendingUm !== null && (!this.known || Math.abs(this.pendingUm - this.slit.position_um) > 0.05); },

        get whyNot() {
            const s = session();
            if (!s?.holder) return "Request control first: only the holder can move the slit";
            const c = wilds().system?.components?.slit;
            if (c && !c.operational) return `The slit is not operational: ${(c.why_not_operational || []).join("; ")}`;
            if (this.slit?.moving) return "The slit is moving";
            if ((wilds().jobs || []).some((j) => (j.state === "running" || j.state === "queued") && (j.components || []).includes("slit"))) {
                return "A procedure is using the slit";
            }
            if (this.pendingUm === null) return "Move the slider or type a value first";
            if (this.pendingUm < this.minUm || this.pendingUm > this.maxUm) {
                return `The gap is 0 to ${(this.maxUm / this.perArcsec).toFixed(1)} arcsec (${this.minUm} to ${this.maxUm} µm)`;
            }
            return "";
        },
        async apply() {
            if (this.whyNot) return;
            this.sending = true; this.error = null;
            try {
                await api("POST", "/slit/move", { position_um: this.pendingUm });
                this.pendingUm = null;
            } catch (e) { this.error = String(e.message || e); }
            this.sending = false;
        },
    }));

    Alpine.data("acquisitionRotation", () => withJob({
        sending: false,
        error: null,

        init() {
            // A finished rotation: the pending angle has become the real one.
            this.$watch(() => this.last?.state, (state) => { if (state === "done") slit().pendingPa = null; });
        },
        get current() { return slit().currentPa; },
        get currentText() { return this.current === null ? "no target yet" : `${this.current.toFixed(1)}°`; },
        get pending() { return slit().pendingPa; },
        setPa(text) {
            const n = text.trim() === "" ? null : Number(text);
            slit().pendingPa = Number.isFinite(n) ? n : null;
        },
        reset() { slit().pendingPa = null; },
        get whyNot() {
            const why = commandWhyNot("rotator");
            if (why) return why;
            if (this.job) return "A telescope command is in progress";
            if (this.pending === null) return "Set the PA: drag the handle on the live view, or type an angle";
            return "";
        },
        send() { if (!this.whyNot) return this.submit("/telescope/rotator", { pa: ((this.pending % 360) + 360) % 360 }); },
    }));

    const round = (n) => Math.round(n * 1000) / 1000;
    const STEPS = [0.1, 0.25, 0.5, 1, 2, 5];

    Alpine.data("acquisitionOffsets", () => withJob({
        steps: STEPS,
        step: 1,                 // arcsec per nudge
        pending: null,           // the register's new total {d1, d2} (arcsec, east and north), or null
        sending: false,
        error: null,

        init() {
            // A point picked on the live view: move the pointing by the offset from the slit to it.
            slit().pickHandler = (e, n) => { this.moveBy(e, n); };
            this.$watch(() => this.last?.state, (state) => {
                if (state === "done") { this.pending = null; slit().pickMark = null; }
            });
        },
        get limit() { return wilds().telescope?.max_offset_arcsec ?? 120; },
        get current() {
            const o = wilds().telescope?.telemetry?.offsets?.Handset;
            return { d1: o?.d1_arcsec ?? 0, d2: o?.d2_arcsec ?? 0 };
        },
        get base() { return this.pending ?? this.current; },
        text(o) { return `E ${o.d1 >= 0 ? "+" : ""}${o.d1.toFixed(2)}″  N ${o.d2 >= 0 ? "+" : ""}${o.d2.toFixed(2)}″`; },
        moveBy(east, north) {
            const clamp = (v) => Math.max(-this.limit, Math.min(this.limit, v));
            const b = this.base;
            this.pending = { d1: round(clamp(b.d1 + east)), d2: round(clamp(b.d2 + north)) };
        },
        nudge(east, north) { this.moveBy(east * this.step, north * this.step); },
        reset() { this.pending = null; slit().pickMark = null; slit().pick = false; },
        get whyPick() { return slit().show ? "" : slit().calWhy || "The live view must be showing the guide camera with the slit overlay"; },
        togglePick() { if (!this.whyPick) slit().pick = !slit().pick; },
        get whyNot() {
            const why = commandWhyNot("offset");
            if (why) return why;
            if (this.job) return "A telescope command is in progress";
            return "";
        },
        get whyNotApply() { return this.whyNot || (this.pending ? "" : "Nudge, or pick a point, first"); },
        apply() { if (!this.whyNotApply) return this.submit("/telescope/offset", { d1_arcsec: this.pending.d1, d2_arcsec: this.pending.d2 }); },
        clear() { if (!this.whyNot) return this.submit("/telescope/offset/clear", {}); },
        async absorb() {
            if (this.whyNot) return;
            const ok = await uiConfirm("Bake the offset into the target's coordinates and clear it?", { title: "Absorb the offset", ok: "Absorb" });
            if (ok) await this.submit("/telescope/offset/absorb", {});
        },
    }));
});
