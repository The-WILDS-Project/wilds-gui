from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import render
from django.urls import reverse
from django.views.decorators.clickjacking import xframe_options_sameorigin

# The /io pages, in sidebar order: (slug, label, Bootstrap icon).
IO_PAGES = [
    ("operations", "Operations", "bi-binoculars"),
    ("products", "Products", "bi-images"),
    ("monitoring", "Monitoring", "bi-activity"),
]

# The Engineering group of the same sidebar (/io/engineering/<slug>/). There is no engineering
# mode: whoever holds control may calibrate and configure, so these are pages of the Instrument
# Operator's GUI like the others.
ENGINEERING_PAGES = [
    ("calibration", "Calibration", "bi-lightbulb"),
    ("configuration", "Configuration", "bi-sliders"),
]
ENGINEERING = ("Engineering", "bi-wrench-adjustable")


def sidebar(page: str, group: str | None = None) -> list[dict]:
    """The Instrument Operator's sidebar: the pages, and the Engineering group with its own (a
    collapsible submenu, open when one of its pages is shown)."""
    items: list[dict] = [
        {"label": label, "icon": icon, "url": reverse("io_page", args=[slug]), "active": slug == page and group is None}
        for slug, label, icon in IO_PAGES
    ]
    label, icon = ENGINEERING
    children = [
        {"label": l, "icon": i, "url": reverse("io_engineering_page", args=[slug]), "active": group == "engineering" and slug == page}
        for slug, l, i in ENGINEERING_PAGES
    ]
    items.append({"id": "engineering", "label": label, "icon": icon, "children": children, "active": group == "engineering"})
    return items


@xframe_options_sameorigin  # the guide-camera dock shows it in a frame of its own page
def viewer(request: HttpRequest) -> HttpResponse:
    """A FITS image in JS9 (plan §3.17): ``?path=`` is a path on wilds-control, ``&title=`` a name
    for the tab. The page itself fetches the file from wilds-control; nothing is read here."""
    return render(request, "viewer/index.html")


def to_page(request: HttpRequest) -> HttpResponse:
    """The Telescope Operator's page: status, requests, grant/revoke (plan §3.11)."""
    return render(request, "to/index.html")


def io_page(request: HttpRequest, page: str) -> HttpResponse:
    """The Instrument Operator's GUI, one sidebar entry per page (Monitoring is the board of
    technical readings, so it is laid out like the Engineering pages)."""
    labels = {slug: label for slug, label, _ in IO_PAGES}
    if page not in labels:
        raise Http404(page)
    return render(
        request,
        "io/page.html",
        {"nav": sidebar(page), "page": page, "page_label": labels[page], "technical": page == "monitoring"},
    )


def io_engineering_page(request: HttpRequest, page: str = "calibration") -> HttpResponse:
    """Calibration and configuration: the Engineering group of the same GUI."""
    labels = {slug: label for slug, label, _ in ENGINEERING_PAGES}
    if page not in labels:
        raise Http404(page)
    return render(
        request,
        "io/page.html",
        {
            "nav": sidebar(page, "engineering"),
            "page": page,
            "page_label": f"Engineering: {labels[page]}",
            "technical": True,
        },
    )
