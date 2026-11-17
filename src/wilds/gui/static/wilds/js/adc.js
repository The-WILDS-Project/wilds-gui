/*
 * The atmospheric dispersion corrector (plan §3.4; WILDS optics report §4.1). Two pairs of prisms,
 * each turned by its own stage, make a dispersion that cancels the atmosphere's: its size follows
 * the target's zenith distance, its direction the parallactic angle seen from the instrument.
 *
 * Two views of the same status (the "adc" block of the status stream):
 *  - "adcPanel": the Instrument Operator's ADC tab (Operations): where the two pairs are, what they
 *    make against what the atmosphere needs, the tracking switch (POST /adc/tracking) and setting
 *    the pairs by hand (POST /adc/move), which tracking refuses.
 *  - "adcMonitor": the technical detail for Engineering → Monitoring: the stages' own readings, the
 *    zero points, what tracking last worked out and with which weather, and the settings.
 *  - "adcCalibration": Engineering → Calibration → ADC: each pair's reference to its stage position
 *    (the zero point: what the stage reads when its pair is at the reference), saved in the ADC's
 *    calibration values (PUT /config/adc/cal) with who and why; and a jog to turn a stage, in its own
 *    coordinates, to its reference mark (POST /adc/jog), which tracking refuses.
 * All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const wilds = () => Alpine.store("wilds");
    const sessionId = () => {
        try { return localStorage.getItem("wilds.sessionId") || ""; } catch { return ""; }
    };
    const num = (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits));
    const deg = (v, digits = 1) => (v === null || v === undefined ? "—" : `${num(v, digits)}°`);
    const arc = (v, digits = 2) => (v === null || v === undefined ? "—" : `${num(v, digits)}″`);

    async function api(path, body) {
        const response = await fetch(`${base}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Session-Id": sessionId(),
                "X-Lease-Token": session()?.token || "",
            },
            body: JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.detail || `HTTP ${response.status}`);
        // Every ADC command answers with the ADC's status as it is now: show it at once, without
        // waiting for the status stream (a button would stay greyed "moving" for up to a second).
        if (data && "pair1_deg" in data && "tracking" in data) wilds().adc = data;
        return data;
    }

    /** What both views share: the status, and the reasons a command is not possible. */
    const common = {
        get adc() { return wilds().adc; },
        get known() { return !!this.adc; },
        /** The ADC is optional: not installed, nothing about it can be used (Engineering → Configuration → adc). */
        get installed() { return this.adc?.installed !== false; },
        get tracking() { return this.installed && !!this.adc?.tracking; },
        get moving() { return !!this.adc?.moving; },
        get lifeWhy() {
            const life = this.adc?.lifecycle;
            return this.installed && life && !life.operational ? `The ADC is not operational: ${(life.why_not_operational || []).join("; ")}` : "";
        },
        get whyNotCommand() {
            if (!this.installed) return "The ADC is not installed";
            if (!session()?.holder) return "Only the session holding control can command the ADC";
            return this.lifeWhy;
        },
        /** Why a hand move is not possible now, or "". */
        get whyNotMove() {
            if (this.whyNotCommand) return this.whyNotCommand;
            if (this.tracking) return "Tracking is on: switch it off to set the pairs by hand";
            if (this.moving) return "The ADC is moving";
            return "";
        },
        /** One line for the tracking state. */
        get trackingText() {
            const a = this.adc;
            if (!a) return "unknown";
            if (!this.installed) return "not installed";
            const note = a.tracking_note ? ` (${a.tracking_note})` : "";
            return {
                off: "off",
                waiting: "waiting" + note,
                holding: "holding: the pairs are where the atmosphere needs them" + note,
                moving: "moving the pairs",
                error: "error" + note,
            }[a.tracking_state] ?? a.tracking_state;
        },
    };

    // Object spread would run the getters once and copy their values; copy the getters themselves.
    const withCommon = (obj) => Object.defineProperties(obj, Object.getOwnPropertyDescriptors(common));

    // -- the operator's ADC tab ----------------------------------------------------------------
    Alpine.data("adcPanel", () => withCommon({
        pair1: "",
        pair2: "",
        editing: false,    // the boxes hold what was typed, not the pairs' own positions
        error: null,
        sending: false,

        get nowText() {
            const a = this.adc;
            if (!a) return "unknown";
            if (!this.installed) return "—";
            if (a.moving) return "moving…";
            return `pair 1 ${deg(a.pair1_deg)} · pair 2 ${deg(a.pair2_deg)}`;
        },
        get makingText() {
            const a = this.adc;
            if (!a || !this.installed || a.dispersion_arcsec === null) return "—";
            return `${arc(a.dispersion_arcsec)} of dispersion, directed ${deg(a.direction_deg)}`;
        },
        get target() { return this.adc?.tracking ? this.adc.target : null; },
        get needsText() {
            const t = this.target;
            if (!t) return this.tracking ? (this.adc.tracking_note || "waiting for the telescope") : "";
            return `${arc(t.atmosphere_arcsec)} at zenith distance ${deg(t.zenith_distance_deg)} (parallactic angle ${deg(t.parallactic_angle_deg)}, slit PA ${deg(t.rot_pa_deg)})`;
        },
        get saturated() { return !!this.target?.saturated; },

        // What the boxes show: what was typed, or where the pairs are.
        get shown1() { return this.editing ? this.pair1 : this.installed ? this.round(this.adc?.pair1_deg) : ""; },
        get shown2() { return this.editing ? this.pair2 : this.installed ? this.round(this.adc?.pair2_deg) : ""; },
        round(v) { return v === null || v === undefined ? "" : Number(v.toFixed(2)); },
        edit(which, text) {
            if (!this.editing) { this.pair1 = this.round(this.adc?.pair1_deg); this.pair2 = this.round(this.adc?.pair2_deg); }
            this.editing = true;
            this[which] = text;
        },
        reset() { this.editing = false; this.error = null; },
        get valid() { return this.editing && Number.isFinite(Number(this.pair1)) && Number.isFinite(Number(this.pair2)) && String(this.pair1).trim() !== "" && String(this.pair2).trim() !== ""; },
        get whyNotApply() {
            return this.whyNotMove || (this.valid ? "" : "Type both angles first");
        },

        async setTracking(on) {
            this.error = null;
            try { await api("/adc/tracking", { enabled: on }); }
            catch (e) { this.error = String(e.message || e); }
        },
        async apply() {
            if (this.whyNotApply) return;
            this.sending = true; this.error = null;
            try { await api("/adc/move", { pair1_deg: Number(this.pair1), pair2_deg: Number(this.pair2) }); this.editing = false; }
            catch (e) { this.error = String(e.message || e); }
            this.sending = false;
        },
    }));

    // -- Engineering → Calibration → ADC: the reference of each pair to its stage ----------------
    Alpine.data("adcCalibration", () => withCommon({
        zero1: null,         // what was typed (a string), or null: show the saved value
        zero2: null,
        reason: "",
        saving: false,
        error: null,
        steps: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 45, 90],   // degrees per press of a jog button
        step: 1,
        goto1: "",           // the reading to jog stage 1 / stage 2 to, as typed
        goto2: "",
        jogging: false,
        jogError: null,

        // -- jogging a stage: its own coordinates, the zero points play no part ---------------
        get whyNotJog() {
            if (this.whyNotCommand) return this.whyNotCommand;
            if (this.tracking) return "Tracking is on: switch it off to jog a stage (Operations → ADC)";
            if (this.moving) return "The ADC is moving";
            return "";
        },
        gotoOk(n) { const t = this[`goto${n}`]; return String(t).trim() !== "" && Number.isFinite(Number(t)); },
        whyNotGoto(n) { return this.whyNotJog || (this.gotoOk(n) ? "" : "Type the reading to go to"); },
        async jog(n, body) {
            if (this.whyNotJog) return;
            this.jogging = true; this.jogError = null;
            try { await api("/adc/jog", { stage: n, ...body }); }
            catch (e) { this.jogError = String(e.message || e); }
            this.jogging = false;
        },
        jogBy(n, sign) { return this.jog(n, { by_deg: sign * Number(this.step) }); },
        async goTo(n) {
            if (this.whyNotGoto(n)) return;
            await this.jog(n, { to_deg: Number(this[`goto${n}`]) });
            if (!this.jogError) this[`goto${n}`] = "";
        },

        saved(n) { return this.adc?.[`zero${n}_deg`] ?? 0; },
        stage(n) { return this.installed ? (this.adc?.[`stage${n}_deg`] ?? null) : null; },
        shown(n) { return this[`zero${n}`] ?? this.saved(n); },
        typed(n) { return this[`zero${n}`] !== null; },
        value(n) {
            const t = this[`zero${n}`];
            if (t === null) return this.saved(n);
            return String(t).trim() === "" ? NaN : Number(t);
        },
        edit(n, text) { this[`zero${n}`] = text; },
        /** The pair is at its reference: what the stage reads now is the zero point. */
        useReading(n) {
            const s = this.stage(n);
            if (s !== null) this[`zero${n}`] = String(Math.round(s * 1000) / 1000);
        },
        /** Where the pair would be with the zero point as it is in the box. */
        previewText(n) {
            const s = this.stage(n), z = this.value(n);
            if (s === null || !Number.isFinite(z)) return "—";
            return deg(((s - z) % 360 + 360) % 360, 2);
        },
        stageText(n) {
            if (!this.installed) return "—";
            return this.moving ? "moving…" : deg(this.stage(n), 3);
        },
        get changed() { return [1, 2].some((n) => this.typed(n) && this.value(n) !== this.saved(n)); },
        get valid() { return [1, 2].every((n) => { const v = this.value(n); return Number.isFinite(v) && v >= -360 && v <= 360; }); },
        get whyNotSave() {
            if (this.whyNotCommand) return this.whyNotCommand;
            if (this.tracking) return "Tracking is on: its pairs would move when the references change. Switch tracking off first (Operations → ADC)";
            if (this.moving) return "The ADC is moving";
            if (!this.valid) return "Each zero point is a number of degrees from -360 to 360";
            return this.changed ? "" : "Nothing changed";
        },
        reset() { this.zero1 = null; this.zero2 = null; this.reason = ""; this.error = null; },
        async save() {
            if (this.whyNotSave) return;
            this.saving = true; this.error = null;
            try {
                const current = await (await fetch(`${base}/config/adc/cal`)).json();
                const values = {};
                for (const n of [1, 2]) if (this.typed(n) && this.value(n) !== this.saved(n)) values[`zero${n}_deg`] = this.value(n);
                const response = await fetch(`${base}/config/adc/cal`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId(), "X-Lease-Token": session()?.token || "" },
                    body: JSON.stringify({ values, version: current.version, reason: this.reason || "reference to stage position" }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(data.message || data.detail || `HTTP ${response.status}`);
                this.reset();
                showToast("success", "Saved", `ADC references are now version ${data.version}`);
            } catch (e) { this.error = String(e.message || e); }
            this.saving = false;
        },
    }));

    // -- the technical detail, for Engineering → Monitoring ---------------------------------
    Alpine.data("adcMonitor", () => withCommon({
        get rows() {
            const a = this.adc;
            if (!a) return [];
            if (!this.installed) return [["Installed", "no: the ADC is not in the instrument (switch it on under Engineering → Configuration → adc)"]];
            const t = a.tracking ? a.target : null, w = a.tracking ? a.weather : null;
            const life = a.lifecycle || {};
            const rows = [
                ["Installed", "yes"],
                ["Component", `${a.kind}, ${life.opstate ?? "?"}${life.operational ? ", operational" : ", not operational" + (life.why_not_operational?.length ? `: ${life.why_not_operational.join("; ")}` : "")}`],
                ["Referenced", a.referenced ? "yes" : "no"],
                ["Stage 1 reads", `${deg(a.stage1_deg, 3)} (pair 1 at ${deg(a.pair1_deg, 3)}, zero point ${deg(a.zero1_deg, 3)})`],
                ["Stage 2 reads", `${deg(a.stage2_deg, 3)} (pair 2 at ${deg(a.pair2_deg, 3)}, zero point ${deg(a.zero2_deg, 3)})`],
                ["Pairs make", `${arc(a.dispersion_arcsec, 3)} directed ${deg(a.direction_deg, 2)} (at most ${arc(a.dmax_arcsec)})`],
                ["Direction offset", deg(a.direction_offset_deg, 2)],
                ["Tracking", `${this.trackingText}; dead-band ${deg(a.deadband_deg, 2)}, every ${num(a.update_s, 1)} s`],
            ];
            if (t) {
                const phi = Math.abs(((t.pair1_deg - t.pair2_deg + 540) % 360) - 180) / 2;
                rows.push(
                    ["Target sky", `zenith distance ${deg(t.zenith_distance_deg, 2)}, parallactic angle ${deg(t.parallactic_angle_deg, 2)}, slit PA ${deg(t.rot_pa_deg, 2)}`],
                    ["Atmosphere", `${arc(t.atmosphere_arcsec, 3)} between the band edges${t.saturated ? " (more than the ADC can cancel)" : ""}`],
                    ["Wanted", `${arc(t.dispersion_arcsec, 3)} directed ${deg(t.direction_deg, 2)}: pair 1 ${deg(t.pair1_deg, 2)}, pair 2 ${deg(t.pair2_deg, 2)} (half-angle ${deg(phi, 2)})`],
                    ["Last look", new Date(t.updated_ms).toLocaleTimeString()],
                );
            }
            if (w) rows.push(["Weather used", `${num(w.pressure_mbar, 0)} mbar, ${num(w.temperature_c, 1)} °C, ${num(w.humidity_pct, 0)} % humidity`]);
            return rows;
        },
    }));
});
