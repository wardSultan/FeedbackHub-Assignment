#!/usr/bin/env bash
#
# Get an access token from the Keycloak realm, by signing in or by registering.
#
#     ./infra/scripts/kc-token.sh admin@feedbackhub.local 'Passw0rd!demo'
#     ./infra/scripts/kc-token.sh --register new@example.com 'Passw0rd!new'
#
# Prints the access token on stdout, so it composes:
#
#     curl -H "Authorization: Bearer $(./infra/scripts/kc-token.sh user@feedbackhub.local 'Passw0rd!demo')" \
#          http://localhost:3000/api/v1/me
#
# Why this exists: the API has no login endpoint — Keycloak issues the tokens (ADR-0004),
# and `feedbackhub-web` is a public client with direct grants disabled, so there is no
# `grant_type=password` shortcut. This walks the real authorization-code + PKCE flow the
# browser walks, which means testing against exactly the path production uses rather than
# a weakened client configured for convenience.
#
# For testing only. It posts a password to a login form; do not point it at anything real.

set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8080}"
REALM="${REALM:-feedbackhub}"
CLIENT_ID="${CLIENT_ID:-feedbackhub-web}"
REDIRECT_URI="${REDIRECT_URI:-http://localhost:4200/}"

MODE=login
if [[ "${1:-}" == "--register" ]]; then
  MODE=register
  shift
fi

EMAIL="${1:-}"
PASSWORD="${2:-}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "usage: $0 [--register] <email> <password>" >&2
  exit 64
fi

BASE="$KEYCLOAK_URL/realms/$REALM/protocol/openid-connect"
JAR="$(mktemp)"
PAGE="$(mktemp)"
trap 'rm -f "$JAR" "$PAGE"' EXIT

# PKCE. The `\r` in the tr set is not decoration: Windows builds of openssl emit CRLF, and
# the stray carriage return makes curl reject the URL outright.
VERIFIER="$(openssl rand -base64 60 | tr -d '\r\n=+/' | cut -c1-64)"
CHALLENGE="$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 |
  tr -d '\r\n=' | tr '+/' '-_')"

# `registrations` is the same authorization request; it just lands on the sign-up form.
ENDPOINT=auth
[[ "$MODE" == register ]] && ENDPOINT=registrations

urlencode() { printf '%s' "$1" | od -An -tx1 | tr ' ' '\n' | grep -v '^$' |
  while read -r c; do printf '%%%s' "$c"; done; }

curl -sS -c "$JAR" -o "$PAGE" \
  "$BASE/$ENDPOINT?client_id=$CLIENT_ID&response_type=code&scope=openid%20profile%20email&redirect_uri=$(urlencode "$REDIRECT_URI")&code_challenge=$CHALLENGE&code_challenge_method=S256"

# Keycloak puts a single-use session code in the form action; it cannot be constructed.
ACTION="$(grep -o 'action="[^"]*"' "$PAGE" | head -1 | sed 's/^action="//; s/"$//; s/&amp;/\&/g')"

if [[ -z "$ACTION" ]]; then
  echo "No form on the $ENDPOINT page — is the realm up, and is registration enabled?" >&2
  exit 1
fi

if [[ "$MODE" == register ]]; then
  LOCATION="$(curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "email=$EMAIL" \
    --data-urlencode "firstName=${FIRST_NAME:-Test}" \
    --data-urlencode "lastName=${LAST_NAME:-User}" \
    --data-urlencode "password=$PASSWORD" \
    --data-urlencode "password-confirm=$PASSWORD" \
    "$ACTION")"
else
  LOCATION="$(curl -sS -b "$JAR" -c "$JAR" -o /dev/null -w '%{redirect_url}' \
    --data-urlencode "username=$EMAIL" \
    --data-urlencode "password=$PASSWORD" \
    --data-urlencode 'credentialId=' \
    "$ACTION")"
fi

CODE="$(printf '%s' "$LOCATION" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')"

if [[ -z "$CODE" ]]; then
  # A rejected password re-renders the form rather than redirecting, so there is no code.
  echo "No authorization code returned. Keycloak said: ${LOCATION:-<no redirect>}" >&2
  exit 1
fi

curl -sS -X POST "$BASE/token" \
  -d grant_type=authorization_code \
  -d "client_id=$CLIENT_ID" \
  -d "code=$CODE" \
  -d "redirect_uri=$REDIRECT_URI" \
  -d "code_verifier=$VERIFIER" |
  python -c "
import json, sys
payload = json.load(sys.stdin)
if 'access_token' not in payload:
    sys.exit(f\"Token request failed: {payload}\")
print(payload['access_token'])
"
