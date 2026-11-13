/*
 * Live status from wilds-control, shared by every page as the Alpine store "wilds".
 *
 * Fed by wilds-control's GET /status/stream (SSE, plan §2): a `status` event every second and
 * a `job` event whenever a job changes. Until it connects the store stays "unknown" and the
 * link shows offline, which is the truth. Field names follow the plan (§3.11, §3.12).
 */
document.addEventListener("alpine:init", () => {
    Alpine.store("wilds", {
        link: "connecting",          // connecting | ok | offline
        opmode: "development",       // development | ldt-simulated | ldt-production (config.toml): dev-only helpers show in development
        activities: {},              // {component: [{name, since_ms, details}]}, running only (plan §3.13)
        jobs: [],                    // active jobs, then the last few finished (plan §3.14)
        guide_camera: null,          // {kind, streaming, exposing, settings, cooler, last_frame_id}; null until known
        system: null,                // WILDS as a whole: {opstate, operational, why_not_operational, components}; null until known
        slit: null,                  // {position_um, width_arcsec, preset, moving, min_um, max_um, um_per_arcsec, lifecycle}; null until known
        telescope: null,             // {kind, lifecycle, telemetry: {target, rot_pa, offsets, in_position, accepts_commands, ...}}; null until known
        light_path: null,            // is light reaching WILDS: {state, since_ms, requested_by, note, refusal}; null until known
        conf_versions: {},           // {"component/slice": version}: an open settings form compares it with what it loaded
        lastUpdate: null,
        control: { holder: null, engineering: false, holder_code: null, holder_info: null },
        time: null,                  // the server's clock: {utc_ms, zone}
        to: { online: null },        // Telescope Operator page open and unlocked (null = unknown)
        warnings: [],                // configuration problems worth showing, e.g. an ignored [passphrases] in config.toml
        tcs: {
            state: null,             // TCSTcsStatusSV
            health: null,
            accessMode: null,        // Operator | Engineer (TCS GUI login, not a lockout)
            acceptsCommands: null,   // false: the TCS holds external commands instead of acting (its External Command Preview is on)
            stale: true,
        },
        actions: {},                 // {"slew": {"ok": false, "why": "…"}, …} (plan §3.12)

        action(name) {
            // wilds-control's per-action rules win; until it sends them, the few actions that
            // depend only on this browser's own session are worked out here (session.js).
            return this.actions[name]
                || Alpine.store("session")?.local[name]
                || { ok: false, why: "Status from the server not available" };
        },
        /** "starting up" or "shutting down" while WILDS' umbrella activity runs, else null. */
        get busyWith() {
            const names = (this.activities.wilds || []).map((a) => a.name);
            return names.includes("StartingUp") ? "starting up" : names.includes("ShuttingDown") ? "shutting down" : null;
        },
        /** What WILDS runs against (config.toml opmode): in-process simulators, LDT's simulators, or the telescope. */
        get modeView() {
            return {
                development: { text: "development", cls: "ui-warning", tip: "In-process simulators on this machine; the /dev helpers are available" },
                "ldt-simulated": { text: "ldt-simulated", cls: "ui-info", tip: "LDT's simulators (nysa) through the test broker (tanagra)" },
                "ldt-production": { text: "ldt-production", cls: "ui-success", tip: "The real telescope, through its own broker" },
            }[this.opmode] || { text: String(this.opmode), cls: "ui-secondary", tip: "" };
        },
        /** The header pills (static/wilds/js/status.js): {text, cls, tip}; text is a lower-case value. */
        get controlView() {
            const c = this.control;
            if (!c.holder) return { text: "nobody", cls: "ui-secondary", tip: "Nobody holds control" };
            const who = [c.holder, c.holder_code].filter(Boolean).join(" ");
            return c.engineering
                ? { text: `engineering · ${who}`, cls: "ui-warning", tip: c.holder_info || "" }
                : { text: who, cls: "ui-info", tip: c.holder_info || "" };
        },
        get toView() {
            const online = this.to.online;
            return {
                text: online === null ? "unknown" : online ? "online" : "offline",
                cls: online === null ? "ui-secondary" : online ? "ui-success" : "ui-warning",
                tip: online === null ? "Telescope Operator status unknown"
                    : online ? "The Telescope Operator page is open"
                    : "No Telescope Operator page is open; control requests wait for one",
            };
        },
        /** Does the TCS accept external commands? While its External Command Preview is on
         *  (externalTargetCfgCmdPreviewIsTrue) it holds an external target instead of acting on
         *  it: "rejects"; with it off it acts on what it is sent, nobody approving: "accepts". The
         *  simulated telescope of the development mode always accepts. */
        get tcsAccepts() {
            if (this.opmode === "development") return true;
            if (this.tcs.stale || this.tcs.acceptsCommands === null || this.tcs.acceptsCommands === undefined) return null;
            return this.tcs.acceptsCommands;
        },
        get tcsView() {
            const t = this.tcs;
            const accepts = this.tcsAccepts;
            const tip = [
                `TCS state: ${t.state ?? "unknown"}`,
                `Health: ${t.health ?? "unknown"}`,
                `TCS user mode: ${t.accessMode ?? "unknown"}`,
                this.tcsText,
            ].join("\n");
            if (accepts === null) return { text: "unknown", cls: "ui-secondary", tip };
            return accepts
                ? { text: "accepting cmds", cls: "ui-success", tip }
                : { text: "rejecting cmds", cls: "ui-danger", tip };
        },
        get serverView() {
            const link = this.link;
            return {
                text: { ok: "ok", connecting: "connecting", offline: "offline" }[link] || link,
                cls: { ok: "ui-success", connecting: "ui-warning", offline: "ui-danger" }[link] || "ui-secondary",
            };
        },
        /** What the header shows for WILDS: {text, cls, tip}. */
        get opView() {
            const sys = this.system;
            if (!sys) return { text: "unknown", cls: "ui-secondary", tip: "WILDS state not known yet" };
            const label = { initializing: "initializing", initialized: "initialized", startedup: "started up", shutdown: "shut down" };
            const reasons = sys.why_not_operational || [];
            const tip = [`State: ${label[sys.opstate] || sys.opstate}`, sys.operational ? "Operational" : "Not operational", ...reasons.map((r) => `· ${r}`)].join("\n");
            if (this.busyWith) return { text: this.busyWith + "…", cls: "ui-info", tip };
            if (sys.opstate === "initializing") return { text: label.initializing, cls: "ui-info", tip };
            if (sys.opstate === "startedup") {
                return sys.operational
                    ? { text: label.startedup, cls: "ui-success", tip }
                    : { text: label.startedup + ", not operational", cls: "ui-warning", tip };
            }
            return { text: label[sys.opstate] || sys.opstate, cls: "ui-secondary", tip };
        },
        /** What the header shows for the light path to WILDS (plan §3.17): {text, cls, tip, icon}. */
        get lightView() {
            const lp = this.light_path;
            if (!lp) return { text: "unknown", cls: "ui-secondary", icon: "bi-brightness-alt-high", tip: "Light path not known yet" };
            const minutes = this.time && lp.since_ms ? Math.max(0, Math.round((this.time.utc_ms - lp.since_ms) / 60000)) : 0;
            const lines = [];
            if (lp.requested_by) lines.push(`Asked by ${lp.requested_by}`);
            if (lp.note) lines.push(`TO: ${lp.note}`);
            if (lp.refusal) lines.push(`The TO could not: ${lp.refusal}`);
            const tip = (extra) => [extra, ...lines].filter(Boolean).join("\n");
            switch (lp.state) {
                case "lit": return { text: "on", cls: "ui-success", icon: "bi-brightness-high", tip: tip("Light reaches WILDS") };
                case "blocked":
                    // A blocked instrument that nobody remembers is the risk: ask after a quarter of an hour.
                    return minutes >= 15
                        ? { text: `blocked ${minutes}m`, cls: "ui-warning", icon: "bi-moon", tip: tip("Still blocked: restore the light when the darks are done") }
                        : { text: "blocked", cls: "ui-info", icon: "bi-moon", tip: tip("The TO has blocked the light to WILDS") };
                case "block_requested": return { text: "block asked…", cls: "ui-info", icon: "bi-hourglass-split", tip: tip("Waiting for the TO to block the light") };
                case "unblock_requested": return { text: "restore asked…", cls: "ui-info", icon: "bi-hourglass-split", tip: tip("Waiting for the TO to let the light in again") };
                default: return { text: "unknown", cls: "ui-secondary", icon: "bi-brightness-alt-high", tip: tip("Nobody has said whether light reaches WILDS") };
            }
        },
        get tcsText() {
            const accepts = this.tcsAccepts;
            if (accepts === true) return "External commands are accepted: the telescope acts on what WILDS sends";
            if (accepts === false) return "External commands are rejected: the TCS is not taking commands from WILDS (the Telescope Operator switches that in the TCS)";
            return "Whether the TCS accepts external commands is not known";
        },
    });

    const base = document.body.dataset.controlUrl;
    function setLink(state) {
        Alpine.store("wilds").link = state;
        document.dispatchEvent(new CustomEvent("wilds:link", { detail: state }));  // clock.js
    }
    let retry = 1000;
    function connect() {
        let source;
        try {
            source = new EventSource(`${base}/status/stream`);
        } catch (e) {
            Alpine.store("wilds").link = "offline";
            return;
        }
        source.addEventListener("open", () => { setLink("ok"); retry = 1000; });
        source.addEventListener("status", (e) => {
            const s = Alpine.store("wilds");
            Object.assign(s, JSON.parse(e.data));
            s.lastUpdate = new Date();
            document.dispatchEvent(new CustomEvent("wilds:status", { detail: s }));
        });
        // A job changed between two status events: patch it in so progress looks live.
        source.addEventListener("job", (e) => {
            const s = Alpine.store("wilds");
            const job = JSON.parse(e.data);
            const i = s.jobs.findIndex((j) => j.id === job.id);
            if (i >= 0) s.jobs[i] = job; else s.jobs.push(job);
            document.dispatchEvent(new CustomEvent("wilds:jobs", { detail: job }));
        });
        source.addEventListener("error", () => {
            setLink("offline");
            source.close();
            setTimeout(connect, retry);
            retry = Math.min(retry * 2, 30000);
        });
    }
    if (base) connect();
});
