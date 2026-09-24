#!/bin/sh
set -eu

if [ "${1:-}" != "serve" ]; then
    exec "$@"
fi

python manage.py migrate --noinput

exec gunicorn kukgrade.wsgi:application \
    --bind 0.0.0.0:8000 \
    --workers 1 \
    --worker-class gthread \
    --threads "${GUNICORN_THREADS:-4}" \
    --worker-tmp-dir /tmp \
    --no-control-socket \
    --timeout "${GUNICORN_TIMEOUT:-30}" \
    --graceful-timeout 30 \
    --access-logfile - \
    --error-logfile - \
    --access-logformat '%(h)s %(m)s %(U)s %(s)s %(D)s'
