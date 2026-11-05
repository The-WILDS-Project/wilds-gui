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
                this.error = `wilds-control: ${e.message || e}`;
            }
            this.timer = setTimeout(() => this.poll(), POLL_MS);
        },
    }));
});
