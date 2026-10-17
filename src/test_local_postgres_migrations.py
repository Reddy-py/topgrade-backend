import os
import sys
import glob
import tempfile
import json
import psycopg
from psycopg import sql
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

def get_all_migration_files():
    files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    return [f for f in files if not f.endswith("_rollback.sql")]

def get_path_a_migration_files():
    # Only migrations that exist on the live database (without 20260817 and 20260910), then 20261015
    all_files = get_all_migration_files()
    excluded = {"20260817_core_architecture.sql", "20260910_schedules_and_history.sql"}
    return [f for f in all_files if os.path.basename(f) not in excluded]

def run_migration_list(conn, file_list, pass_num, path_name):
    print(f"\n--- {path_name}: PASS {pass_num} ({len(file_list)} migrations) ---")
    for fpath in file_list:
        fname = os.path.basename(fpath)
        with open(fpath, "r", encoding="utf-8") as f:
            sql_content = f.read()
        try:
            with conn.cursor() as cur:
                cur.execute(sql_content)
            conn.commit()
            print(f"  [{path_name} PASS {pass_num}] SUCCESS: {fname}")
        except Exception as e:
            conn.rollback()
            print(f"  [{path_name} PASS {pass_num}] FAILED: {fname}\nError: {e}")
            raise e
    print(f"[{path_name} PASS {pass_num}] ALL {len(file_list)} MIGRATIONS SUCCEEDED WITH 0 ERRORS.")

def test_rls_matrix_and_fixtures(conn):
    print(f"\n============================================================")
    print(f"SEEDING FIXTURES & TESTING RLS POLICIES")
    print(f"============================================================")

    admin_id = "11111111-1111-1111-1111-111111111111"
    teacher1_id = "22222222-2222-2222-2222-222222222222"
    teacher2_id = "33333333-3333-3333-3333-333333333333"
    parent1_id = "44444444-4444-4444-4444-444444444444"
    parent2_id = "55555555-5555-5555-5555-555555555555"
    student1_id = "66666666-6666-6666-6666-666666666666"
    student2_id = "77777777-7777-7777-7777-777777777777"
    student3_id = "88888888-8888-8888-8888-888888888888"

    admin_email = "admin@topgrade.edu"
    teacher1_email = "t1@topgrade.edu"
    teacher2_email = "t2@topgrade.edu"
    parent1_email = "parent1@gmail.com"
    parent2_email = "parent2@gmail.com"
    student1_email = "student1@gmail.com"
    student2_email = "student2@gmail.com"
    student3_email = "student3@gmail.com"

    with conn.cursor() as cur:
        # Create auth users & profiles
        users = [
            (admin_id, admin_email, "Admin User", "ADMIN"),
            (teacher1_id, teacher1_email, "Teacher Alice", "TEACHER"),
            (teacher2_id, teacher2_email, "Teacher Bob", "TEACHER"),
            (parent1_id, parent1_email, "Parent One", "PARENT"),
            (parent2_id, parent2_email, "Parent Two", "PARENT"),
            (student1_id, student1_email, "Student One", "STUDENT"),
            (student2_id, student2_email, "Student Two", "STUDENT"),
            (student3_id, student3_email, "Student Three", "STUDENT"),
        ]
        user_ids = {}
        for uid, email, name, role in users:
            cur.execute("""
                INSERT INTO auth.users (id, email) VALUES (%s, %s)
                ON CONFLICT (email) DO UPDATE SET raw_user_meta_data = jsonb_build_object('role', EXCLUDED.raw_user_meta_data->>'role')
                RETURNING id;
            """, (uid, email))
            actual_uid = str(cur.fetchone()[0])
            user_ids[email] = actual_uid
            cur.execute("""
                INSERT INTO public.profiles (id, email, full_name, role, status)
                VALUES (%s, %s, %s, %s, 'Active')
                ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'Active';
            """, (actual_uid, email, name, role))

        t1_uid = user_ids[teacher1_email]
        t2_uid = user_ids[teacher2_email]
        s1_uid = user_ids[student1_email]
        s2_uid = user_ids[student2_email]
        s3_uid = user_ids[student3_email]

        # Teachers
        cur.execute("""
            INSERT INTO public.teachers (id, user_id, teacher_id_code, name, email, status)
            VALUES 
                (%s, %s, 'TCH-001', 'Teacher Alice', %s, 'Active'),
                (%s, %s, 'TCH-002', 'Teacher Bob', %s, 'Active')
            ON CONFLICT (id) DO NOTHING;
        """, (t1_uid, t1_uid, teacher1_email, t2_uid, t2_uid, teacher2_email))

        # Students
        # Parent 1 has 2 children: Student 1 and Student 2
        # Parent 2 has 1 child: Student 3
        cur.execute("""
            INSERT INTO public.students (id, user_id, student_id_code, name, email, parent_emails, status)
            VALUES 
                (%s, %s, 'STU-001', 'Student One', %s, ARRAY[%s], 'ACTIVE'),
                (%s, %s, 'STU-002', 'Student Two', %s, ARRAY[%s], 'ACTIVE'),
                (%s, %s, 'STU-003', 'Student Three', %s, ARRAY[%s], 'ACTIVE')
            ON CONFLICT (id) DO NOTHING;
        """, (
            s1_uid, s1_uid, student1_email, parent1_email,
            s2_uid, s2_uid, student2_email, parent1_email,
            s3_uid, s3_uid, student3_email, parent2_email
        ))

        # Schedules:
        # sched-1 taught by Teacher Alice (TCH-001)
        # sched-2 taught by Teacher Bob (TCH-002)
        cur.execute("""
            INSERT INTO public.schedules (id, course_id, course_name, teacher_id, teacher_name, day_of_week, start_time, end_time, time_slot, is_active, open_for_teachers)
            VALUES 
                ('sched-1', 'CRS-101', 'Algebra 1', 'TCH-001', 'Teacher Alice', 'Monday', '10:00 AM', '11:00 AM', '10:00 AM - 11:00 AM', TRUE, FALSE),
                ('sched-2', 'CRS-102', 'Geometry', 'TCH-002', 'Teacher Bob', 'Tuesday', '02:00 PM', '03:00 PM', '02:00 PM - 03:00 PM', TRUE, FALSE)
            ON CONFLICT (id) DO UPDATE SET teacher_id = EXCLUDED.teacher_id;
        """)

        # Schedule Students (ROSTER):
        # sched-1 has Student 1, Student 2, AND Student 3!
        # CRUCIAL: Student 1 and Student 3 are CLASSMATES in the same slot!
        # sched-2 has Student 3
        cur.execute("""
            INSERT INTO public.schedule_students (id, schedule_id, student_id, student_name, student_code)
            VALUES
                ('ss-1', 'sched-1', 'STU-001', 'Student One', 'STU-001'),
                ('ss-2', 'sched-1', 'STU-002', 'Student Two', 'STU-002'),
                ('ss-3', 'sched-1', 'STU-003', 'Student Three', 'STU-003'),
                ('ss-4', 'sched-2', 'STU-003', 'Student Three', 'STU-003')
            ON CONFLICT (id) DO NOTHING;
        """)

        # Teacher Availability:
        # Teacher Alice has 2 slots, Teacher Bob has 1 slot
        cur.execute("""
            INSERT INTO public.teacher_availability (id, teacher_id, day_of_week, available_from, available_to, is_active)
            VALUES
                ('avail-1', 'TCH-001', 'Monday', '09:00', '17:00', TRUE),
                ('avail-2', 'TCH-001', 'Wednesday', '09:00', '17:00', TRUE),
                ('avail-3', 'TCH-002', 'Tuesday', '10:00', '16:00', TRUE)
            ON CONFLICT (id) DO NOTHING;
        """)

        # Student History:
        # Student 1 has 1, Student 2 has 1, Student 3 has 1
        cur.execute("""
            INSERT INTO public.student_history (id, student_id, student_name, event_type, title, description)
            VALUES
                ('hist-1', 'STU-001', 'Student One', 'ENROLLMENT', 'Enrolled in Algebra 1', 'Enrolled successfully'),
                ('hist-2', 'STU-002', 'Student Two', 'ENROLLMENT', 'Enrolled in Algebra 1', 'Enrolled successfully'),
                ('hist-3', 'STU-003', 'Student Three', 'ENROLLMENT', 'Enrolled in Geometry', 'Enrolled successfully')
            ON CONFLICT (id) DO NOTHING;
        """)

        # Leads & Enrollments:
        # Student 1 has 1 enrollment; Student 3 has 1 enrollment
        cur.execute("""
            INSERT INTO public.leads (id, source, student_name, contact_number, email, academic_grade)
            VALUES
                ('lead-1', 'Website', 'Student One', '1234567890', %s, '9th Grade'),
                ('lead-2', 'Website', 'Student Three', '0987654321', %s, '10th Grade')
            ON CONFLICT (id) DO NOTHING;
        """, (student1_email, student3_email))
        cur.execute("""
            INSERT INTO public.enrollments (id, lead_id, student_id, email, academic_grade, status)
            VALUES
                ('enr-1', 'lead-1', %s, %s, '9th Grade', 'APPROVED'),
                ('enr-2', 'lead-2', %s, %s, '10th Grade', 'APPROVED')
            ON CONFLICT (id) DO NOTHING;
        """, (s1_uid, student1_email, s3_uid, student3_email))

        # Tutoring & Afterschool Past Records
        cur.execute("""
            INSERT INTO public.tutoring_past_records (id, student_id, student_name, subject, teacher_name, term_period, status)
            VALUES
                ('tut-1', 'STU-001', 'Student One', 'Algebra 1', 'Teacher Alice', 'Fall 2025', 'Completed'),
                ('tut-2', 'STU-003', 'Student Three', 'Geometry', 'Teacher Bob', 'Fall 2025', 'Completed')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO public.afterschool_past_records (id, student_id, student_name, program_name, grade_level, term_period, status)
            VALUES
                ('aft-1', 'STU-001', 'Student One', 'STEM Robotics', '9th Grade', 'Fall 2025', 'Completed'),
                ('aft-2', 'STU-003', 'Student Three', 'Art Club', '10th Grade', 'Fall 2025', 'Completed')
            ON CONFLICT (id) DO NOTHING;
        """)

        # Grant table access
        cur.execute("""
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
            GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
        """)

        conn.commit()
    print("Test fixtures seeded successfully.")

    # Matrix Roles
    logins = [
        ("Admin", "authenticated", user_ids[admin_email], admin_email, "ADMIN"),
        ("Parent 1 (2 children)", "authenticated", user_ids[parent1_email], parent1_email, "PARENT"),
        ("Parent 2 (1 child)", "authenticated", user_ids[parent2_email], parent2_email, "PARENT"),
        ("Student 1", "authenticated", user_ids[student1_email], student1_email, "STUDENT"),
        ("Teacher 1", "authenticated", user_ids[teacher1_email], teacher1_email, "TEACHER"),
        ("Anonymous", "anon", None, None, None),
    ]

    tables = [
        "schedules",
        "schedule_students",
        "student_history",
        "enrollments",
        "tutoring_past_records",
        "afterschool_past_records",
        "teacher_availability",
        "locations"
    ]

    results = []

    print("\n--- QUERYING AS EACH LOGIN ROLE VIA RLS ---")
    for label, pg_role, uid, email, app_role in logins:
        row_res = {"Login": label}
        with conn.cursor() as cur:
            cur.execute("BEGIN;")
            cur.execute(sql.SQL("SET LOCAL ROLE {};").format(sql.Identifier(pg_role)))
            if uid:
                cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true);", [uid])
                jwt_claims = json.dumps({"sub": uid, "email": email, "role": pg_role})
                cur.execute("SELECT set_config('request.jwt.claims', %s, true);", [jwt_claims])
            else:
                cur.execute("SELECT set_config('request.jwt.claim.sub', '', true);")
                cur.execute("SELECT set_config('request.jwt.claims', '{}', true);")

            for tbl in tables:
                try:
                    cur.execute(sql.SQL("SELECT count(*) FROM public.{};").format(sql.Identifier(tbl)))
                    cnt = cur.fetchone()[0]
                    row_res[tbl] = cnt
                except Exception as ex:
                    row_res[tbl] = f"ERR: {ex}"
            cur.execute("ROLLBACK;")
        results.append(row_res)

    print(f"\n{'Login':<24} | {'sched':<5} | {'sc_stud':<7} | {'hist':<5} | {'enr':<5} | {'tutor':<5} | {'after':<5} | {'avail':<5} | {'loc':<5}")
    print("-" * 83)
    for r in results:
        print(f"{r['Login']:<24} | {r['schedules']:<5} | {r['schedule_students']:<7} | {r['student_history']:<5} | {r['enrollments']:<5} | {r['tutoring_past_records']:<5} | {r['afterschool_past_records']:<5} | {r['teacher_availability']:<5} | {r.get('locations', 0):<5}")

    # Specific assertions for RLS Leaks:
    # 1. Leak 1: teacher_availability
    for r in results:
        if r['Login'] in ("Parent 1 (2 children)", "Parent 2 (1 child)", "Student 1", "Anonymous"):
            assert r['teacher_availability'] == 0, f"LEAK 1 FAILED: {r['Login']} saw {r['teacher_availability']} availability rows (Expected: 0)"
    print("\n[PASS] LEAK 1 VERIFIED: teacher_availability returns 0 for Parent, Student, and Anonymous.")

    # 2. Leak 2: schedule_students
    student1_res = next(r for r in results if r['Login'] == "Student 1")
    assert student1_res['schedule_students'] == 1, f"LEAK 2 FAILED: Student 1 saw {student1_res['schedule_students']} roster rows (Expected: 1, own row only)"
    print("[PASS] LEAK 2 VERIFIED: Student 1 in a class with classmates sees only their OWN 1 roster row.")

    parent1_res = next(r for r in results if r['Login'] == "Parent 1 (2 children)")
    assert parent1_res['schedule_students'] == 2, f"Parent 1 saw {parent1_res['schedule_students']} rows (Expected: 2 children)"
    print("[PASS] LEAK 2 VERIFIED: Parent 1 sees only their own children (2 rows), not classmate Student 3.")

    parent2_res = next(r for r in results if r['Login'] == "Parent 2 (1 child)")
    assert parent2_res['schedule_students'] == 2, f"Parent 2 saw {parent2_res['schedule_students']} rows (Expected: 2 slots for Student 3)"
    print("[PASS] LEAK 2 VERIFIED: Parent 2 sees only their child Student 3, not Student 1 or 2.")

    teacher1_res = next(r for r in results if r['Login'] == "Teacher 1")
    assert teacher1_res['schedule_students'] == 3, f"Teacher 1 saw {teacher1_res['schedule_students']} rows (Expected: 3, full roster of own slot)"
    print("[PASS] TEACHER VERIFIED: Teacher 1 sees full roster of own slot (3 rows).")

    # Locations verification
    admin_res = next(r for r in results if r['Login'] == "Admin")
    assert admin_res['locations'] >= 5, f"Admin must see all locations (got {admin_res['locations']})"
    for r in results:
        if r['Login'] in ("Parent 1 (2 children)", "Parent 2 (1 child)", "Student 1", "Teacher 1"):
            assert r['locations'] >= 5, f"{r['Login']} must be able to read locations (got {r['locations']})"
    print("[PASS] LOCATIONS READ VERIFIED: Admin, Teachers, Parents, and Students can read locations.")

    anon_res = next(r for r in results if r['Login'] == "Anonymous")
    for tbl in tables:
        assert anon_res[tbl] == 0, f"ANON LEAK FAILED: Anonymous saw {anon_res[tbl]} rows in {tbl} (Expected: 0)"
    print("[PASS] ANONYMOUS VERIFIED: Anonymous sees exactly 0 rows across every single table (including locations).")

    # 3. Test Parent Cannot Update or Delete Anything (including locations)
    print("\n--- VERIFYING PARENT CANNOT UPDATE OR DELETE ANYTHING ---")
    with conn.cursor() as cur:
        cur.execute("BEGIN;")
        cur.execute("SET LOCAL ROLE authenticated;")
        cur.execute("SELECT set_config('request.jwt.claim.sub', %s, true);", [user_ids[parent1_email]])
        cur.execute("SELECT set_config('request.jwt.claims', %s, true);", [json.dumps({"sub": user_ids[parent1_email], "email": parent1_email, "role": "authenticated"})])

        cur.execute("UPDATE public.schedules SET location = 'Hacked Room';")
        sched_updated = cur.rowcount

        cur.execute("DELETE FROM public.schedules;")
        sched_deleted = cur.rowcount

        cur.execute("UPDATE public.student_history SET title = 'Forged Title';")
        hist_updated = cur.rowcount

        cur.execute("DELETE FROM public.student_history;")
        hist_deleted = cur.rowcount

        cur.execute("UPDATE public.enrollments SET academic_grade = '12th Grade';")
        enr_updated = cur.rowcount

        cur.execute("DELETE FROM public.enrollments;")
        enr_deleted = cur.rowcount

        cur.execute("UPDATE public.locations SET name = 'Hacked Location';")
        loc_updated = cur.rowcount

        cur.execute("DELETE FROM public.locations;")
        loc_deleted = cur.rowcount

        cur.execute("ROLLBACK;")

    print(f"  Parent UPDATE schedules:        {sched_updated} rows affected (Expected: 0)")
    print(f"  Parent DELETE schedules:        {sched_deleted} rows affected (Expected: 0)")
    print(f"  Parent UPDATE student_history:  {hist_updated} rows affected (Expected: 0)")
    print(f"  Parent DELETE student_history:  {hist_deleted} rows affected (Expected: 0)")
    print(f"  Parent UPDATE enrollments:      {enr_updated} rows affected (Expected: 0)")
    print(f"  Parent DELETE enrollments:      {enr_deleted} rows affected (Expected: 0)")
    print(f"  Parent UPDATE locations:        {loc_updated} rows affected (Expected: 0)")
    print(f"  Parent DELETE locations:        {loc_deleted} rows affected (Expected: 0)")

    parent_blocked = (sched_updated == 0 and sched_deleted == 0 and hist_updated == 0 and hist_deleted == 0 and enr_updated == 0 and enr_deleted == 0 and loc_updated == 0 and loc_deleted == 0)
    assert parent_blocked, "Parent mutation security check failed!"
    print("[PASS] PARENT MUTATIONS: 100% BLOCKED across all tables including locations.")

    # 4. Check that no policy on any new table allows the anon role
    print("\n--- CHECKING POLICIES FOR THE ANON ROLE ---")
    new_tables = [
        "schedules", "schedule_students", "leads", "lead_interactions", "enrollments",
        "campaigns", "alert_logs", "tutoring_past_records", "afterschool_past_records",
        "teacher_availability", "student_enrollments", "locations"
    ]
    with conn.cursor() as cur:
        cur.execute("""
            SELECT tablename, policyname, roles, cmd, qual
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = ANY(%s);
        """, [new_tables])
        rows = cur.fetchall()
        for tablename, policyname, roles, cmd, qual in rows:
            # Verify 'anon' is not in roles
            if 'anon' in roles:
                raise AssertionError(f"Policy '{policyname}' on '{tablename}' explicitly includes 'anon' role!")
            # Also verify if roles is {public}, qual must not allow anon without role check
            if 'public' in roles and 'anon' in (qual or ''):
                raise AssertionError(f"Policy '{policyname}' on '{tablename}' grants anon access!")
    print(f"[PASS] NO POLICY ON ANY NEW TABLE ALLOWS THE ANON ROLE (Checked {len(rows)} policies across {len(new_tables)} tables).")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT tablename, policyname, roles, cmd, qual
            FROM pg_policies
            WHERE schemaname = 'public' AND tablename = ANY(%s);
        """, [new_tables])
        rows = cur.fetchall()
        for tablename, policyname, roles, cmd, qual in rows:
            # Verify 'anon' is not in roles
            if 'anon' in roles:
                raise AssertionError(f"Policy '{policyname}' on '{tablename}' explicitly includes 'anon' role!")
            # Also verify if roles is {public}, qual must not allow anon without role check
            if 'public' in roles and 'anon' in (qual or ''):
                raise AssertionError(f"Policy '{policyname}' on '{tablename}' grants anon access!")
    print(f"[PASS] NO POLICY ON ANY NEW TABLE ALLOWS THE ANON ROLE (Checked {len(rows)} policies across {len(new_tables)} tables).")

def main():
    print("============================================================")
    print("TASK 1d TEST HARNESS: LOCAL POSTGRES WITH SUPABASE-STYLE STUBS")
    print("============================================================")

    temp_dir = tempfile.mkdtemp(prefix="pgserver_task1d_")
    srv = pgserver.get_server(temp_dir)
    uri = srv.get_uri()
    print(f"PostgreSQL Server started at: {uri}\n")

    # ------------------------------------------------------------------------
    # PATH (a): Fresh Database where ONLY live migrations exist (NO 20260817, NO 20260910), then 20261015
    # ------------------------------------------------------------------------
    print("================================================================================")
    print("TESTING PATH (a): FRESH DATABASE WITHOUT 20260817 & 20260910, THEN 20261015")
    print("================================================================================")
    with psycopg.connect(uri, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE DATABASE db_path_a;")

    conn_a = psycopg.connect(uri, dbname="db_path_a", autocommit=False)
    try:
        # Auth stubs
        with conn_a.cursor() as cur:
            cur.execute(AUTH_STUBS)
        conn_a.commit()

        path_a_files = get_path_a_migration_files()
        print(f"Path (a) migration sequence ({len(path_a_files)} migrations):")
        for f in path_a_files:
            print(f"  - {os.path.basename(f)}")

        # Pass 1
        run_migration_list(conn_a, path_a_files, 1, "PATH (a)")
        # Pass 2 (idempotency)
        run_migration_list(conn_a, path_a_files, 2, "PATH (a)")
        print("\nPATH (a) RESULT: 100% IDEMPOTENT & ZERO ERRORS BOTH PASSES.")
    finally:
        conn_a.close()

    # ------------------------------------------------------------------------
    # PATH (b): Fresh Database with EVERY migration applied in order (1 to 11)
    # ------------------------------------------------------------------------
    print("\n================================================================================")
    print("TESTING PATH (b): FRESH DATABASE WITH EVERY MIGRATION IN ORDER (1 to 11)")
    print("================================================================================")
    with psycopg.connect(uri, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE DATABASE db_path_b;")

    conn_b = psycopg.connect(uri, dbname="db_path_b", autocommit=False)
    try:
        # Auth stubs
        with conn_b.cursor() as cur:
            cur.execute(AUTH_STUBS)
        conn_b.commit()

        path_b_files = get_all_migration_files()
        print(f"Path (b) migration sequence ({len(path_b_files)} migrations):")
        for f in path_b_files:
            print(f"  - {os.path.basename(f)}")

        # Pass 1
        run_migration_list(conn_b, path_b_files, 1, "PATH (b)")
        # Pass 2 (idempotency)
        run_migration_list(conn_b, path_b_files, 2, "PATH (b)")
        print("\nPATH (b) RESULT: 100% IDEMPOTENT & ZERO ERRORS BOTH PASSES.")

        # Test RLS Matrix, Fixtures & Leak Fixes on DB Path B
        test_rls_matrix_and_fixtures(conn_b)

        # Print the connection URI for the Direct SQL test of migrate:schedules
        path_b_uri = srv.get_uri("db_path_b")
        print("\n============================================================")
        print(f"PATH (B) DB READY FOR migrate:schedules DIRECT SQL TEST:")
        print(f"DATABASE_URL={path_b_uri}")
        print("============================================================")

    finally:
        conn_b.close()

if __name__ == "__main__":
    main()
