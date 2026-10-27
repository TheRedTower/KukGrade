#!/bin/sh
# Starts the production image the two ways it is deployed and checks it works:
#   1. with its own database (deploy/compose.yml): healthy, the first
#      administrator set up and signed in, the admin closed, a clean stop;
#   2. as deploy/compose.external-db.yml runs it: UID 10001, a read-only root, every
#      capability dropped, an external PostgreSQL and two proxies declared.
#
#   .github/scripts/image-smoke.sh kukgrade:ci
set -eu

image="${1:?usage: image-smoke.sh IMAGE}"
data="$(mktemp -d)"
jar="$(mktemp)"
body="$(mktemp)"
cleanup() {
    docker rm -f kg-own kg-prod kg-db >/dev/null 2>&1 || true
    docker network rm kg-smoke >/dev/null 2>&1 || true
    docker volume rm kg-uploads >/dev/null 2>&1 || true
}
# Whatever an interrupted earlier run left behind goes first.
cleanup
trap 'cleanup; docker run --rm -v "$data:/d" --entrypoint sh "$image" -c "rm -rf /d/*" >/dev/null 2>&1 || true; rm -rf "$data" "$jar" "$body" 2>/dev/null || true' EXIT
trap 'exit 1' INT TERM

fail() {
    echo "FAIL: $*"
    cat "$body" 2>/dev/null && echo
    for name in kg-own kg-prod; do
        docker logs "$name" 2>&1 | tail -40 || true
    done
    exit 1
}

wait_healthy() {
    i=0
    while [ "$(docker inspect -f '{{.State.Health.Status}}' "$1")" != healthy ]; do
        [ "$(docker inspect -f '{{.State.Running}}' "$1")" = true ] \
            || [ "$(docker inspect -f '{{.State.Restarting}}' "$1")" = true ] \
            || fail "$1 stopped"
        i=$((i + 1))
        [ "$i" -gt 90 ] && fail "$1 did not become healthy"
        sleep 2
    done
}

status() {
    curl -ks -o "$body" -w '%{http_code}' "$@"
}

echo "== Setuid files and the tools kept for repairs"
docker run --rm --entrypoint sh "$image" -c '
    [ -z "$(find / -xdev -perm /6000 -type f 2>/dev/null)" ] || exit 1
    for tool in sh python psql pg_dump pg_restore openssl; do
        command -v "$tool" >/dev/null || exit 1
    done
' || fail "setuid files present or a repair tool missing"

echo "== With its own database"
docker run -d --name kg-own -p 127.0.0.1:6942:6942 \
    -e DJANGO_ALLOWED_HOSTS=localhost \
    -e DJANGO_CSRF_TRUSTED_ORIGINS=https://localhost:6942 \
    -v "$data:/var/lib/kukgrade" "$image" >/dev/null
wait_healthy kg-own
base=https://localhost:6942
for path in /admin/ /admin/login/ /static/admin/css/base.css /api/ready/; do
    [ "$(status "$base$path")" = 404 ] || fail "$path is not closed"
done
[ "$(status "$base/students/42")" = 200 ] || fail "a deep link is not the app's page"

code="$(docker logs kg-own 2>&1 | sed -n 's/.*setup code: \([A-Z0-9-]*\).*/\1/p' | tail -1)"
[ -n "$code" ] || fail "no setup code in the log"
password=Smoke-Test-Password-42

# POST a JSON body to the app as a browser would (CSRF cookie and header).
post() {
    : >"$jar"
    curl -ksS -c "$jar" -b "$jar" -o /dev/null "$base/api/setup/"
    token="$(awk '$6 == "csrftoken" { print $7 }' "$jar")"
    status -c "$jar" -b "$jar" -H "X-CSRFToken: $token" -H "Referer: $base/" \
        -H 'Content-Type: application/json' -d "$2" "$base$1"
}

setup='{"code":"'"$code"'","email":"admin@example.com","password":"'"$password"'"}'
[ "$(post /api/setup/ "$setup")" = 201 ] || fail "first administrator setup"
login='{"email":"admin@example.com","password":"'"$password"'"}'
[ "$(post /api/auth/login/ "$login")" = 200 ] || fail "sign-in"
[ "$(status -b "$jar" "$base/api/auth/me/")" = 200 ] || fail "signed-in request"

[ "$(docker exec kg-own psql -tAc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user')" = f ] \
    || fail "the app's database role is a superuser"
[ "$(docker exec kg-own psql -U postgres -tAc 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user')" = t ] \
    || fail "the operator's superuser role is missing"
# As long as the compose files allow.
docker stop -t 120 kg-own >/dev/null
docker logs kg-own 2>&1 | grep -q "database system is shut down" \
    || fail "the database was not shut down cleanly"
docker start kg-own >/dev/null
wait_healthy kg-own
[ "$(status -b "$jar" "$base/api/auth/me/")" = 200 ] \
    || fail "the session did not survive a restart (data or secret key lost)"
docker rm -f kg-own >/dev/null

echo "== As compose.external-db.yml runs it"
docker network create kg-smoke >/dev/null
docker run -d --name kg-db --network kg-smoke \
    -e POSTGRES_DB=kukgrade -e POSTGRES_USER=kukgrade -e POSTGRES_PASSWORD=smoke \
    postgres:17-alpine >/dev/null
# Restarted until the database answers, as unless-stopped does in compose.external-db.yml.
docker run -d --name kg-prod --network kg-smoke -p 127.0.0.1:16942:6942 \
    --restart on-failure --user 10001:10001 --read-only \
    -v kg-uploads:/var/lib/kukgrade/import_uploads \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
    --cap-drop ALL --security-opt no-new-privileges:true \
    -e POSTGRES_HOST=kg-db -e POSTGRES_PASSWORD=smoke \
    -e DJANGO_SECRET_KEY=ci-only-secret-key-000000000000000000000000000000000000 \
    -e DJANGO_ALLOWED_HOSTS=www.kukgrade.co.uk -e DJANGO_NUM_PROXIES=2 \
    "$image" >/dev/null
wait_healthy kg-prod
[ "$(status -H 'Host: www.kukgrade.co.uk' -H 'X-Forwarded-Proto: https' \
    -H 'X-Forwarded-For: 203.0.113.1, 198.51.100.1' \
    http://127.0.0.1:16942/api/health/)" = 200 ] || fail "the forwarded scheme is not trusted"
docker exec kg-prod sh -c 'touch /var/lib/kukgrade/import_uploads/probe && rm /var/lib/kukgrade/import_uploads/probe' \
    || fail "the import folder is not writable"

echo "OK"
