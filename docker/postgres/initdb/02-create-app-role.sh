#!/bin/sh
# Creates the least-privilege runtime user the API connects as ($POSTGRES_APP_USER). It owns nothing and has no DDL
# rights; migration 0003 (run as the owner, $POSTGRES_USER) grants it exactly the table privileges the app needs.
#
# Runs automatically on a fresh volume. For an existing volume, run it once by hand (idempotent):
#   docker compose exec postgres /docker-entrypoint-initdb.d/02-create-app-role.sh
set -eu
: "${POSTGRES_APP_USER:?POSTGRES_APP_USER is not set}"
: "${POSTGRES_APP_PASSWORD:?POSTGRES_APP_PASSWORD is not set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_user="$POSTGRES_APP_USER" -v app_password="$POSTGRES_APP_PASSWORD" \
  -v db="$POSTGRES_DB" -v testdb="${POSTGRES_TEST_DB:-datapilot_test}" <<'EOSQL'
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS', :'app_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'app_user') \gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'app_user', :'app_password') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', datname, :'app_user')
FROM pg_database WHERE datname IN (:'db', :'testdb') \gexec
EOSQL
