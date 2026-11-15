/*
 * The instrument cover (Engineering → Calibration → Cover, and the guide camera's dark frames;
 * plan §3.17). Closed, the cloth cover at the top of the LDT instrument cube blocks the light to
 * WILDS, which the guide camera's darks need. Whoever holds control may move it (POST
 * /cover/close, /cover/open), but LDT asks that the Telescope Operator knows first, so a dialog
 * reminds them and nothing is sent until they confirm. The state (open, closed, opening, closing,
 * unknown) comes in the status stream. All text goes in with x-text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const wilds = () => Alpine.store("wilds");
    const sessionId = () => {
        try { return localStorage.getItem("wilds.sessionId") || ""; } catch { return ""; }
    };

    Alpine.data("coverControl", () => ({
        error: null,
        busy: false,

        get cover() { return wilds().cover; },
        get state() { return this.cover?.state ?? "unknown"; },
        get moving() { return this.state === "opening" || this.state === "closing"; },
        get whyNot() {
            if (!session()?.holder) return "Only the session holding control can move the cover";
            const life = this.cover?.lifecycle;
            if (life && !life.operational) return `The cover is not operational: ${(life.why_not_operational || []).join("; ")}`;
            if (this.moving) return `The cover is ${this.state}`;
            return "";
        },
        get closeDisabled() { return !!this.whyNot || this.state === "closed"; },
        get openDisabled() { return !!this.whyNot || this.state === "open"; },
        /** The line under the buttons: where it is going and for how long, or what the state is. */
        get note() {
            const c = this.cover;
            if (!c) return "";
            if (this.moving) return `The cover is ${this.state}; it is assumed to take ${c.travel_s} s`;
            if (this.state === "unknown") return "Nobody has moved the cover since wilds-control started, and nothing senses it";
            return "";
        },

        async move(action) {
            if (this.whyNot) return;
            const closing = action === "close";
            const ok = await uiConfirm(
                `Tell the Telescope Operator that the instrument cover is about to be ${closing ? "closed" : "opened"}, and wait for their go-ahead.`
                + (closing ? " Closing it blocks the light to WILDS." : ""),
                { title: `${closing ? "Close" : "Open"} the instrument cover?`, ok: `The TO knows: ${closing ? "close" : "open"} it` },
            );
            if (!ok) return;
            this.busy = true; this.error = null;
            try {
                const response = await fetch(`${base}/cover/${action}`, {
                    method: "POST",
                    headers: { "X-Session-Id": sessionId(), "X-Lease-Token": session()?.token || "" },
                });
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(body.message || body.detail || `HTTP ${response.status}`);
                }
            } catch (e) {
                this.error = String(e.message || e);
            }
            this.busy = false;
        },
    }));
});
