/*
 * Theme: dark by default (WILDS is used at night), remembered per browser.
 * Loaded in <head> before the stylesheets apply, so the page never flashes light.
 */
(function () {
    var theme = "dark";
    try {
        theme = localStorage.getItem("wilds-theme") || "dark";
    } catch (e) { /* storage blocked: keep the default */ }
    document.documentElement.setAttribute("data-bs-theme", theme);
})();

function uiToggleTheme() {
    var root = document.documentElement;
    var next = root.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-bs-theme", next);
    try {
        localStorage.setItem("wilds-theme", next);
    } catch (e) { /* not remembered */ }
}
