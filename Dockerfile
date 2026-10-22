FROM node:22-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN VITE_API_BASE_URL= npm run build -- --base=/static/

FROM python:3.14-slim AS python-deps
COPY --from=ghcr.io/astral-sh/uv:0.9.17 /uv /uvx /usr/local/bin/
ENV UV_PYTHON_DOWNLOADS=never UV_LINK_MODE=copy
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.14-slim AS production
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/app/backend/.venv/bin:$PATH \
    KUKGRADE_IMPORT_UPLOAD_ROOT=/var/lib/kukgrade/import_uploads
# Which build this is, for the About page; empty when not passed.
ARG KUKGRADE_BUILD_COMMIT=""
ARG KUKGRADE_BUILD_TIME=""
ENV KUKGRADE_BUILD_COMMIT=$KUKGRADE_BUILD_COMMIT \
    KUKGRADE_BUILD_TIME=$KUKGRADE_BUILD_TIME
WORKDIR /app/backend
COPY --from=python-deps /app/backend/.venv ./.venv
COPY backend/ ./
COPY --from=frontend-build /app/frontend/dist ./frontend_dist
COPY backend/docker/entrypoint.sh /app/entrypoint.sh
RUN DJANGO_SECRET_KEY=build-only-not-a-runtime-secret \
    python manage.py collectstatic --noinput \
    && groupadd --system --gid 10001 appuser \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /var/lib/kukgrade/import_uploads \
    && chown -R appuser:appuser /var/lib/kukgrade \
    && chmod 755 /app/entrypoint.sh
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD ["python", "-m", "kukgrade.container_health"]
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["serve"]
