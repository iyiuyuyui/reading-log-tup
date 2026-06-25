-- =========================================================================
-- SQL script to fix RLS Policies on reading_reports and students tables.
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard)
-- to resolve the "new row violates row-level security policy" error.
-- =========================================================================

-- 1. Refresh & Recreate policies on the public.students table
DROP POLICY IF EXISTS "students_select" ON public.students;
DROP POLICY IF EXISTS "students_admin" ON public.students;

CREATE POLICY "students_select" ON public.students FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "students_admin" ON public.students FOR ALL TO authenticated USING (auth_user_role() = 'admin');

-- 2. Refresh & Recreate policies on the public.reading_reports table
DROP POLICY IF EXISTS "reports_select" ON public.reading_reports;
DROP POLICY IF EXISTS "reports_insert" ON public.reading_reports;
DROP POLICY IF EXISTS "reports_update" ON public.reading_reports;
DROP POLICY IF EXISTS "reports_delete" ON public.reading_reports;

CREATE POLICY "reports_select" ON public.reading_reports FOR SELECT TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "reports_insert" ON public.reading_reports FOR INSERT TO authenticated WITH CHECK (
    auth_user_role() = 'student' AND LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id))
);
CREATE POLICY "reports_update" ON public.reading_reports FOR UPDATE TO authenticated USING (
    auth_user_role() IN ('teacher', 'admin') OR 
    (auth_user_role() = 'student' AND LOWER(TRIM(auth_user_code())) = LOWER(TRIM(student_id)) AND status = 'pending')
);
CREATE POLICY "reports_delete" ON public.reading_reports FOR DELETE TO authenticated USING (
    auth_user_role() = 'admin'
);
