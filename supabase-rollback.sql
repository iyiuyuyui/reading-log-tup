-- =====================================================
-- ระบบบันทึกรักการอ่าน | Supabase Migration Rollback Script
-- =====================================================
-- WARNING: Executing this script will permanently delete all Supabase migration schema
-- and records. Ensure you have backed up any vital data before running.

-- ─────────────────────────────────────────────────────
-- 1. DROP REALTIME REPLICATION CONFIGS
-- ─────────────────────────────────────────────────────
DROP PUBLICATION IF EXISTS supabase_realtime;

-- ─────────────────────────────────────────────────────
-- 2. DROP TRIGGERS ON TABLES
-- ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sync_student_totals ON reading_reports;
DROP TRIGGER IF EXISTS audit_reports ON reading_reports;
DROP TRIGGER IF EXISTS audit_students ON students;
DROP TRIGGER IF EXISTS audit_announcements ON announcements;

-- ─────────────────────────────────────────────────────
-- 3. DROP MATERIALIZED VIEWS & INDEXES
-- ─────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_mv_classroom;
DROP MATERIALIZED VIEW IF EXISTS mv_classroom_stats;

-- ─────────────────────────────────────────────────────
-- 4. DROP AUDIT LOGS AND HELPER TABLES
-- ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS activity_logs CASCADE;
DROP TABLE IF EXISTS pending_registrations CASCADE;

-- ─────────────────────────────────────────────────────
-- 5. DROP BUSINESS TRANSACTION LOGS & PROFILES
-- ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS reading_reports CASCADE;
DROP TABLE IF EXISTS students CASCADE;
DROP TABLE IF EXISTS students_auth_map CASCADE;
DROP TABLE IF EXISTS teachers CASCADE;
DROP TABLE IF EXISTS announcements CASCADE;

-- ─────────────────────────────────────────────────────
-- 6. DROP SETTINGS AND CONFIGURATIONS
-- ─────────────────────────────────────────────────────
DROP TABLE IF EXISTS telegram_configs CASCADE;
DROP TABLE IF EXISTS school_settings CASCADE;
DROP TABLE IF EXISTS academic_years CASCADE;

-- ─────────────────────────────────────────────────────
-- 7. DROP SCHEMA METADATA ENUMS
-- ─────────────────────────────────────────────────────
DROP TYPE IF EXISTS user_role CASCADE;

-- ─────────────────────────────────────────────────────
-- 8. DROP SERVER FUNCTIONS AND PROCEDURES
-- ─────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS fn_sync_student_reading_totals() CASCADE;
DROP FUNCTION IF EXISTS fn_audit_record_mutations() CASCADE;
DROP FUNCTION IF EXISTS refresh_classroom_stats() CASCADE;
DROP FUNCTION IF EXISTS auth_user_role() CASCADE;
DROP FUNCTION IF EXISTS auth_user_code() CASCADE;
DROP FUNCTION IF EXISTS activate_student_account(VARCHAR, VARCHAR, VARCHAR) CASCADE;

-- ─────────────────────────────────────────────────────
-- 9. MIGRATION RECOVERY COMPLETION NOTICE
-- ─────────────────────────────────────────────────────
-- The database has been rolled back to pre-migration status.
-- You can now re-enable legacy Firestore/Firebase configs.
