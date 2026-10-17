import os
import sys
import subprocess
import psycopg
import pgserver

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

MIGRATIONS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../supabase/migrations"))

AUTH_STUBS = """
-- Built-in functions & crypt stubs for local testing without external compiled C pgcrypto
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
  invited_at TIMESTAMPTZ,
  confirmation_token VARCHAR(255),
  confirmation_sent_at TIMESTAMPTZ,
  recovery_token VARCHAR(255),
  recovery_sent_at TIMESTAMPTZ,
  email_change_token_new VARCHAR(255),
  email_change VARCHAR(255),
  email_change_sent_at TIMESTAMPTZ,
  last_sign_in_at TIMESTAMPTZ,
  raw_app_meta_data JSONB DEFAULT '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  is_super_admin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  phone VARCHAR(255) DEFAULT NULL,
  phone_confirmed_at TIMESTAMPTZ,
  phone_change VARCHAR(255) DEFAULT '',
  phone_change_token VARCHAR(255) DEFAULT '',
  phone_change_sent_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ DEFAULT NOW(),
  email_change_token_current VARCHAR(255) DEFAULT '',
  email_change_confirm_status SMALLINT DEFAULT 0,
  banned_until TIMESTAMPTZ,
  reauthentication_token VARCHAR(255) DEFAULT '',
  reauthentication_sent_at TIMESTAMPTZ,
  is_sso_user BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMPTZ
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
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
"""

def main():
    print("============================================================")
    print("TESTING migrate:schedules WITH DIRECT SQL (PostgREST-free path)")
    print("============================================================")

    srv = pgserver.get_server("migrate_e2e_db")
    base_uri = srv.get_uri()
    print(f"Postgres running at: {base_uri}")

    with psycopg.connect(base_uri, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("DROP DATABASE IF EXISTS test_migrate_db;")
            cur.execute("CREATE DATABASE test_migrate_db;")

    # Apply auth stubs and migrations
    with psycopg.connect(base_uri, dbname="test_migrate_db", autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(AUTH_STUBS)
            for m in [
                "20260812_rbac_setup.sql",
                "20260812_seed_test_accounts.sql",
                "20260914_exam_date_and_addresses.sql",
                "20261010_role_access_lockdown.sql",
                "20261011_student_dossiers.sql",
                "20261012_email_log.sql",
                "20261013_tokens_and_slot_claims.sql",
                "20261014_attendance_records.sql",
                "20261015_schedules_and_single_store.sql"
            ]:
                fpath = os.path.join(MIGRATIONS_DIR, m)
                with open(fpath, "r", encoding="utf-8") as f:
                    cur.execute(f.read())
            print("Migrations applied to test_migrate_db.")

            # Seed 3 active courses with timetable schedule in course_material
            courses_sql = """
                INSERT INTO public.courses (id, course_code, name, description, status, course_material)
                VALUES 
                    ('11111111-1111-1111-1111-111111111111', 'CRS-01', 'Advanced Math 1', 'Math course', 'Active',
                     '{"schedule": [{"id": "slot-m1-mon", "day": "Monday", "startTime": "09:00 AM", "endTime": "10:30 AM", "room": "Room 101"}, {"id": "slot-m1-wed", "day": "Wednesday", "startTime": "09:00 AM", "endTime": "10:30 AM", "room": "Room 101"}]}'::text),
                    ('22222222-2222-2222-2222-222222222222', 'CRS-02', 'English Literature', 'English course', 'Active',
                     '{"schedule": [{"id": "slot-eng-tue", "day": "Tuesday", "startTime": "11:00 AM", "endTime": "12:30 PM", "room": "Room 102"}, {"id": "slot-eng-thu", "day": "Thursday", "startTime": "11:00 AM", "endTime": "12:30 PM", "room": "Room 102"}]}'::text),
                    ('33333333-3333-3333-3333-333333333333', 'CRS-03', 'Physics Dynamics', 'Physics course', 'Active',
                     '{"schedule": [{"id": "slot-phy-fri", "day": "Friday", "startTime": "01:00 PM", "endTime": "02:30 PM", "room": "Lab 1"}, {"id": "slot-phy-sat", "day": "Saturday", "startTime": "10:00 AM", "endTime": "11:30 AM", "room": "Lab 1"}]}'::text)
                ON CONFLICT (id) DO NOTHING;
            """
            cur.execute(courses_sql)
            print("Seeded 3 active courses with 6 timetable slots in course_material.")

    db_url = srv.get_uri("test_migrate_db")

    # Run npm run migrate:schedules
    print(f"\n--- RUNNING: npm run migrate:schedules with DATABASE_URL={db_url} ---")
    backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    env = os.environ.copy()
    env["DATABASE_URL"] = db_url

    res = subprocess.run(
        ["npm", "run", "migrate:schedules"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        shell=True
    )

    print("\n--- STDOUT FROM migrate:schedules ---")
    print(res.stdout)
    if res.stderr:
        print("--- STDERR ---")
        print(res.stderr)
    print(f"Exit code: {res.returncode}")

    assert res.returncode == 0, f"migrate:schedules failed with exit code {res.returncode}"

    # Verify directly via SELECT count(*)
    with psycopg.connect(base_uri, dbname="test_migrate_db", autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM public.schedules;")
            count = cur.fetchone()[0]
            print(f"\nVerification Query: SELECT count(*) FROM public.schedules -> {count}")
            assert count == 6, f"Expected 6 schedules, got {count}"
            print("[PASS] REAL COUNT VERIFIED: Exactly 6 schedules inserted and confirmed.")

    # ------------------------------------------------------------------------
    # Test Failure Detection (it must exit non-zero and never swallow errors)
    # ------------------------------------------------------------------------
    print("\n--- TESTING FAILURE PROPAGATION (Must exit non-zero) ---")
    with psycopg.connect(base_uri, dbname="test_migrate_db", autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("DROP TABLE public.schedules CASCADE;")

    res_fail = subprocess.run(
        ["npm", "run", "migrate:schedules"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        shell=True
    )
    print(f"Exit code when table is missing: {res_fail.returncode} (Expected: non-zero)")
    assert res_fail.returncode != 0, "migrate:schedules swallowed the error instead of exiting non-zero!"
    print("[PASS] ERROR HANDLING VERIFIED: Non-zero exit code on database error.")

if __name__ == "__main__":
    main()
