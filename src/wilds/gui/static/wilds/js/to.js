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

        get unlocked() { return this.passphrase !== ""; },

        start() {
            if (this.unlocked) this.poll();
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
            try {
                const response = await fetch(`${base}/control/sessions`, {
                    headers: { "X-TO-Passphrase": this.passphrase },
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
                this.error = `server: ${e.message || e}`;
            }
            this.timer = setTimeout(() => this.poll(), POLL_MS);
        },
    }));
});
