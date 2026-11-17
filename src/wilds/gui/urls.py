from django.urls import path
from django.views.generic import RedirectView

from . import views

# Alternative paths for each role, redirected to the canonical one (/to/, /io/); any sub-path
# carries over, so /instop/products/ goes to /io/products/. The engineering pages are part of the
# Instrument Operator's GUI now, so /eng/ and /engineering/ lead to /io/engineering/.
ALIASES = {
    "/to/": ["telescope-operator", "telop"],
    "/io/": ["instrument-operator", "instop"],
    "/io/engineering/": ["eng", "engineering"],
}


def _aliases() -> list:
    out = []
    for target, names in ALIASES.items():
        for name in names:
            out.append(path(f"{name}/", RedirectView.as_view(url=target, query_string=True)))
            out.append(
                path(
                    f"{name}/<path:rest>",
                    RedirectView.as_view(url=target + "%(rest)s", query_string=True),
                )
            )
    return out


urlpatterns = [
    path("", RedirectView.as_view(url="/io/", permanent=False)),
    path("to/", views.to_page, name="to"),
    path("viewer/", views.viewer, name="viewer"),
    # Calibration and configuration were /io pages once, then /eng ones; they are under /io/engineering.
    path("io/calibration/", RedirectView.as_view(url="/io/engineering/calibration/", permanent=False)),
    path("io/configuration/", RedirectView.as_view(url="/io/engineering/configuration/", permanent=False)),
    path("io/engineering/", views.io_engineering_page, {"page": "monitoring"}, name="io_engineering"),
    path("io/engineering/<slug:page>/", views.io_engineering_page, name="io_engineering_page"),
    path("io/", views.io_page, {"page": "operations"}, name="io"),
    path("io/<slug:page>/", views.io_page, name="io_page"),
    *_aliases(),
]
