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
        token: null,

        // Actions that depend only on this session (greyed out with a reason, plan §3.12).
        get local() {
            let request = { ok: true, why: "" };
            if (!this.ready) request = { ok: false, why: "Not connected to wilds-control" };
            else if (this.holder) request = { ok: false, why: "You already hold control" };
            return { request_control: request };
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
                showToast("info", "Control requested",
                    `Tell the Telescope Operator your name and code: ${this.name} ${this.code}`);
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
        return body.detail || `HTTP ${response.status}`;
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
        store.name = hb.name;
        store.code = hb.code;
        store.holder = hb.holder;
        store.engineering = hb.engineering;
        store.requested = hb.requested;
        store.provenance = hb.provenance;
        store.token = hb.lease_token;
        store.error = null;
        store.ready = true;
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
        setInterval(tick, HEARTBEAT_MS);
    }, 0);
});
