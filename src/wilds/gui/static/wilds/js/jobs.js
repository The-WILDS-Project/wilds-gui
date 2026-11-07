/*
 * Activities and jobs in the GUI (plan §3.13, §3.14).
 *
 * wilds-control sends, in every status event, `activities` ({component: [{name, since_ms,
 * details}]}, running only) and `jobs` (active ones, then the last few finished), and a `job`
 * event whenever one changes. status.js keeps them in the "wilds" store; this file draws them:
 *
 *  - "jobs" store: Cancel and the development test job. Only the session holding control can
 *    command (the TO page has no session store, so it never shows Cancel).
 *  - activityBoard: a row of component rectangles; each running activity hangs below its
 *    component as a pill. A job touching two or more components is an umbrella bar spanning
 *    them; a single-component job puts its progress in the pill itself. An ended pill or bar
 *    tints by outcome, then collapses.
 *  - attentionBand: a failed job is a card until dismissed, because its pill is gone.
 *
 * All text goes in with x-text, never as HTML: names come from anonymous visitors.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const LEAVE_MS = 950;  // tint, then collapse (activity.css)

    const sessionId = () => {
        try { return localStorage.getItem("wilds.sessionId") || ""; } catch { return ""; }
    };
    const session = () => Alpine.store("session");

    async function problem(response) {
        const body = await response.json().catch(() => ({}));
        return body.message || body.detail || `HTTP ${response.status}`;
    }

    Alpine.store("jobs", {
        /** True on pages that have a session (the TO page has none: it cannot cancel). */
        get showCancel() { return !!session(); },
        get canControl() { return !!session()?.holder; },
        get whyNot() {
            if (!session()?.ready) return "Not connected to the server";
            return "Only the session holding control can do this";
        },

        async cancel(id) {
            const job = (Alpine.store("wilds").jobs || []).find((j) => j.id === id);
            const what = job ? `${job.kind} (${job.id})` : id;
            if (!(await uiConfirm(`Cancel ${what}?`, { title: "Cancel job", ok: "Cancel job", cancel: "Keep running" }))) return;
            try {
                const response = await fetch(`${base}/jobs/${encodeURIComponent(id)}/cancel`, {
                    method: "POST",
                    headers: { "X-Lease-Token": session()?.token || "" },
                });
                if (!response.ok) throw new Error(await problem(response));
            } catch (e) {
                showToast("error", "Could not cancel the job", String(e.message || e));
            }
        },

        /** Development only (opmode in config.toml): a made-up job to watch the GUI with. */
        async startDemo(outcome = "done", queue = false) {
            try {
                const response = await fetch(`${base}/dev/jobs/demo`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-Session-Id": sessionId(),
                        "X-Lease-Token": session()?.token || "",
                    },
                    body: JSON.stringify({ outcome, queue }),
                });
                if (!response.ok) throw new Error(await problem(response));
            } catch (e) {
                showToast("error", "Could not start the test job", String(e.message || e));
            }
        },
    });

    const elapsed = (since, now) => {
        const s = Math.max(0, Math.round((now - since) / 1000));
        return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${s % 60} s`;
    };

    Alpine.data("activityBoard", () => ({
        components: [],   // [{key, label}], the columns
        pills: [],
        bars: [],
        barRows: 0,
        now: 0,           // the server's clock, so elapsed times agree with every other page

        init() {
            this.components = JSON.parse(document.getElementById("board-components").textContent);
            const column = new Map(this.components.map((c, i) => [c.key, i + 1]));
            // The working sets are plain Maps, outside Alpine's reactivity; publish() hands
            // the page fresh copies, so a changed pill re-renders.
            const pills = new Map();
            const bars = new Map();

            const publish = () => {
                const barList = [...bars.values()].sort((a, b) => a.order - b.order);
                barList.forEach((b, i) => { b.row = i + 2; });
                this.barRows = barList.length;
                this.bars = barList.map((b) => ({ ...b }));
                this.pills = [...pills.values()]
                    .sort((a, b) => a.since_ms - b.since_ms || a.name.localeCompare(b.name))
                    .map((p) => ({ ...p }));
            };
            const retire = (map, id, outcome) => {
                const item = map.get(id);
                if (!item || item.leaving) return;
                item.leaving = true;
                item.outcome = outcome;
                if ("state" in item) item.state = outcome;  // a bar no longer "waits" or "runs"
                setTimeout(() => { map.delete(id); publish(); }, LEAVE_MS);
            };
            const finished = (job) => job && job.state !== "running" && job.state !== "queued";

            const sync = () => {
                const w = Alpine.store("wilds");
                const jobs = w.jobs || [];
                const byId = new Map(jobs.map((j) => [j.id, j]));
                const inRow = (job) => job.components.filter((c) => column.has(c));
                this.now = w.time?.utc_ms ?? Date.now();

                // Which job raised which activity: the job lists them while it runs.
                const owner = new Map();
                for (const j of jobs) {
                    for (const [c, names] of Object.entries(j.activities || {})) {
                        for (const n of names) owner.set(`${c}|${n}`, j.id);
                    }
                }

                const seen = new Set();
                for (const [c, infos] of Object.entries(w.activities || {})) {
                    if (!column.has(c)) continue;
                    for (const info of infos) {
                        const id = `${c}|${info.name}|${info.since_ms}`;
                        seen.add(id);
                        if (pills.get(id)?.leaving) continue;  // already on its way out
                        // A job's list empties the moment it ends, up to a second before this
                        // activity leaves the snapshot: keep the link it had, for the tint.
                        const before = pills.get(id);
                        const jobId = owner.get(`${c}|${info.name}`) || before?.jobId || null;
                        const job = jobId ? byId.get(jobId) : null;
                        const single = job ? inRow(job).length < 2 : !!before?.single;
                        pills.set(id, {
                            id, component: c, name: info.name, since_ms: info.since_ms,
                            detail: info.details?.[0] ?? "", details: info.details ?? [],
                            jobId, who: job ? `${job.started_by.name} ${job.started_by.code}` : (before?.who ?? ""),
                            single, fraction: single ? (job?.progress.fraction ?? before?.fraction ?? null) : null,
                            cancelRequested: !!job?.cancel_requested,
                            leaving: false, outcome: "",
                        });
                    }
                }
                // Gone from the snapshot, or its job has ended (that arrives as a job event, up
                // to a second before the next snapshot): the pill leaves, tinted by the outcome.
                for (const [id, p] of pills) {
                    if (p.leaving) continue;
                    const job = p.jobId ? byId.get(p.jobId) : null;
                    if (!seen.has(id) || finished(job)) retire(pills, id, finished(job) ? job.state : "done");
                }

                for (const j of jobs) {
                    const cols = inRow(j).map((c) => column.get(c));
                    if (cols.length < 2) continue;
                    if (j.state === "queued" || j.state === "running") {
                        bars.set(j.id, {
                            id: j.id, order: Number(j.id.slice(2)), kind: j.kind, state: j.state,
                            from: Math.min(...cols), to: Math.max(...cols) + 1,
                            who: `${j.started_by.name} ${j.started_by.code}`,
                            message: j.progress.message, fraction: j.progress.fraction,
                            cancelRequested: j.cancel_requested, started_at: j.started_at,
                            leaving: false, outcome: "",
                        });
                    } else if (bars.has(j.id)) {
                        retire(bars, j.id, j.state);
                    }
                }
                for (const [id, b] of bars) {
                    if (!byId.has(id) && !b.leaving) retire(bars, id, "done");
                }
                publish();
            };

            document.addEventListener("wilds:status", sync);
            document.addEventListener("wilds:jobs", sync);
            sync();
        },

        stack(key) { return this.pills.filter((p) => p.component === key); },
        busy(key) { return this.pills.some((p) => p.component === key && !p.leaving); },
        elapsed(since) { return elapsed(since, this.now); },
        percent(fraction) { return fraction == null ? 0 : Math.round(fraction * 100); },

        pillText(p) {
            return `${p.name}${p.detail ? " · " + p.detail : ""} · ${elapsed(p.since_ms, this.now)}`;
        },
        pillTip(p) {
            const lines = [p.name, ...p.details, `running for ${elapsed(p.since_ms, this.now)}`];
            if (p.who) lines.push(`started by ${p.who}`);
            return lines.join(" · ");
        },
    }));

    Alpine.data("attentionBand", () => {
        const KEY = "wilds.dismissedJobs";
        const load = () => {
            try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
        };
        // control restarts its job numbering, so a job is identified by id and creation time
        const key = (j) => `${j.id}@${j.created_at}`;
        return {
            dismissed: load(),
            get items() {
                return (Alpine.store("wilds").jobs || []).filter((j) => j.state === "failed" && !this.dismissed.includes(key(j)));
            },
            dismiss(job) {
                this.dismissed = [...this.dismissed, key(job)];
                try { sessionStorage.setItem(KEY, JSON.stringify(this.dismissed)); } catch { /* private mode */ }
            },
            detailsText(job) {
                const d = job.error?.details;
                return d ? Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
            },
        };
    });
});
