/*
 * The column of indicators beside the guide-camera dock (templates/components/dock_indicators.html):
 * small pictures of mechanisms that are otherwise only numbers on a tab. Each is an Alpine component
 * that reads the status store; adding one is a component here and a block in the template.
 *
 *  - "adcIndicator": the two prism pairs of the ADC as two rings that turn with their stages, each
 *    with a tick that sits at the fixed index (top) when the pair is at its reference; the direction
 *    the dispersion must have (the parallactic angle seen from the slit) as a dashed line; and the
 *    dispersion the pairs make as an arrow, which lies along that line when tracking cancels the
 *    atmosphere. Angles are counter-clockwise from the top, as in the slit overlay.
 *  - "slitIndicator": the slit's gap between its fixed jaw and the moving one, over its 0.5-4 arcsec.
 *  - "coverIndicator": the instrument cover, a cloth drawn over its window, closing or opening.
 *
 * The status stream ticks about once a second, so the rings turn by a CSS transition of that length
 * between samples, and the angles drawn are unwrapped so a ring never turns the long way round.
 * On the Instrument Operator's pages an indicator jumps to its panel; the TO's page has no session,
 * so there they only show. All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const wilds = () => Alpine.store("wilds");
    const linkable = () => !!Alpine.store("session");  // the TO page has none: nothing to jump to
    const wrap = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
    const rad = (d) => (d * Math.PI) / 180;
    const num = (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? "—" : Number(v).toFixed(digits));
    /** A point at angle ``a`` (counter-clockwise from the top) and radius ``r`` about the middle of a 100-wide view. */
    const point = (a, r) => [50 - r * Math.sin(rad(a)), 50 - r * Math.cos(rad(a))];

    /** What every indicator shares: linking to its panel. The getters are copied as getters (an
     *  object spread would run them once and keep their values). */
    const withBase = (target, obj) => Object.defineProperties(obj, Object.getOwnPropertyDescriptors({
        get linked() { return linkable(); },
        open() {
            if (!this.linked) return;
            try { localStorage.setItem(target[1], target[2]); } catch { /* private mode */ }
            window.location.assign(target[0]);
        },
    }));

    // -- the ADC ---------------------------------------------------------------------------------
    Alpine.data("adcIndicator", () => withBase(["/io/operations/", "wilds-ops-tab", "adc"], {
        a1: 0, a2: 0,          // the angles drawn, unwrapped
        dir: 0,                // the direction of the arrow, unwrapped

        init() {
            const follow = (key, read) => this.$watch(read, (v) => {
                if (v !== null && v !== undefined) this[key] += wrap(v - this[key]);
            });
            this.a1 = this.adc?.pair1_deg ?? 0;
            this.a2 = this.adc?.pair2_deg ?? 0;
            this.dir = this.adc?.direction_deg ?? 0;
            follow("a1", () => this.adc?.pair1_deg);
            follow("a2", () => this.adc?.pair2_deg);
            follow("dir", () => (this.makes > 0.03 ? this.adc?.direction_deg : null));
        },
        get adc() { return wilds().adc; },
        get installed() { return this.adc?.installed !== false; },
        get known() { return !!this.adc && this.installed; },
        get makes() { return this.known ? (this.adc.dispersion_arcsec ?? 0) : 0; },
        get target() { return this.known && this.adc.tracking ? this.adc.target : null; },
        get moving() { return this.known && !!this.adc.moving; },
        // what is drawn
        ringStyle(a) { return `transform: rotate(${-a}deg)`; },
        get arrowStyle() { return `transform: rotate(${-this.dir}deg)`; },
        get arrowLength() { return Math.min(36, (36 * this.makes) / (this.adc?.dmax_arcsec || 6)); },
        get showArrow() { return this.makes > 0.03; },
        get parallactic() {
            const t = this.target;
            if (!t) return null;
            const [x1, y1] = point(t.direction_deg, 44), [x2, y2] = point(t.direction_deg + 180, 44);
            return { x1, y1, x2, y2 };
        },
        goal(n) {
            const g = this.moving ? this.adc[`goal${n}_deg`] : null;
            if (g === null || g === undefined) return null;
            const r0 = n === 1 ? 34 : 23, r1 = n === 1 ? 43 : 32;
            const [x1, y1] = point(g, r0), [x2, y2] = point(g, r1);
            return { x1, y1, x2, y2 };
        },
        get caption() {
            if (!this.adc) return "…";
            if (!this.installed) return "not installed";
            return this.makes > 0.03 ? `${num(this.makes, 2)}″ @ ${num(this.adc.direction_deg, 0)}°` : this.adc.tracking ? "0″" : "off";
        },
        get tip() {
            if (!this.adc) return "The ADC's state is not known yet";
            if (!this.installed) return "The ADC is not installed";
            const a = this.adc, t = this.target;
            const lines = [
                `ADC: pair 1 ${num(a.pair1_deg, 2)}°, pair 2 ${num(a.pair2_deg, 2)}°${a.moving ? " (moving)" : ""}`,
                `makes ${num(a.dispersion_arcsec, 2)}″ directed ${num(a.direction_deg, 1)}° (at most ${num(a.dmax_arcsec, 1)}″)`,
                `tracking: ${a.tracking ? a.tracking_state : "off"}`,
            ];
            if (t) {
                lines.push(
                    `the atmosphere needs ${num(t.atmosphere_arcsec, 2)}″ at zenith distance ${num(t.zenith_distance_deg, 1)}°`,
                    `parallactic angle ${num(t.parallactic_angle_deg, 1)}° on the sky, slit PA ${num(t.rot_pa_deg, 1)}°: ${num(t.direction_deg, 1)}° in the instrument`,
                );
                if (t.saturated) lines.push("more than the ADC can cancel");
            }
            if (this.linked) lines.push("Click: the ADC tab");
            return lines.join("\n");
        },
        // the geometry of the arrow's head, drawn pointing up (the group is turned to its direction)
        get arrowHead() {
            const y = 50 - this.arrowLength;
            return `47.2,${y + 5.5} 52.8,${y + 5.5} 50,${y - 1}`;
        },
    }));

    // -- the slit --------------------------------------------------------------------------------
    Alpine.data("slitIndicator", () => withBase(["/io/engineering/calibration/", "wilds-cal-tab", "slit"], {
        last: null,            // the last width seen: the gap stays drawn while the stage moves
        init() {
            this.$watch(() => wilds().slit?.width_arcsec, (v) => { if (v !== null && v !== undefined) this.last = v; });
            this.last = wilds().slit?.width_arcsec ?? null;
        },
        get slit() { return wilds().slit; },
        get widest() { return this.slit ? this.slit.max_um / this.slit.um_per_arcsec : 4; },
        get width() { return this.slit?.width_arcsec ?? this.last; },
        get moving() { return !!this.slit?.moving; },
        /** The gap, from the fixed jaw's edge (x = 30) to the moving jaw's. */
        get gap() { return 3 + 58 * Math.min(1, Math.max(0, (this.width ?? 0) / this.widest)); },
        get caption() { return this.slit ? (this.width === null ? "—" : `${num(this.width, 2)}″`) + (this.moving ? " …" : "") : "…"; },
        get tip() {
            const s = this.slit;
            if (!s) return "The slit's state is not known yet";
            const lines = [
                `Slit gap ${num(this.width, 3)}″${this.moving ? " (moving)" : ""}, of 0.5–${num(this.widest, 0)}″`,
                `stage at ${num(s.position_um, 1)} µm${s.preset ? `, the ${s.preset} preset` : ""}`,
                "only the right-hand jaw moves; the left one is fixed",
            ];
            if (this.linked) lines.push("Click: the slit calibration");
            return lines.join("\n");
        },
    }));

    // -- the instrument cover ---------------------------------------------------------------------
    Alpine.data("coverIndicator", () => withBase(["/io/engineering/calibration/", "wilds-cal-tab", "cover"], {
        get cover() { return wilds().cover; },
        get state() { return this.cover?.state ?? "unknown"; },
        /** How much of the window the cloth covers when it has arrived. */
        get goal() { return { closed: 1, closing: 1, open: 0, opening: 0 }[this.state] ?? 0.5; },
        get clothHeight() { return 68 * this.goal; },
        get clothStyle() { return `transition-duration: ${this.cover?.travel_s ?? 5}s`; },
        get caption() { return this.cover ? ({ opening: "opening…", closing: "closing…" }[this.state] ?? this.state) : "…"; },
        get tip() {
            const c = this.cover;
            if (!c) return "The instrument cover's state is not known yet";
            const lines = [`Instrument cover: ${this.state}`, c.sensed ? "reported by the instrument cube" : "following the commands sent"];
            if (this.linked) lines.push("Click: the cover");
            return lines.join("\n");
        },
    }));
});
