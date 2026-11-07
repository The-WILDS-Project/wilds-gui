/*
 * Header clocks, shared by every page as the Alpine store "clock".
 *
 * The time shown as LDT and UT is the server's, not this browser's: each status event carries
 * the server's UTC clock, and the offset to this browser's clock is remembered. Ticking is
 * local, so the display is smooth and keeps running between events; it is dimmed ("stale")
 * when the link to the server is not up, since the offset can then drift. LDT is formatted in
 * the zone wilds-control names (config.toml [site] timezone, America/Phoenix by default);
 * LT is simply this browser's own clock and zone.
 */
document.addEventListener("alpine:init", () => {
    Alpine.store("clock", {
        offsetMs: null,        // server UTC minus this browser's clock (smoothed)
        zone: "America/Phoenix",
        ldt: "--:--:-- --",
        ut: "--:--:-- --",
        lt: "--:--:-- --",
        tip: "Waiting for the server's clock",
        live: false,
    });
    const store = Alpine.store("clock");

    // 12-hour with am/pm, always the same width ("03:11:10 am") so the values line up.
    const fmt = (zone) => new Intl.DateTimeFormat("en-US", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: zone,
    });
    const hms = (zone) => ({ format: (t) => fmt(zone).format(t).toLowerCase() });
    const day = (zone) => new Intl.DateTimeFormat("en-CA", {
        weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone,
    });
    const ownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function render() {
        const now = Date.now();
        if (store.offsetMs === null) { store.lt = hms(undefined).format(now); return; }
        // One instant for all three lines (LT is the same moment in this browser's own zone),
        // so they always agree on the second.
        const server = new Date(now + store.offsetMs);
        store.lt = hms(undefined).format(server);
        store.ldt = hms(store.zone).format(server);
        store.ut = hms("UTC").format(server);
        store.tip = [
            `Server time (${store.live ? "live" : "link down: may drift"})`,
            `LDT: ${day(store.zone).format(server)} ${store.ldt}  (${store.zone})`,
            `UT: ${day("UTC").format(server)} ${store.ut}`,
            `LT: ${day(undefined).format(now)} ${store.lt}  (${ownZone}, this browser)`,
        ].join("\n");
    }

    // Each event gives offset = true offset - network delay, so the delay only ever lowers the
    // estimate. The largest of the recent estimates is the best one and does not jitter, which
    // keeps the seconds from flipping, repeating or skipping.
    const recent = [];
    document.addEventListener("wilds:status", (e) => {
        const t = e.detail && e.detail.time;
        if (!t) return;
        const sample = t.utc_ms - Date.now();
        if (store.offsetMs !== null && Math.abs(sample - store.offsetMs) > 2000) recent.length = 0;  // clock stepped
        recent.push(sample);
        if (recent.length > 20) recent.shift();
        store.offsetMs = Math.max(...recent);
        store.zone = t.zone;
        store.live = true;
        render();
    });
    // The link going down only dims the clocks; they keep ticking from the last offset.
    document.addEventListener("wilds:link", (e) => { store.live = e.detail === "ok" && store.offsetMs !== null; render(); });

    // Tick just after the *server's* second changes, so each tick shows a new second.
    (function tick() {
        render();
        const server = Date.now() + (store.offsetMs ?? 0);
        setTimeout(tick, 1000 - (server % 1000) + 20);
    })();
});
