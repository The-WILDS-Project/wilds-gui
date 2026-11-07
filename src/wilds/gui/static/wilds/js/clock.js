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
        offsetMs: null,        // server UTC minus this browser's clock
        zone: "America/Phoenix",
        ldt: "--:--:--",
        ut: "--:--:--",
        lt: "--:--:--",
        tip: "Waiting for the server's clock",
        live: false,
    });
    const store = Alpine.store("clock");

    const hms = (zone) => new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: zone,
    });
    const day = (zone) => new Intl.DateTimeFormat("en-CA", {
        weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone,
    });
    const ownZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    function render() {
        const now = Date.now();
        store.lt = hms(undefined).format(now);
        if (store.offsetMs === null) return;
        const server = new Date(now + store.offsetMs);
        store.ldt = hms(store.zone).format(server);
        store.ut = hms("UTC").format(server);
        store.tip = [
            `Server time (${store.live ? "live" : "link down: may drift"})`,
            `LDT: ${day(store.zone).format(server)} ${store.ldt}  (${store.zone})`,
            `UT: ${day("UTC").format(server)} ${store.ut}`,
            `LT: ${day(undefined).format(now)} ${store.lt}  (${ownZone}, this browser)`,
        ].join("\n");
    }

    // A status event: remember the offset and the zone.
    document.addEventListener("wilds:status", (e) => {
        const t = e.detail && e.detail.time;
        if (!t) return;
        store.offsetMs = t.utc_ms - Date.now();
        store.zone = t.zone;
        store.live = true;
        render();
    });
    // The link going down only dims the clocks; they keep ticking from the last offset.
    document.addEventListener("wilds:link", (e) => { store.live = e.detail === "ok" && store.offsetMs !== null; render(); });

    // Tick on the second boundary, so the seconds change when the clock does.
    (function tick() {
        render();
        setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    })();
});
