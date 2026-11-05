from django.conf import settings
from django.http import HttpRequest


def wilds(request: HttpRequest) -> dict[str, str]:
    return {"wilds_control_url": settings.WILDS_CONTROL_URL}
