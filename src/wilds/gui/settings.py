"""
Django settings for wilds-gui.

No user accounts (plan §3.11): no auth or admin apps. Sessions are signed cookies, so there
is no session table. The observing log will add a database later.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Development defaults; the deployment sets these from the environment.
DEBUG = os.environ.get("WILDS_GUI_DEBUG", "1") == "1"
SECRET_KEY = os.environ.get("WILDS_GUI_SECRET_KEY", "dev-only-not-secret")
ALLOWED_HOSTS = os.environ.get("WILDS_GUI_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

# Where the browser reaches wilds-control (REST, SSE, WebSocket).
WILDS_CONTROL_URL = os.environ.get("WILDS_CONTROL_URL", "http://localhost:8001")

INSTALLED_APPS = [
    "django.contrib.sessions",
    "django.contrib.staticfiles",
    "wilds.gui",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

SESSION_ENGINE = "django.contrib.sessions.backends.signed_cookies"

ROOT_URLCONF = "wilds.gui.urls"
ASGI_APPLICATION = "wilds.gui.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.template.context_processors.csrf",
                "wilds.gui.context_processors.wilds",
            ],
        },
    },
]

DATABASES: dict = {}

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR.parents[2] / "staticfiles"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True
