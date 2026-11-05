from django.http import Http404, HttpRequest, HttpResponse
from django.shortcuts import render

# The /io pages, in sidebar order: (slug, label, Bootstrap icon).
IO_PAGES = [
    ("operations", "Operations", "bi-binoculars"),
    ("calibration", "Calibration", "bi-lightbulb"),
    ("products", "Products", "bi-images"),
    ("configuration", "Configuration", "bi-sliders"),
    ("engineering", "Engineering", "bi-wrench-adjustable"),
]


def to_page(request: HttpRequest) -> HttpResponse:
    """The Telescope Operator's page: status, requests, grant/revoke (plan §3.11)."""
    return render(request, "to/index.html")


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
