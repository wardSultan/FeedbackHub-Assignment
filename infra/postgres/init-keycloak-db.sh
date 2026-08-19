#!/bin/bash
# Keycloak gets its own database on the same server rather than its own server: separate
# schemas and separate credentials, one thing to run. It shares nothing with the
# application database, so it can still be moved out later without a data migration.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-SQL
    CREATE USER keycloak WITH PASSWORD '${KEYCLOAK_DB_PASSWORD:-keycloak}';
    CREATE DATABASE keycloak OWNER keycloak;
SQL
