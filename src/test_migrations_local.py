import os
import glob
import tempfile
import psycopg
import pgserver

MIGRATIONS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../supabase/migrations"))

AUTH_STUBS = """
CREATE OR REPLACE FUNCTION public.gen_salt(t text) RETURNS text AS $$ SELECT 'salt' $$ LANGUAGE sql IMMUTABLE;
CREATE OR REPLACE FUNCTION public.crypt(p text, s text) RETURNS text AS $$ SELECT 'hashed_' || p $$ LANGUAGE sql IMMUTABLE;

CREATE SCHEMA IF NOT EXISTS auth;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID,
  aud VARCHAR(255) DEFAULT 'authenticated',
  role VARCHAR(255) DEFAULT 'authenticated',
  email VARCHAR(255) UNIQUE,
  encrypted_password VARCHAR(255),
  email_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  raw_app_meta_data JSONB DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS JSONB AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    current_user
  );
$$ LANGUAGE SQL STABLE;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
"""

def test():
    tmp = tempfile.mkdtemp()
    srv = pgserver.get_server(tmp)
    conn_uri = srv.get_uri()
    print("Local Postgres running at:", conn_uri)

    files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    migration_files = [f for f in files if not f.endswith("_rollback.sql")]

    with psycopg.connect(conn_uri) as conn:
        with conn.cursor() as cur:
            cur.execute(AUTH_STUBS)
        conn.commit()

        print(f"\n--- Testing {len(migration_files)} migrations in order ---")
        for f in migration_files:
            fname = os.path.basename(f)
            with open(f, "r", encoding="utf-8") as sql_file:
                content = sql_file.read()
            try:
                with conn.cursor() as cur:
                    cur.execute(content)
                conn.commit()
                print(f"  [SUCCESS] {fname}")
            except Exception as e:
                conn.rollback()
                print(f"  [FAILED] {fname}\n  Error: {e}")
                return False

    print("ALL MIGRATIONS APPLIED SUCCESSFULLY!")
    return True

if __name__ == "__main__":
    test()
