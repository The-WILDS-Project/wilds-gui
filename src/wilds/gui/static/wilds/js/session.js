/*
 * This browser's session with wilds-control (plan §3.11), shared by every page as the Alpine
 * store "session".
 *
 * One session per browser: its id lives in localStorage, so tabs share it. It is created on
 * first visit (asking for a name, kept in the browser), kept alive with a heartbeat, and
 * recreated if wilds-control no longer knows it (restart, or a missed-heartbeat timeout).
 *
 * The heartbeat reply carries the session's name and short code, so every tab and reload has
 * them. `provenance` is plain text from wilds-control saying where this session comes from
 * (address, origin, browser hints, VNC desktop); the header shows it as a tooltip on the
 * short code. The lease token is held here for later command calls.
 */
document.addEventListener("alpine:init", () => {
    const KEY_ID = "wilds.sessionId";
    const KEY_NAME = "wilds.sessionName";
    const HEARTBEAT_MS = 10000;
    const PENDING_MS = 2000;
    const base = document.body.dataset.controlUrl;

    Alpine.store("session", {
        ready: false,
        error: null,
        name: null,
        code: null,
        provenance: "",
        holder: false,
        engineering: false,
        requested: false,
        refused: false,          // the TO refused your last request; asking again clears it
        refusalReason: null,
        token: null,

        /** This session's own control status, shown in the topbar: granted | requested | refused | none. */
        get controlStatus() {
            const wilds = Alpine.store("wilds").control;
            // The holder's code is public in the status stream, so "granted" shows within a second.
            if (this.holder || (this.code && wilds.holder_code === this.code)) return "granted";
            if (this.requested) return "requested";
            if (this.refused) return "refused";
            return "none";
        },

        /** The Instrument Operator header's pill: this session's own status {text, cls, tip}. */
        get controlView() {
            const w = Alpine.store("wilds").control;
            const status = this.controlStatus;
            const tip = [
                w.holder ? `Held by ${w.holder} [${w.holder_code}]` : "Nobody holds control",
                w.holder_info,   // where the holder comes from
                status === "requested" ? "Your request is waiting for the Telescope Operator" + (Alpine.store("wilds").to.online === false ? " (offline)" : "") : "",
                status === "refused" ? "Refused" + (this.refusalReason ? `: ${this.refusalReason}` : "") : "",
            ].filter(Boolean).join("\n");
            return {
                text: status + (status === "granted" && this.engineering ? " · engineering" : ""),
                cls: { granted: "ui-success", requested: "ui-info", refused: "ui-danger", none: "ui-secondary" }[status],
                tip,
            };
        },

        // Actions that depend only on this session (greyed out with a reason, plan §3.12).
        get local() {
            let request = { ok: true, why: "" };
            if (!this.ready) request = { ok: false, why: "Not connected to the server" };
            else if (this.holder) request = { ok: false, why: "You already hold control" };
            const notYet = { ok: false, why: "Not implemented on the server yet" };
            return {
                request_control: request,
                cal_lamps: notYet, cal_slit: notYet, cal_adc: notYet, cal_focus: notYet,
                cal_bias: notYet, cal_dark: notYet, cal_flat: notYet,
                guiding_start: notYet, guiding_stop: notYet,
                acquire_start: notYet, acquire_stop: notYet,
            };
        },

        /** Take control in engineering mode (plan §3.11): the passphrase is checked by wilds-control. */
        async enterEngineering(passphrase) {
            const response = await fetch(`${base}/control/engineering`, {
                method: "POST",
                headers: { "X-Session-Id": read(KEY_ID) || "", "Content-Type": "application/json" },
                body: JSON.stringify({ passphrase }),
            });
            if (response.status === 403) throw new Error("Wrong engineering passphrase");
            if (!response.ok) throw new Error(await problem(response));
            this.holder = true;
            this.engineering = true;
            await tick();  // pick up the lease token
        },

        /** Give control up (the holder releases). */
        async release() {
            const response = await fetch(`${base}/control`, {
                method: "DELETE",
                headers: { "X-Session-Id": read(KEY_ID) || "" },
            });
            if (!response.ok) throw new Error(await problem(response));
            this.holder = false;
            this.engineering = false;
            this.token = null;
        },

        /** Ask for control; the TO grants it after you give them your name and short code. */
        async requestControl() {
            const id = read(KEY_ID);
            try {
                const response = await fetch(`${base}/control/requests`, {
                    method: "POST",
                    headers: { "X-Session-Id": id || "" },
                });
                if (!response.ok) throw new Error(await problem(response));
                this.requested = true;
                schedule();
                const to = Alpine.store("wilds").to.online === false
                    ? " The Telescope Operator is offline; the request waits for them." : "";
                showToast("info", "Control requested",
                    `Tell the Telescope Operator your name and code: ${this.name} ${this.code}.${to}`);
            } catch (e) {
                showToast("error", "Could not request control", String(e.message || e));
            }
        },
    });

    // Alpine.store(name, value) returns nothing when setting; get the reactive store afterwards.
    const store = Alpine.store("session");

    const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
    const write = (key, value) => {
        try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* private mode */ }
    };
    const hints = () => ({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        page_host: location.host,
        screen: `${screen.width}x${screen.height}`,
        language: navigator.language,
    });

    async function problem(response) {
        const body = await response.json().catch(() => ({}));
        return body.message || body.detail || `HTTP ${response.status}`;
    }

    async function create() {
        let name = read(KEY_NAME);
        if (!name) {
            name = (await uiPrompt("Your name and where you are, shown to the Telescope Operator.", {
                title: "Who are you?",
                placeholder: "e.g. Arie (Rehovot)",
            })) || "Guest";
            write(KEY_NAME, name);
        }
        const response = await fetch(`${base}/sessions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, hints: hints() }),
        });
        if (!response.ok) throw new Error(await problem(response));
        const made = await response.json();
        write(KEY_ID, made.session_id);
        store.name = name;
        store.code = made.code;
        store.provenance = made.provenance;
    }

    async function beat() {
        const id = read(KEY_ID);
        if (!id) return create().then(beat);
        const response = await fetch(`${base}/sessions/${encodeURIComponent(id)}/heartbeat`, { method: "POST" });
        if (response.status === 404) {
            write(KEY_ID, null);
            return create().then(beat);
        }
        if (!response.ok) throw new Error(await problem(response));
        const hb = await response.json();
        const before = store.controlStatus;
        store.name = hb.name;
        store.code = hb.code;
        store.holder = hb.holder;
        store.engineering = hb.engineering;
        store.requested = hb.requested;
        store.refused = hb.refused;
        store.refusalReason = hb.refusal_reason;
        store.provenance = hb.provenance;
        store.token = hb.lease_token;
        store.error = null;
        store.ready = true;
        const after = store.controlStatus;
        if (before === "requested" && after === "refused") {
            showToast("warning", "Control request refused", store.refusalReason || "The Telescope Operator refused it.");
        } else if (before === "requested" && after === "granted") {
            showToast("success", "Control granted", "You now hold control.");
        }
    }

    // Heartbeat every 10 s; every 2 s while a request is waiting, so the answer shows promptly.
    // schedule() restarts the timer, so a new request is polled at the short interval at once
    // instead of after the current 10 s wait.
    let timer = null;
    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(async () => { await tick(); schedule(); }, store.requested ? PENDING_MS : HEARTBEAT_MS);
    }

    async function tick() {
        try {
            await beat();
        } catch (e) {
            store.error = String(e.message || e);
            console.error("wilds session:", e);
        }
    }

    setTimeout(async () => {
        const run = () => tick();
        if (navigator.locks) await navigator.locks.request("wilds-session", run);
        else await run();
        schedule();
    }, 0);
});
