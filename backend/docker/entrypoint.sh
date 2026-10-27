#!/bin/sh
set -eu

if [ "${1:-}" != "serve" ]; then
    exec "$@"
fi

# The database (when the image carries it), migrations and the app: kukgrade/serve.py.
exec python -m kukgrade.serve
