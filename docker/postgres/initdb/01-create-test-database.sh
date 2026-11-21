#!/bin/sh
# Runs once, when the postgres container initialises an empty data volume.
# Creates the isolated database the backend test suite uses ($POSTGRES_TEST_DB).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v testdb="${POSTGRES_TEST_DB:-datapilot_test}" <<'EOSQL'
SELECT format('CREATE DATABASE %I OWNER %I', :'testdb', current_user)
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'testdb') \gexec
EOSQL
