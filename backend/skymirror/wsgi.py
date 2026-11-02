"""
WSGI config for skymirror project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'skymirror.settings')

application = get_wsgi_application()

# Load the face models once at start-up (shared by Gunicorn's workers via
# --preload), so the first spin is as fast as the rest.
from mirrors.faces import warm_up  # noqa: E402

warm_up()
