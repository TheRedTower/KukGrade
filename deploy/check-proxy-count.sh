#!/bin/sh
# Checks that the login rate limit sees the real visitor, not an address the
# visitor made up: the sign of a correct DJANGO_NUM_PROXIES for what is in front.
#
#   deploy/check-proxy-count.sh https://kukgrade.example.com
#
# It sends 14 failed sign-ins, each claiming a different address in
# X-Forwarded-For. A correct count keeps seeing one visitor and starts refusing
# (HTTP 429) after 10 a minute. If it never refuses, the count is too high: a
# visitor can pick their own address and the limit is no protection. (A count too
# low shows the other way: every visitor behind the proxy shares one limit, so
# real people lock each other out; check by signing in from two networks.)
#
# Run it from a machine you can spare for a minute: it uses up the limit, so
# your own sign-ins (and, with a count too low, everyone's) are refused for about
# a minute afterwards. Uses -k so it also works against the app's own
# self-signed certificate. The address must be one of DJANGO_ALLOWED_HOSTS and
# its origin one of DJANGO_CSRF_TRUSTED_ORIGINS, or the app refuses the requests
# before the limit is reached and this says so.
set -eu

base="${1:?usage: check-proxy-count.sh https://your-address}"
base="${base%/}"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT

curl -ksS -c "$jar" -o /dev/null "$base/api/setup/" || { echo "Could not reach $base"; exit 2; }
token="$(awk '$6 == "csrftoken" { print $7 }' "$jar")"
if [ -z "$token" ]; then
    echo "No CSRF cookie from $base/api/setup/: is the address in DJANGO_ALLOWED_HOSTS?"
    exit 2
fi

refused=0
failed=0
other=""
for n in $(seq 1 14); do
    status="$(curl -ksS -b "$jar" -o /dev/null -w '%{http_code}' \
        -H "X-CSRFToken: $token" -H "Content-Type: application/json" \
        -H "X-Forwarded-For: 203.0.113.$n" -H "Referer: $base/" \
        -d '{"email":"nobody@example.invalid","password":"wrong"}' \
        "$base/api/auth/login/")"
    case "$status" in
        429) refused=$((refused + 1)) ;;
        400|401) failed=$((failed + 1)) ;;
        *) other="$status" ;;
    esac
done

if [ -n "$other" ]; then
    echo "Unexpected HTTP $other from the sign-in: the app refused the requests before the"
    echo "limit applied (often a CSRF refusal: put this address, with its port, in"
    echo "DJANGO_CSRF_TRUSTED_ORIGINS). The count has not been checked."
    exit 2
elif [ "$refused" -gt 0 ]; then
    echo "OK: the limit refused $refused of 14 sign-ins; made-up addresses did not help."
else
    echo "TOO HIGH, or no limit: 14 failed sign-ins with 14 made-up addresses were never refused."
    echo "Lower DJANGO_NUM_PROXIES to the number of proxies really in front."
    exit 1
fi
