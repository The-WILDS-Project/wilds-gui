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
        opmode: "development",       // development | production (config.toml): dev-only helpers show in development
        activities: {},              // {component: [{name, since_ms, details}]}, running only (plan §3.13)
        jobs: [],                    // active jobs, then the last few finished (plan §3.14)
        guide_camera: null,          // {kind, streaming, exposing, settings, cooler, last_frame_id}; null until known
        system: null,                // WILDS as a whole: {opstate, operational, why_not_operational, components}; null until known
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
            preview: null,           // externalTargetCfgCmdPreviewIsTrue
            lockedOut: null,         // field to be identified (plan §5)
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
        get previewText() {
            if (this.tcs.preview === true) return "Preview on: targets need TO approval";
            if (this.tcs.preview === false) return "Preview off: targets slew immediately";
            return "Preview unknown: assume TO approval is needed";
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
