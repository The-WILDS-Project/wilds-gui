from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import render

# The /io pages, in sidebar order: (slug, label, Bootstrap icon).
IO_PAGES = [
    ("operations", "Operations", "bi-binoculars"),
    ("products", "Products", "bi-images"),
]

# The /eng pages, in sidebar order.
ENG_PAGES = [
    ("monitoring", "Monitoring", "bi-activity"),
    ("calibration", "Calibration", "bi-lightbulb"),
    ("configuration", "Configuration", "bi-sliders"),
]


def to_page(request: HttpRequest) -> HttpResponse:
    """The Telescope Operator's page: status, requests, grant/revoke (plan §3.11)."""
    return render(request, "to/index.html")


def eng_page(request: HttpRequest, page: str = "monitoring") -> HttpResponse:
    """The engineering pages (monitoring, calibration, configuration), behind the passphrase."""
    labels = {slug: label for slug, label, _ in ENG_PAGES}
    if page not in labels:
        raise Http404(page)
    return render(
        request,
        "eng/index.html",
        {"eng_pages": ENG_PAGES, "page": page, "page_label": labels[page]},
    )


def io_page(request: HttpRequest, page: str) -> HttpResponse:
    """The Instrument Operator's GUI, one sidebar entry per page."""
    labels = {slug: label for slug, label, _ in IO_PAGES}
    if page not in labels:
        raise Http404(page)
    return render(
        request,
        "io/page.html",
        {"io_pages": IO_PAGES, "page": page, "page_label": labels[page]},
    )
