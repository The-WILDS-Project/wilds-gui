/*
 * Live status from wilds-control, shared by every page as the Alpine store "wilds".
 *
 * wilds-control's GET /status/stream (SSE, plan §2) isn't built yet. Until it is, the store
 * stays "unknown" and the link shows offline, which is the truth. Field names follow the
 * plan (§3.11, §3.12) and will be fixed when the status model exists.
 */
document.addEventListener("alpine:init", () => {
    Alpine.store("wilds", {
        link: "connecting",          // connecting | ok | offline
        lastUpdate: null,
        control: { holder: null, engineering: false },
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
            return this.actions[name] || { ok: false, why: "Status from wilds-control not available" };
        },
        get previewText() {
            if (this.tcs.preview === true) return "Preview on: targets need TO approval";
            if (this.tcs.preview === false) return "Preview off: targets slew immediately";
            return "Preview unknown: assume TO approval is needed";
        },
    });

    const base = document.body.dataset.controlUrl;
    let retry = 1000;
    function connect() {
        let source;
        try {
            source = new EventSource(`${base}/status/stream`);
        } catch (e) {
            Alpine.store("wilds").link = "offline";
            return;
        }
        source.addEventListener("open", () => { Alpine.store("wilds").link = "ok"; retry = 1000; });
        source.addEventListener("status", (e) => {
            const s = Alpine.store("wilds");
            Object.assign(s, JSON.parse(e.data));
            s.lastUpdate = new Date();
        });
        source.addEventListener("error", () => {
            Alpine.store("wilds").link = "offline";
            source.close();
            setTimeout(connect, retry);
            retry = Math.min(retry * 2, 30000);
        });
    }
    if (base) connect();
});
