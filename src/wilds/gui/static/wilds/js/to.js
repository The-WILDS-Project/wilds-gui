/*
 * The Telescope Operator's session list (plan §3.11): the holder, the requests and the
 * viewers, each with where it comes from as a tooltip on the short code.
 *
 * The list needs the TO passphrase, asked for once and kept for this tab only
 * (sessionStorage). Everything shown is inserted as text, never HTML.
 */
document.addEventListener("alpine:init", () => {
    const KEY = "wilds.toPassphrase";
    const POLL_MS = 5000;
    // A request that never answers must not end the polling: the next poll is only scheduled
    // after this one, and the polling is what tells wilds-control the TO is there.
    const TIMEOUT_MS = 10000;
    // Chrome runs a hidden tab's chained timers about once a minute after five minutes, which
    // leaves little margin against the server's 75 s presence timeout. Timers inside a Web
    // Worker are not throttled, so one worker keeps the beat and the page polls on its messages.
    const BEAT = "setInterval(() => postMessage(0), " + POLL_MS + ");";
    const base = document.body.dataset.controlUrl;

    Alpine.data("toSessions", () => ({
        passphrase: sessionStorage.getItem(KEY) || "",
        entry: "",
        holder: null,
        engineering: false,
        requests: [],
        viewers: [],
        error: null,
        timer: null,
        worker: null,
        polling: false,

        get unlocked() { return this.passphrase !== ""; },

        start() {
            this.startBeat();
            if (this.unlocked) this.poll();
            // A hidden tab's timers are throttled (about one a minute) and a sleeping laptop
            // misses its polls: show up at once when the tab or the network comes back.
            const again = () => { if (this.unlocked && !document.hidden) this.poll(); };
            document.addEventListener("visibilitychange", again);
            window.addEventListener("online", again);
            window.addEventListener("focus", again);
        },
        /** The worker's beat polls; without a worker (or until it exists) a timer chain does. */
        startBeat() {
            try {
                this.worker = new Worker(URL.createObjectURL(new Blob([BEAT], { type: "text/javascript" })));
                this.worker.onmessage = () => { if (this.unlocked && !this.polling) this.poll(); };
            } catch {
                this.worker = null;  // poll() falls back to its own timer
            }
        },
        unlock() {
            this.passphrase = this.entry.trim();
            this.entry = "";
            try { sessionStorage.setItem(KEY, this.passphrase); } catch { /* ignore */ }
            this.poll();
        },
        lock(message) {
            clearTimeout(this.timer);
            this.passphrase = "";
            try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
            this.error = message;
        },
        /** POST a TO action; refresh the list on success, toast the reason on failure. */
        async act(path, body, done) {
            try {
                const response = await fetch(`${base}${path}`, {
                    method: "POST",
                    headers: { "X-TO-Passphrase": this.passphrase, "Content-Type": "application/json" },
                    body: JSON.stringify(body || {}),
                });
                if (response.status === 403) return this.lock("Wrong Telescope Operator passphrase");
                if (!response.ok) {
                    const detail = (await response.json().catch(() => ({}))).detail;
                    throw new Error(detail || `HTTP ${response.status}`);
                }
                showToast("success", done);
                await this.poll();
            } catch (e) {
                showToast("error", "Action failed", String(e.message || e));
            }
        },
        async grant(r) {
            const now = this.holder && this.holder.code !== r.code
                ? `${this.holder.name} [${this.holder.code}] holds control now and will drop to read-only. `
                : "";
            const ok = await uiConfirm(`${now}Grant control to ${r.name} [${r.code}]?`, {
                title: "Grant control", ok: "Grant",
            });
            if (ok) await this.act(`/control/requests/${encodeURIComponent(r.code)}/grant`, {}, `Control granted to ${r.name}`);
        },
        async refuse(r) {
            const reason = await uiPrompt(`Reason for refusing ${r.name} [${r.code}] (optional)`, {
                title: "Refuse request", ok: "Refuse",
            });
            if (reason === null) return;
            await this.act(`/control/requests/${encodeURIComponent(r.code)}/refuse`, { reason }, `Refused ${r.name}`);
        },
        async revoke() {
            const ok = await uiConfirm(`Take control away from ${this.holder.name} [${this.holder.code}]?`, {
                title: "Revoke control", ok: "Revoke",
            });
            if (ok) await this.act("/control/revoke", {}, "Control revoked");
        },
        async poll() {
            clearTimeout(this.timer);
            this.polling = true;
            try {
                const response = await fetch(`${base}/control/sessions`, {
                    headers: { "X-TO-Passphrase": this.passphrase },
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                });
                if (response.status === 403) return this.lock("Wrong Telescope Operator passphrase");
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const view = await response.json();
                this.holder = view.holder;
                this.engineering = view.engineering;
                this.requests = view.requests;
                this.viewers = view.viewers;
                this.error = null;
            } catch (e) {
                this.error = e.name === "TimeoutError" ? "server: no answer" : `server: ${e.message || e}`;
            } finally {
                this.polling = false;
            }
            if (!this.worker) this.timer = setTimeout(() => this.poll(), POLL_MS);
        },
    }));
});
