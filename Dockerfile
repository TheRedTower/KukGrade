# Base images are pinned by digest so a rebuild gives the same image. Dependabot
# keeps the digests (and Python and Node packages) up to date by opening pull
# requests that CI checks, so none of this is edited by hand
# (.github/dependabot.yml; docs/development-workflow.md, "Dependency updates").
# Each image is named once, in a FROM line, which is what Dependabot reads.
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN VITE_API_BASE_URL= npm run build -- --base=/static/

FROM ghcr.io/astral-sh/uv:0.13.6@sha256:af22a52f5eafef3d78e551599d405c02df61919d18028f0cea8eda93bc9986d0 AS uv

FROM python:3.14-slim@sha256:c2aca8207dfb68e7d20fecb7fad7e145c5d79d2ff36712d416c144130606d71d AS python-base

FROM python-base AS python-deps
COPY --from=uv /uv /uvx /usr/local/bin/
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Everything is put together and trimmed here. The final image below is a copy
# of this stage's finished filesystem (not a layer on top of it), because
# deleting a file in a later layer only hides it: its bytes would still ship.
FROM python-base AS runtime-build
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/backend/.venv/bin:$PATH \
    KUKGRADE_IMPORT_UPLOAD_ROOT=/var/lib/kukgrade/import_uploads
WORKDIR /app/backend
COPY --from=python-deps /app/backend/.venv ./.venv
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./frontend_dist
COPY backend/docker/entrypoint.sh /app/entrypoint.sh
# Collect the static files, leaving out the Django admin's files (the network
# app does not serve the admin; kukgrade.urls_admin does, from a shell) and the
# REST framework's browsable-API files (production answers in JSON only). The
# built assets are then served from the collected copy, so the uncollected
# duplicate goes (index.html stays: the app reads it).
RUN DJANGO_SECRET_KEY=build-only-not-a-runtime-secret \
    python manage.py collectstatic --noinput --ignore admin --ignore rest_framework \
    && rm -rf frontend_dist/assets \
    && groupadd --system --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /var/lib/kukgrade/import_uploads /var/lib/kukgrade/tls \
    && chown -R appuser:appuser /var/lib/kukgrade \
    && chmod 700 /var/lib/kukgrade/import_uploads /var/lib/kukgrade/tls \
    && chmod 755 /app/entrypoint.sh
# The database the image carries, from Debian's own PostgreSQL package. No
# cluster is made at install time: kukgrade/serve.py makes the database in
# /var/lib/kukgrade/postgres on first start. Its major version is the one this
# image is built with; changing it means dumping and restoring (docs/deployment.md).
RUN set -e \
    && mkdir -p /etc/postgresql-common \
    && printf 'create_main_cluster = false\n' > /etc/postgresql-common/createcluster.conf \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends postgresql-17 \
    && rm -rf /var/lib/apt/lists/* \
    # Left out because the app never uses them: just-in-time compilation is
    # off (it pulls in LLVM), the server's Perl and the cluster-management
    # wrappers (the app makes its own cluster), locale source data (the
    # database uses C.UTF-8), the sample "snakeoil" certificate and key made
    # at install (every copy of the image would share that key; nothing uses
    # it), and tools for replication, upgrades and benchmarks. The tools an
    # operator needs stay (linked into /usr/local/bin below).
    && rm -rf /usr/lib/x86_64-linux-gnu/libLLVM* /usr/lib/aarch64-linux-gnu/libLLVM* \
              /usr/lib/x86_64-linux-gnu/libz3* /usr/lib/aarch64-linux-gnu/libz3* \
              /usr/lib/postgresql/*/lib/llvmjit* /usr/lib/postgresql/*/lib/bitcode \
              /usr/lib/*-linux-gnu/libperl* /usr/lib/*-linux-gnu/perl /usr/share/perl \
              /usr/lib/*-linux-gnu/gconv \
              /usr/share/i18n /usr/share/locale /usr/share/postgresql-common \
              /etc/ssl/private/ssl-cert-snakeoil.key /etc/ssl/certs/ssl-cert-snakeoil.pem \
    && find /etc/ssl/certs -xtype l -delete \
    && cd /usr/lib/postgresql/17/bin \
    && rm -f pgbench pg_test_fsync pg_test_timing pg_waldump pg_walsummary \
             pg_rewind pg_receivewal pg_recvlogical pg_basebackup pg_combinebackup \
             pg_verifybackup pg_createsubscriber pg_upgrade oid2name vacuumlo \
             pg_archivecleanup pg_amcheck clusterdb reindexdb \
    && find /usr/bin -lname '*pg_wrapper' -delete \
    && for tool in psql pg_dump pg_dumpall pg_restore pg_isready createdb; do \
         ln -s "/usr/lib/postgresql/17/bin/$tool" "/usr/local/bin/$tool"; \
       done
# Then remove what neither the app nor an emergency repair needs. Kept on
# purpose: the shell, Python, manage.py and the openssl command (an operator's
# repair tools; the app makes its own certificate with openssl).
RUN set -e \
    # What only building, testing or documenting the app needs.
    && rm -rf pyproject.toml uv.lock schema.yml README.md .python-version docker \
    # Django and the REST framework ship message catalogues for every language;
    # the app answers in English only (no locale middleware). Only the
    # catalogues go: Django's locale folders also hold code.
    && find .venv -path '*/locale/*/LC_MESSAGES/*' -type f -not -path '*/locale/en*' -delete \
    && find .venv -path '*/locale/*/LC_MESSAGES' -type d -empty -delete \
    # Compiled extensions ship their C sources; only the built libraries run.
    && find .venv \( -name '*.c' -o -name '*.pyx' -o -name '*.pxd' \) -type f -delete \
    # Brotli only compresses the assets just collected; serving the .br files
    # needs no library. The virtualenv's activation scripts are for people.
    && rm -rf .venv/lib/python3.*/site-packages/_brotli*.so \
              .venv/lib/python3.*/site-packages/brotli.py \
              .venv/lib/python3.*/site-packages/brotli-*.dist-info \
              .venv/bin/activate* .venv/bin/deactivate.bat .venv/bin/pydoc.bat \
              .venv/.gitignore .venv/.lock .venv/CACHEDIR.TAG \
    # The package installer and its build tooling, the unused graphical and
    # bootstrap parts of Python, C headers, documentation and package-manager
    # data.
    && rm -rf /usr/local/lib/python3.*/site-packages/pip* \
              /usr/local/lib/python3.*/site-packages/setuptools* \
              /usr/local/lib/python3.*/site-packages/wheel* \
              /usr/local/lib/python3.*/site-packages/_distutils_hack \
              /usr/local/lib/python3.*/ensurepip \
              /usr/local/lib/python3.*/idlelib \
              /usr/local/lib/python3.*/tkinter \
              /usr/local/lib/python3.*/turtledemo \
              /usr/local/lib/python3.*/config-* \
              /usr/local/bin/pip* /usr/local/bin/idle* /usr/local/bin/pydoc* \
              /usr/local/bin/python*-config \
              /usr/local/include \
              /usr/share/doc /usr/share/man /usr/share/info /usr/share/lintian \
              /var/lib/apt/lists/* /var/cache/apt /var/log/* \
    # The setuid bit on system programs: the app runs unprivileged with
    # no-new-privileges, so it can only matter for harm.
    && find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null

FROM scratch AS production
COPY --from=runtime-build / /
ENV PATH=/app/backend/.venv/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KUKGRADE_IMPORT_UPLOAD_ROOT=/var/lib/kukgrade/import_uploads \
    KUKGRADE_EMBEDDED_SOCKET=/tmp/kukgrade-pg \
    PGHOST=/tmp/kukgrade-pg \
    PGUSER=kukgrade \
    PGDATABASE=kukgrade
LABEL org.opencontainers.image.title="KukGrade" \
      org.opencontainers.image.source="https://github.com/TheRedTower/KukGrade" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
# Which build this is, for the About page; empty when not passed.
ARG KUKGRADE_BUILD_COMMIT=""
ARG KUKGRADE_BUILD_TIME=""
ENV KUKGRADE_BUILD_COMMIT=$KUKGRADE_BUILD_COMMIT \
    KUKGRADE_BUILD_TIME=$KUKGRADE_BUILD_TIME
WORKDIR /app/backend
# Starts as root only to hand /var/lib/kukgrade to the app's user, then runs the
# database and the app as that user (kukgrade/serve.py).
EXPOSE 6942
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["python", "-m", "kukgrade.container_health"]
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["serve"]
