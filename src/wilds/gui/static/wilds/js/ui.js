/*
 * WILDS UI helpers: toasts, banner, confirm and prompt dialogs, tooltips, sidebar.
 *
 * Adapted from the MAST GUI (static/js/notifications.js, confirm-modal.js, colors.js and the
 * scripts in templates/base.html and components/sidebar.html). Differences:
 *  - all text is inserted with textContent, never as HTML: session names are typed by
 *    anonymous visitors and shown to the TO (plan §2, "GUI stack and look");
 *  - uiConfirm() returns a promise instead of replacing window.confirm, and puts Cancel
 *    on the left, then OK;
 *  - colours are read from the CSS tokens, so they follow the theme.
 */

const UI_ICONS = {
    info: "bi-info-circle-fill",
    success: "bi-check-circle-fill",
    warning: "bi-exclamation-triangle-fill",
    danger: "bi-x-circle-fill",
    error: "bi-x-circle-fill",
    primary: "bi-info-circle-fill",
    start: "bi-play-circle-fill",
    end: "bi-check-circle-fill",
};

/** A colour token for a severity, e.g. uiColor("warning", "border"), from the current theme. */
function uiColor(type, property = "border") {
    const value = getComputedStyle(document.documentElement)
        .getPropertyValue(`--ui-${type}-${property}`).trim();
    return value || getComputedStyle(document.documentElement)
        .getPropertyValue(`--ui-info-${property}`).trim();
}

function uiElement(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
}

/** Show a toast. type: info | success | warning | error. Success toasts hide after 3 s. */
function showToast(type, title, message) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const sev = type === "error" ? "danger" : (UI_ICONS[type] ? type : "secondary");

    const toastEl = uiElement("div", "toast align-items-center border");
    toastEl.setAttribute("role", "alert");
    toastEl.setAttribute("aria-live", "assertive");
    toastEl.setAttribute("aria-atomic", "true");
    toastEl.style.background = `var(--ui-${sev}-bg)`;
    toastEl.style.color = `var(--ui-${sev}-text)`;
    toastEl.style.borderColor = `var(--ui-${sev}-border)`;

    const row = uiElement("div", "d-flex");
    const body = uiElement("div", "toast-body");
    const icon = uiElement("i", `bi ${UI_ICONS[type] || UI_ICONS.info} me-2`);
    body.append(icon, uiElement("strong", null, title));
    if (message) {
        body.append(document.createElement("br"), document.createTextNode(String(message)));
    }
    const close = uiElement("button", "btn-close me-2 m-auto");
    close.type = "button";
    close.setAttribute("data-bs-dismiss", "toast");
    close.setAttribute("aria-label", "Close");
    row.append(body, close);
    toastEl.append(row);
    container.append(toastEl);

    const toast = new bootstrap.Toast(toastEl, {
        autohide: type === "success",
        delay: type === "success" ? 3000 : 5000,
    });
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
    toast.show();

    // At most 3 visible, as in MAST.
    const toasts = container.querySelectorAll(".toast");
    if (toasts.length > 3) bootstrap.Toast.getInstance(toasts[0])?.hide();
}

/** Show a dismissible banner below the header, e.g. when wilds-control can't be reached. */
function showBanner(title, lines = []) {
    const container = document.getElementById("banner-container");
    if (!container || container.querySelector(".system-banner")) return;
    const banner = uiElement("div", "alert alert-danger system-banner mb-0");
    banner.setAttribute("role", "alert");
    const heading = uiElement("h6", "alert-heading mb-1");
    heading.append(uiElement("i", "bi bi-exclamation-triangle-fill me-2"),
                   document.createTextNode(String(title)));
    banner.append(heading);
    for (const line of lines) banner.append(uiElement("div", "small", line));
    const close = uiElement("button", "btn-close");
    close.type = "button";
    close.addEventListener("click", hideBanner);
    banner.append(close);
    container.replaceChildren(banner);
}

function hideBanner() {
    document.getElementById("banner-container")?.replaceChildren();
}

/**
 * A confirm dialog in the app's style. Resolves true (OK) or false (Cancel, Escape).
 *   if (await uiConfirm("Slew now?", {title: "Preview is off", ok: "Slew now"})) { ... }
 */
function uiConfirm(message, { title = "Confirm", ok = "OK", cancel = "Cancel" } = {}) {
    return new Promise((resolve) => {
        document.getElementById("ui-confirm-modal")?.remove();

        const modalEl = uiElement("div", "modal fade");
        modalEl.id = "ui-confirm-modal";
        modalEl.tabIndex = -1;
        const dialog = uiElement("div", "modal-dialog modal-dialog-centered");
        const content = uiElement("div", "modal-content");

        const header = uiElement("div", "modal-header");
        const h = uiElement("h5", "modal-title");
        h.append(uiElement("i", "bi bi-question-circle me-2"), document.createTextNode(title));
        header.append(h);

        const body = uiElement("div", "modal-body", message || "Are you sure?");

        const footer = uiElement("div", "modal-footer justify-content-between");
        const cancelBtn = uiElement("button", "btn btn-secondary btn-sm", cancel);
        const okBtn = uiElement("button", "btn btn-primary btn-sm", ok);
        cancelBtn.type = okBtn.type = "button";
        cancelBtn.style.minWidth = okBtn.style.minWidth = "80px";
        footer.append(cancelBtn, okBtn);

        content.append(header, body, footer);
        dialog.append(content);
        modalEl.append(dialog);
        document.body.append(modalEl);

        const modal = new bootstrap.Modal(modalEl, { backdrop: "static" });
        let result = false;
        okBtn.addEventListener("click", () => { result = true; modal.hide(); });
        cancelBtn.addEventListener("click", () => modal.hide());
        modalEl.addEventListener("shown.bs.modal", () => okBtn.focus());
        modalEl.addEventListener("hidden.bs.modal", () => { modalEl.remove(); resolve(result); });
        modal.show();
    });
}

/**
 * A text-input dialog in the app's style. Resolves the trimmed text, or null on Cancel/Escape.
 *   const name = await uiPrompt("Your name and place", {title: "Who are you?", value: "Arie"});
 */
function uiPrompt(message, { title = "Input", ok = "OK", cancel = "Cancel", value = "", placeholder = "" } = {}) {
    return new Promise((resolve) => {
        document.getElementById("ui-prompt-modal")?.remove();

        const modalEl = uiElement("div", "modal fade");
        modalEl.id = "ui-prompt-modal";
        modalEl.tabIndex = -1;
        const dialog = uiElement("div", "modal-dialog modal-dialog-centered");
        const content = uiElement("div", "modal-content");

        const header = uiElement("div", "modal-header");
        const h = uiElement("h5", "modal-title");
        h.append(uiElement("i", "bi bi-person me-2"), document.createTextNode(title));
        header.append(h);

        const body = uiElement("div", "modal-body");
        const label = uiElement("label", "form-label", message);
        const input = uiElement("input", "form-control");
        input.type = "text";
        input.value = value;
        input.placeholder = placeholder;
        input.maxLength = 60;
        body.append(label, input);

        const footer = uiElement("div", "modal-footer justify-content-between");
        const cancelBtn = uiElement("button", "btn btn-secondary btn-sm", cancel);
        const okBtn = uiElement("button", "btn btn-primary btn-sm", ok);
        cancelBtn.type = okBtn.type = "button";
        cancelBtn.style.minWidth = okBtn.style.minWidth = "80px";
        footer.append(cancelBtn, okBtn);

        content.append(header, body, footer);
        dialog.append(content);
        modalEl.append(dialog);
        document.body.append(modalEl);

        const modal = new bootstrap.Modal(modalEl, { backdrop: "static" });
        let result = null;
        const accept = () => { result = input.value.trim() || null; modal.hide(); };
        okBtn.addEventListener("click", accept);
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") accept(); });
        cancelBtn.addEventListener("click", () => modal.hide());
        modalEl.addEventListener("shown.bs.modal", () => input.focus());
        modalEl.addEventListener("hidden.bs.modal", () => { modalEl.remove(); resolve(result); });
        modal.show();
    });
}

/* Tooltips: plain text only; new nodes get theirs automatically (MAST base.html). */
function initTooltips(root) {
    (root || document).querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
        if (!bootstrap.Tooltip.getInstance(el)) new bootstrap.Tooltip(el, { html: false });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    initTooltips();
    new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const node of m.addedNodes) {
                if (node.nodeType === 1) initTooltips(node.parentElement || node);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
});

/* x-tooltip="expression": a reactive plain-text tooltip, e.g. the reason a control is greyed out. */
document.addEventListener("alpine:init", () => {
    Alpine.directive("tooltip", (el, { expression }, { evaluateLater, effect, cleanup }) => {
        const getText = evaluateLater(expression);
        let instance = null;
        effect(() => {
            getText((value) => {
                if (value && instance) {
                    instance.setContent({ ".tooltip-inner": String(value) });  // no flicker while hovering
                    return;
                }
                instance?.dispose();
                instance = value
                    ? new bootstrap.Tooltip(el, { html: false, placement: "top", title: String(value) })
                    : null;
            });
        });
        cleanup(() => instance?.dispose());
    });
});

/* Sidebar: collapse to icons (remembered per browser) and submenu arrows (MAST sidebar.html). */
function uiToggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    const collapsed = sidebar.classList.toggle("sidebar-collapsed");
    uiSidebarIcon(collapsed);
    try { localStorage.setItem("wilds-sidebar-collapsed", collapsed ? "1" : "0"); } catch (e) { /* */ }
}

function uiSidebarIcon(collapsed) {
    const icon = document.getElementById("sidebar-toggle-icon");
    if (!icon) return;
    icon.classList.toggle("bi-chevron-left", !collapsed);
    icon.classList.toggle("bi-chevron-right", collapsed);
}

document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    let collapsed = false;
    try { collapsed = localStorage.getItem("wilds-sidebar-collapsed") === "1"; } catch (e) { /* */ }
    sidebar.classList.toggle("sidebar-collapsed", collapsed);
    uiSidebarIcon(collapsed);

    sidebar.querySelectorAll(".sidebar-submenu").forEach((submenu) => {
        const trigger = sidebar.querySelector(`[data-bs-target="#${submenu.id}"]`);
        const arrow = trigger?.querySelector(".sidebar-item-arrow");
        if (submenu.querySelector(".sidebar-subitem.active")) {
            new bootstrap.Collapse(submenu, { toggle: false }).show();
        }
        submenu.addEventListener("show.bs.collapse", () => {
            arrow?.classList.replace("bi-chevron-right", "bi-chevron-down");
            trigger?.setAttribute("aria-expanded", "true");
        });
        submenu.addEventListener("hide.bs.collapse", () => {
            arrow?.classList.replace("bi-chevron-down", "bi-chevron-right");
            trigger?.setAttribute("aria-expanded", "false");
        });
    });
});
