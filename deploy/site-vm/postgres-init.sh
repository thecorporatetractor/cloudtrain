#!/bin/sh
# Runs once, on an empty data directory (Postgres image entrypoint).
#   cloudtrain_owner : owns the schema, runs the migrations (the migrate service).
#   cloudtrain_app   : what the gateway connects as. Not a superuser, no BYPASSRLS,
#                      not the table owner, so row-level security applies.
# Passwords come from .env (CT_OWNER_PASSWORD, CT_APP_PASSWORD).
set -eu
psql -v ON_ERROR_STOP=1 -U postgres \
  -v owner_pw="$CT_OWNER_PASSWORD" -v app_pw="$CT_APP_PASSWORD" <<'SQL'
CREATE ROLE cloudtrain_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE cloudtrain_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE cloudtrain OWNER cloudtrain_owner;
\connect cloudtrain
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO cloudtrain_owner;
GRANT USAGE ON SCHEMA public TO cloudtrain_app;
SQL
