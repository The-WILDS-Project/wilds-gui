/*
 * The generic settings form (plan §3.10), one for every component.
 *
 * wilds-control serves each component's settings at /config/{component}/{conf|cal} as values,
 * a JSON schema (label, unit, help, limits) and a version. This turns the schema into fields,
 * edits a draft copy, and saves only the changed fields together with the version it loaded; a
 * stale version is refused by the server (409 stale), so a form never overwrites someone else's
 * save. The status stream's conf_versions tells an open form that the settings changed
 * elsewhere. All text goes in with x-text; no markup is ever built from server text.
 */
document.addEventListener("alpine:init", () => {
    const base = document.body.dataset.controlUrl;
    const session = () => Alpine.store("session");
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
    const pretty = (name) => { const t = name.replace(/[-_.]/g, " "); return t[0].toUpperCase() + t.slice(1); };

    async function api(method, path, body) {
        const response = await fetch(`${base}${path}`, {
            method,
            headers: { "Content-Type": "application/json", "X-Lease-Token": session()?.token || "" },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const e = new Error(data.message || data.detail || `HTTP ${response.status}`);
            e.code = data.code;
            e.status = response.status;
            throw e;
        }
        return data;
    }

    /** One schema property as a field: {key, label, help, unit, kind, nullable, min, max, choices, children}. */
    function field(key, prop, defs) {
        let p = prop, nullable = false;
        if (p.anyOf) {
            const rest = p.anyOf.filter((x) => x.type !== "null");
            nullable = rest.length < p.anyOf.length;
            p = { ...rest[0], title: prop.title, description: prop.description, unit: prop.unit };
        }
        if (p.$ref) p = { ...defs[p.$ref.split("/").pop()], title: prop.title, description: prop.description };
        const f = {
            key, nullable,
            label: prop.title || pretty(key),
            help: prop.description || p.description || "",
            unit: prop.unit || p.unit || "",
            min: p.minimum, max: p.maximum,
        };
        if (p.enum) {
            f.kind = "choice";
            f.choices = nullable ? [null, ...p.enum] : p.enum;
        } else if (p.type === "boolean") f.kind = "bool";
        else if (p.type === "integer") f.kind = "int";
        else if (p.type === "number") f.kind = "number";
        else if (p.type === "object" && p.properties) {
            f.kind = "group";
            f.children = Object.entries(p.properties).map(([k, v]) => field(k, v, defs));
        } else f.kind = "text";
        return f;
    }

    function fieldsOf(schema) {
        const defs = schema.$defs || {};
        return Object.entries(schema.properties || {}).map(([k, v]) => field(k, v, defs));
    }

    /** Why a value is not acceptable, or "" (the server checks again; this saves a round trip). */
    function problem(f, v) {
        if (v === null || v === undefined) return f.nullable || f.kind === "bool" ? "" : "Required";
        if (f.kind === "group") {
            for (const c of f.children) { const m = problem(c, v[c.key]); if (m) return `${c.label}: ${m}`; }
            return "";
        }
        if (f.kind === "int" || f.kind === "number") {
            if (typeof v !== "number" || Number.isNaN(v)) return "Enter a number";
            if (f.kind === "int" && !Number.isInteger(v)) return "Enter a whole number";
            if (f.min !== undefined && v < f.min) return `At least ${f.min}`;
            if (f.max !== undefined && v > f.max) return `At most ${f.max}`;
        }
        return "";
    }

    Alpine.data("settingsForm", () => ({
        index: {},            // {component: ["cal", "conf"]}
        component: null,
        slice: "conf",
        fields: [],
        pane: null,           // the open pane's key ("" is the top-level fields); null picks the first
        loaded: null,         // {version, values} as the server last gave them
        draft: {},
        reason: "",
        error: null,
        saving: false,
        history: [],
        showHistory: false,
        elsewhere: null,      // who changed it, once a newer version is seen
        stale: false,

        async init() {
            try {
                this.index = (await api("GET", "/config")).components;
                const first = Object.keys(this.index)[0];
                if (first) await this.select(first, "conf");
            } catch (e) { this.error = String(e.message || e); }
            this.$watch("$store.wilds.conf_versions", () => this.checkElsewhere());
        },

        get path() { return `/config/${this.component}/${this.slice}`; },
        get names() { return Object.keys(this.index); },
        get slices() { return this.index[this.component] || []; },
        pretty,
        get version() { return this.loaded?.version ?? null; },
        get canEdit() { return !!session()?.token; },

        async select(component, slice) {
            this.component = component;
            this.slice = (this.index[component] || []).includes(slice) ? slice : "conf";
            this.history = [];
            this.pane = null;
            await this.load();
        },

        async load() {
            this.error = null;
            try {
                const view = await api("GET", this.path);
                this.fields = fieldsOf(view.json_schema);
                if (!this.panes.some((p) => p.key === this.pane)) this.pane = this.panes[0]?.key ?? "";
                this.loaded = { version: view.version, values: view.values };
                this.draft = copy(view.values);
                this.reason = "";
                this.stale = false;
                this.elsewhere = null;
                if (this.showHistory) await this.loadHistory();
            } catch (e) { this.error = String(e.message || e); }
        },

        /** The status stream shows a newer version than the one loaded: someone saved elsewhere. */
        async checkElsewhere() {
            if (!this.component || !this.loaded) return;
            const seen = Alpine.store("wilds").conf_versions?.[`${this.component}/${this.slice}`];
            // Versions only grow, and the status stream lags a second behind a save made here,
            // so an older or equal number is just that lag, never a change elsewhere.
            if (seen === undefined || seen <= this.loaded.version || this.stale) return;
            this.stale = true;
            try {
                const [last] = await api("GET", `${this.path}/history?limit=1`);
                this.elsewhere = last ? `${last.who}${last.reason ? `: ${last.reason}` : ""}` : null;
            } catch { /* the banner still shows */ }
        },

        // -- panes: a required group of settings (the camera's "Single frame" and "Video") is a pane
        // of its own; every other top-level field is in one more, "General". A leaf is addressed
        // by its pane key ("" for a top-level field) and its field.
        get panes() {
            const groups = this.fields.filter((f) => f.kind === "group" && !f.nullable);
            const rest = this.fields.filter((f) => !groups.includes(f));
            const panes = groups.map((f) => ({ key: f.key, label: f.label, help: f.help, fields: f.children }));
            if (rest.length) panes.push({ key: "", label: "General", help: "", fields: rest });
            return panes;
        },
        get paneFields() { return this.panes.find((p) => p.key === this.pane)?.fields ?? []; },
        get paneHelp() { return this.panes.find((p) => p.key === this.pane)?.help ?? ""; },
        topKeys(p) { return p.key ? [p.key] : p.fields.map((f) => f.key); },
        paneChanged(p) { return this.topKeys(p).some((k) => !same(this.draft[k], this.loaded?.values[k])); },
        paneInvalid(p) { return p.fields.some((f) => this.issue(p.key, f)); },
        holder(pane) { return pane ? this.draft[pane] : this.draft; },
        loadedHolder(pane) { return (pane ? this.loaded?.values[pane] : this.loaded?.values) ?? {}; },

        changed(pane, f) { return !same(this.holder(pane)[f.key], this.loadedHolder(pane)[f.key]); },
        get changes() {
            return Object.fromEntries(
                this.fields.filter((f) => !same(this.draft[f.key], this.loaded?.values[f.key])).map((f) => [f.key, this.draft[f.key]]),
            );
        },
        get dirty() { return Object.keys(this.changes).length > 0; },
        issue(pane, f) { return problem(f, this.holder(pane)[f.key]); },
        get invalid() { return this.fields.some((f) => problem(f, this.draft[f.key])); },
        get whyNotSave() {
            if (!this.canEdit) return "You do not hold control";
            if (this.stale) return "Reload first: the settings changed elsewhere";
            if (!this.dirty) return "Nothing changed";
            if (this.invalid) return "Fix the highlighted values";
            return "";
        },

        // -- editing helpers the template calls ---------------------------------------------
        isSet(pane, f) { const v = this.holder(pane)[f.key]; return v !== null && v !== undefined; },
        toggleSet(pane, f, on) {
            const h = this.holder(pane);
            if (!on) { h[f.key] = null; return; }
            if (f.kind === "group") h[f.key] = Object.fromEntries(f.children.map((c) => [c.key, c.min ?? 0]));
            else h[f.key] = f.min ?? f.max ?? 0;
        },
        pick(pane, f, event) { this.holder(pane)[f.key] = f.choices[event.target.selectedIndex]; },
        choiceText(v) { return v === null ? "not set" : String(v); },
        revert(pane, f) { this.holder(pane)[f.key] = copy(this.loadedHolder(pane)[f.key]); },

        async save() {
            if (this.whyNotSave) return;
            this.saving = true; this.error = null;
            try {
                const view = await api("PUT", this.path, { values: this.changes, version: this.loaded.version, reason: this.reason || null });
                this.loaded = { version: view.version, values: view.values };
                this.draft = copy(view.values);
                this.reason = "";
                showToast("success", "Saved", `${pretty(this.component)} settings are now version ${view.version}`);
                if (this.showHistory) await this.loadHistory();
            } catch (e) {
                if (e.code === "stale") { this.stale = true; this.error = null; await this.checkElsewhere(); }
                else this.error = e.message;
            }
            this.saving = false;
        },

        async loadHistory() {
            try { this.history = await api("GET", `${this.path}/history?limit=30`); }
            catch (e) { this.error = String(e.message || e); }
        },
        async toggleHistory() {
            this.showHistory = !this.showHistory;
            if (this.showHistory) await this.loadHistory();
        },
        when(ms) { return new Date(ms).toLocaleString(); },

        async revertTo(version) {
            this.error = null;
            try {
                await api("POST", `${this.path}/revert/${version}`, {});
                await this.load();
                showToast("success", "Reverted", `Restored version ${version} as a new version`);
            } catch (e) { this.error = e.message; }
        },
    }));
});
