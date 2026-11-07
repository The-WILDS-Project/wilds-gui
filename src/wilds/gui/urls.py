from django.urls import path
from django.views.generic import RedirectView

from . import views

# Alternative paths for each role, redirected to the canonical one (/to/, /io/, /eng/); any
# sub-path carries over, so /instop/calibration/ goes to /io/calibration/.
ALIASES = {
    "/to/": ["telescope-operator", "telop"],
    "/io/": ["instrument-operator", "instop"],
    "/eng/": ["engineering"],
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
    path("eng/", views.eng_page, name="eng"),
    path("eng/<slug:page>/", views.eng_page, name="eng_page"),
    # Calibration and configuration moved from /io to /eng.
    path("io/engineering/", RedirectView.as_view(url="/eng/", permanent=False)),
    path("io/calibration/", RedirectView.as_view(url="/eng/calibration/", permanent=False)),
    path("io/configuration/", RedirectView.as_view(url="/eng/configuration/", permanent=False)),
    path("io/", views.io_page, {"page": "operations"}, name="io"),
    path("io/<slug:page>/", views.io_page, name="io_page"),
    *_aliases(),
]
