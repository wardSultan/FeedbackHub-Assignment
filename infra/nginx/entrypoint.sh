#!/bin/sh
# Writes the frontend's runtime configuration from environment variables.
#
# This is the whole reason the Angular application fetches /config.json instead of
# using Angular's build-time environment files: the same image runs against a local
# Keycloak, a staging realm or production, configured by where it starts rather than
# by when it was built.
set -eu

: "${API_URL:=http://localhost:3000}"
: "${KEYCLOAK_ISSUER:=http://localhost:8080/realms/feedbackhub}"
: "${KEYCLOAK_CLIENT_ID:=feedbackhub-web}"

cat > /usr/share/nginx/html/config.json <<JSON
{
  "apiUrl": "${API_URL}",
  "keycloak": {
    "issuer": "${KEYCLOAK_ISSUER}",
    "clientId": "${KEYCLOAK_CLIENT_ID}"
  }
}
JSON

echo "runtime config written: apiUrl=${API_URL} issuer=${KEYCLOAK_ISSUER}"
