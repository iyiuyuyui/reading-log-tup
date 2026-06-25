-- =====================================================
-- ระบบบันทึกรักการอ่าน | Upgraded Production PostgreSQL Schema
-- =====================================================

-- ─────────────────────────────────────────────────────
-- 0. USER ROLES & SCHEMAS
-- ─────────────────────────────────────────────────────
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'teacher', 'admin');
    END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- 1. ACADEMIC YEARS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academic_years (
    year_name    VARCHAR(10) PRIMARY KEY,        -- e.g. '2568'
    display_name VARCHAR(100) NOT NULL,          -- e.g. 'ปีการศึกษา 2568'
    is_active    BOOLEAN DEFAULT true,
    is_default   BOOLEAN DEFAULT false,
    created_at   TIMESTAMPTZ DEFAULT now(),
    updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 2. MASTER STUDENTS AUTH MAP (auth.users 1:1)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students_auth_map (
    auth_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    student_id   VARCHAR(10) UNIQUE NOT NULL,    -- Permanent school ID e.g. '36113'
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 3. STUDENTS YEARLY PROFILE (Normalized)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS students (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_id            UUID REFERENCES students_auth_map(auth_id) ON DELETE CASCADE,
    student_id         VARCHAR(10) NOT NULL,
    prefix             VARCHAR(20),
    first_name         VARCHAR(100) NOT NULL,
    last_name          VARCHAR(100) NOT NULL,
    level              VARCHAR(10) NOT NULL,     -- e.g. 'ม.1'
    room               SMALLINT NOT NULL,
    number             SMALLINT,
    academic_year      VARCHAR(10) NOT NULL REFERENCES academic_years(year_name) ON UPDATE CASCADE,
    total_books        INTEGER DEFAULT 0 CHECK (total_books >= 0),
    total_pages        INTEGER DEFAULT 0 CHECK (total_pages >= 0),
    total_reading_time INTEGER DEFAULT 0 CHECK (total_reading_time >= 0),
    total_score        NUMERIC(6,2) DEFAULT 0 CHECK (total_score >= 0),
    source_file        VARCHAR(255),
    dataset_id         VARCHAR(50),
    import_date        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now(),
    UNIQUE (auth_id, academic_year),
    UNIQUE (student_id, academic_year)
);

-- ─────────────────────────────────────────────────────
-- 4. TEACHERS (auth.users 1:1)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teachers (
    id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    code                VARCHAR(20) UNIQUE NOT NULL,   -- e.g. 'THTUPPT01'
    name                VARCHAR(200) NOT NULL,
    assigned_level      VARCHAR(10) NOT NULL,          -- e.g. 'ม.1'
    assigned_grades     TEXT[] DEFAULT '{}',           -- Array of grades e.g. '{"ม.1", "ม.2"}'
    assigned_classrooms TEXT[] DEFAULT '{}',           -- Array of classrooms e.g. '{"ม.1/1", "ม.1/2"}'
    role                user_role DEFAULT 'teacher'::user_role,
    created_at          TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 5. READING REPORTS (Referencing student profile UUID)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reading_reports (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_profile_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    student_id         VARCHAR(10) NOT NULL,           -- Kept for querying convenience
    academic_year      VARCHAR(10) NOT NULL REFERENCES academic_years(year_name) ON UPDATE CASCADE,
    student_level      VARCHAR(10) NOT NULL,
    student_room       SMALLINT NOT NULL,
    entry_number       INTEGER NOT NULL CHECK (entry_number > 0),
    read_date          DATE NOT NULL,
    book_title         VARCHAR(500) NOT NULL,
    author             VARCHAR(300),
    publisher          VARCHAR(300),
    book_type          VARCHAR(100),
    page_count         INTEGER DEFAULT 0 CHECK (page_count >= 0),
    reading_time       INTEGER DEFAULT 0 CHECK (reading_time >= 0),
    summary            TEXT,
    lesson             TEXT,
    application        TEXT,
    reason             TEXT,
    new_vocabulary     TEXT,
    attachment_url     TEXT,
    status             VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    score              NUMERIC(5,2) DEFAULT 0 CHECK (score BETWEEN 0 AND 10),
    stars              SMALLINT DEFAULT 0 CHECK (stars BETWEEN 0 AND 5),
    teacher_comment    TEXT,
    reviewed_by        UUID REFERENCES teachers(id) ON DELETE SET NULL,
    reviewed_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ DEFAULT now(),
    updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 6. SCHOOL SETTINGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS school_settings (
    key        VARCHAR(100) PRIMARY KEY,
    value      TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 7. TELEGRAM CONFIGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_configs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level_key   VARCHAR(10) UNIQUE NOT NULL,   -- 'M1', 'M2', ..., 'M6'
    bot_token   TEXT,
    chat_id     TEXT,
    updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 8. ANNOUNCEMENTS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS announcements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        VARCHAR(500) NOT NULL,
    content      TEXT NOT NULL,
    author_code  VARCHAR(20),
    author_name  VARCHAR(200),
    author_level VARCHAR(10),
    is_active    BOOLEAN DEFAULT true,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 9. COMPLIANCE AUDIT LOGS
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action_type   VARCHAR(20) NOT NULL,          -- INSERT, UPDATE, DELETE
    table_name    VARCHAR(100) NOT NULL,
    record_id     UUID NOT NULL,
    old_data      JSONB,
    new_data      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 10. PENDING ACTIVATIONS (Onboarding passcodes)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pending_registrations (
    student_id      VARCHAR(10) PRIMARY KEY,
    passcode_hash   VARCHAR(64) NOT NULL,        -- SHA-256 hash
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- ─────────────────────────────────────────────────────
-- 11. ACTIVITY LOGS (Client-side actions)
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action       VARCHAR(100) NOT NULL,
    details      TEXT,
    performed_by VARCHAR(200) NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE OPTIMIZATION
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_auth_map_student ON students_auth_map(student_id);
CREATE INDEX IF NOT EXISTS idx_reports_by_profile ON reading_reports(student_profile_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_pending_queue 
ON reading_reports(academic_year, status) 
WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_students_lookup_annual ON students(student_id, academic_year);

-- =====================================================
-- SYSTEM MATERIALIZED VIEWS & AGGREGATIONS
-- =====================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_classroom_stats AS
SELECT 
    academic_year,
    level,
    room,
    COUNT(id) AS total_students,
    SUM(total_books) AS aggregated_books,
    SUM(total_pages) AS aggregated_pages,
    ROUND(AVG(total_score), 2) AS average_score
FROM students
GROUP BY academic_year, level, room;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_classroom ON mv_classroom_stats(academic_year, level, room);

-- =====================================================
-- HELPER FUNCTIONS FOR SECURITY & TRANSACTIONS
-- =====================================================

-- 1. Get current user's role from JWT claims
CREATE OR REPLACE FUNCTION auth_user_role() 
RETURNS user_role AS $$
  SELECT COALESCE((auth.jwt() -> 'user_metadata' ->> 'role')::user_role, 'student'::user_role);
$$ LANGUAGE sql SECURITY DEFINER;

-- 2. Get current user's student ID or teacher code from JWT email prefix
CREATE OR REPLACE FUNCTION auth_user_code() 
RETURNS VARCHAR AS $$
  SELECT split_part(auth.jwt() ->> 'email', '@', 1);
$$ LANGUAGE sql SECURITY DEFINER;

-- 3. Materialized View refresh function
CREATE OR REPLACE FUNCTION refresh_classroom_stats() 
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_classroom_stats;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- DATABASE TRIGGERS
-- =====================================================

-- 1. Student Reading Aggregations (Recalculate stats on approved reports)
CREATE OR REPLACE FUNCTION fn_sync_student_reading_totals()
RETURNS TRIGGER AS $$
DECLARE
    v_profile_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_profile_id := OLD.student_profile_id;
    ELSE
        v_profile_id := NEW.student_profile_id;
    END IF;

    UPDATE students
    SET 
        total_books = (
            SELECT COUNT(*)::INTEGER 
            FROM reading_reports 
            WHERE student_profile_id = v_profile_id AND status = 'approved'
        ),
        total_pages = (
            SELECT COALESCE(SUM(page_count), 0)::INTEGER 
            FROM reading_reports 
            WHERE student_profile_id = v_profile_id AND status = 'approved'
        ),
        total_reading_time = (
            SELECT COALESCE(SUM(reading_time), 0)::INTEGER 
            FROM reading_reports 
            WHERE student_profile_id = v_profile_id AND status = 'approved'
        ),
        total_score = (
            SELECT COALESCE(SUM(score), 0)::NUMERIC(6,2)
            FROM reading_reports 
            WHERE student_profile_id = v_profile_id AND status = 'approved'
        ),
        updated_at = now()
    WHERE id = v_profile_id;

    -- Concurrently refresh cached reports summary view
    PERFORM refresh_classroom_stats();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_student_totals ON reading_reports;
CREATE TRIGGER trg_sync_student_totals
AFTER INSERT OR UPDATE OR DELETE ON reading_reports
FOR EACH ROW EXECUTE FUNCTION fn_sync_student_reading_totals();


-- 2. Audit Trail Logger
CREATE OR REPLACE FUNCTION fn_audit_record_mutations()
RETURNS TRIGGER AS $$
DECLARE
    v_old JSONB := NULL;
    v_new JSONB := NULL;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'INSERT' THEN
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_old := to_jsonb(OLD);
    END IF;

    INSERT INTO audit_logs (
        user_id,
        action_type,
        table_name,
        record_id,
        old_data,
        new_data
    ) VALUES (
        auth.uid(),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id, OLD.id),
        v_old,
        v_new
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS audit_reports ON reading_reports;
CREATE TRIGGER audit_reports
AFTER INSERT OR UPDATE OR DELETE ON reading_reports
FOR EACH ROW EXECUTE FUNCTION fn_audit_record_mutations();

DROP TRIGGER IF EXISTS audit_students ON students;
CREATE TRIGGER audit_students
AFTER INSERT OR UPDATE OR DELETE ON students
FOR EACH ROW EXECUTE FUNCTION fn_audit_record_mutations();


-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telegram_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_registrations ENABLE ROW LEVEL SECURITY;

-- 1. Academic Years Policies
DROP POLICY IF EXISTS "years_select" ON academic_years;
DROP POLICY IF EXISTS "years_admin" ON academic_years;
CREATE POLICY "years_select" ON academic_years FOR SELECT USING (true);
CREATE POLICY "years_admin" ON academic_years FOR ALL TO authenticated USING (auth_user_role() = 'admin');

-- 2. Students Profiles Policies
DROP POLICY IF EXISTS "students_select" ON students;
DROP POLICY IF EXISTS "students_admin" ON students;
CREATE POLICY "students_select" ON students FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "students_admin" ON students FOR ALL TO authenticated USING (auth_user_role() = 'admin');

-- 3. Teachers Profiles Policies
DROP POLICY IF EXISTS "teachers_select" ON teachers;
DROP POLICY IF EXISTS "teachers_admin" ON teachers;
CREATE POLICY "teachers_select" ON teachers FOR SELECT TO authenticated USING (true);
CREATE POLICY "teachers_admin" ON teachers FOR ALL TO authenticated USING (auth_user_role() = 'admin');

-- 4. Reading Reports Policies
DROP POLICY IF EXISTS "reports_select" ON reading_reports;
DROP POLICY IF EXISTS "reports_insert" ON reading_reports;
DROP POLICY IF EXISTS "reports_update" ON reading_reports;
DROP POLICY IF EXISTS "reports_delete" ON reading_reports;
CREATE POLICY "reports_select" ON reading_reports FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "reports_insert" ON reading_reports FOR INSERT TO authenticated WITH CHECK (
    auth_user_role() = 'student' AND LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "reports_update" ON reading_reports FOR UPDATE TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR 
    (auth_user_role() = 'student' AND LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id)) AND status = 'pending')
);
CREATE POLICY "reports_delete" ON reading_reports FOR DELETE TO authenticated USING (
    auth_user_role() = 'admin'
);

-- 5. School Settings Policies (Only teachers/admins read key values, only admins write)
DROP POLICY IF EXISTS "settings_select" ON school_settings;
DROP POLICY IF EXISTS "settings_admin" ON school_settings;
CREATE POLICY "settings_select" ON school_settings FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin')
);
CREATE POLICY "settings_admin" ON school_settings FOR ALL TO authenticated USING (
    auth_user_role() = 'admin'
);

-- 6. Telegram Configs Policies (Only admins read/write)
DROP POLICY IF EXISTS "telegram_all" ON telegram_configs;
CREATE POLICY "telegram_all" ON telegram_configs FOR ALL TO authenticated USING (
    auth_user_role() = 'admin'
);

-- 7. Announcements Policies (Public read, teachers/admins write)
DROP POLICY IF EXISTS "announcements_select" ON announcements;
DROP POLICY IF EXISTS "announcements_write" ON announcements;
CREATE POLICY "announcements_select" ON announcements FOR SELECT USING (true);
CREATE POLICY "announcements_write" ON announcements FOR ALL TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin')
);

-- 8. Audit Logs Policies (Only admins read, system writes)
DROP POLICY IF EXISTS "audit_select" ON audit_logs;
CREATE POLICY "audit_select" ON audit_logs FOR SELECT TO authenticated USING (
    auth_user_role() = 'admin'
);

-- 9. Activity Logs Policies (Only teachers/admins read, anyone authenticated writes)
DROP POLICY IF EXISTS "activity_logs_insert" ON activity_logs;
DROP POLICY IF EXISTS "activity_logs_select" ON activity_logs;
CREATE POLICY "activity_logs_insert" ON activity_logs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "activity_logs_select" ON activity_logs FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin')
);

-- 10. Pending Registrations Policies (Only admins)
DROP POLICY IF EXISTS "pending_registrations_admin" ON pending_registrations;
CREATE POLICY "pending_registrations_admin" ON pending_registrations FOR ALL TO authenticated USING (
    auth_user_role() = 'admin'
);

-- =====================================================
-- REALTIME WAL REPLICATION PUBLICATION
-- =====================================================
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime;
ALTER PUBLICATION supabase_realtime ADD TABLE reading_reports;
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;

-- =====================================================
-- SEED DATA
-- =====================================================

-- Default Academic Year
INSERT INTO academic_years (year_name, display_name, is_active, is_default)
VALUES ('2568', 'ปีการศึกษา 2568', true, true)
ON CONFLICT (year_name) DO NOTHING;

-- Config Settings
INSERT INTO school_settings (key, value) VALUES
    ('admin_code',    'THTUPPT'),
    ('imgbb_api_key', '687acb6098a4ae2c2d69dff4d42c3d6c')
ON CONFLICT (key) DO NOTHING;

-- Provision Default Admin Account (Password: THTUPPT)
-- Note: Uses standard bcrypt hashing via gen_salt to securely register the account directly in Supabase Auth.
DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Check if user already exists
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'admin@readinglog.tup';

    IF v_user_id IS NULL THEN
        -- Insert new admin user
        INSERT INTO auth.users (
            instance_id,
            id,
            aud,
            role,
            email,
            encrypted_password,
            email_confirmed_at,
            raw_app_meta_data,
            raw_user_meta_data,
            created_at,
            updated_at
        )
        VALUES (
            '00000000-0000-0000-0000-000000000000',
            gen_random_uuid(),
            'authenticated',
            'authenticated',
            'admin@readinglog.tup',
            crypt('THTUPPT', gen_salt('bf', 10)),
            now(),
            '{"provider":"email","providers":["email"]}'::jsonb,
            '{"role":"admin"}'::jsonb,
            now(),
            now()
        );
    ELSE
        -- Update existing user metadata to ensure role is admin
        UPDATE auth.users
        SET raw_user_meta_data = jsonb_build_object('role', 'admin')
        WHERE id = v_user_id;
    END IF;
END $$;
