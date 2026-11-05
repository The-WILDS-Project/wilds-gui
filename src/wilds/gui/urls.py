from django.urls import path
from django.views.generic import RedirectView

from . import views

urlpatterns = [
    path("", RedirectView.as_view(url="/io/", permanent=False)),
    path("to/", views.to_page, name="to"),
    path("io/", views.io_page, {"page": "operations"}, name="io"),
    path("io/<slug:page>/", views.io_page, name="io_page"),
]
