-- DEV ONLY credentials. Runs once, on an empty data directory.
--
-- cloudtrain_owner : owns the schema, runs migrations and the seed.
-- cloudtrain_app   : what the gateway connects as. Not a superuser, no
--                    BYPASSRLS, not the table owner -> row-level security applies.
-- keycloak         : Keycloak's own database.
CREATE ROLE cloudtrain_owner LOGIN PASSWORD 'owner-dev-only';
CREATE ROLE cloudtrain_app LOGIN PASSWORD 'app-dev-only' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE DATABASE cloudtrain OWNER cloudtrain_owner;
CREATE ROLE keycloak LOGIN PASSWORD 'keycloak-dev-only';
CREATE DATABASE keycloak OWNER keycloak;
\connect cloudtrain
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO cloudtrain_owner;
GRANT USAGE ON SCHEMA public TO cloudtrain_app;
-- Test databases (vitest) are created by the owner on demand.
ALTER ROLE cloudtrain_owner CREATEDB;
