#!/bin/sh
set -eu

if [ "${1:-}" != "serve" ]; then
    exec "$@"
fi

python manage.py migrate --noinput
# While there is no administrator, writes the one-time setup code the setup
# page asks for to this log (accounts/setup.py).
python manage.py issue_setup_code

# The port, HTTPS and the rest are in kukgrade/gunicorn_conf.py.
exec gunicorn kukgrade.wsgi:application -c python:kukgrade.gunicorn_conf
