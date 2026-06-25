-- =========================================================================
-- SQL migration to enable student credentials management by teachers.
-- Run this script in the Supabase SQL Editor (https://supabase.com/dashboard)
-- =========================================================================

-- 1. Ensure pgcrypto extension is enabled (required for digest and crypt)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Add plain_passcode column to pending_registrations if it doesn't exist
ALTER TABLE public.pending_registrations ADD COLUMN IF NOT EXISTS plain_passcode TEXT;

-- 3. Update RLS policies on pending_registrations to allow teachers and admins
DROP POLICY IF EXISTS "pending_registrations_admin" ON public.pending_registrations;
DROP POLICY IF EXISTS "pending_registrations_teacher_admin" ON public.pending_registrations;

CREATE POLICY "pending_registrations_teacher_admin" ON public.pending_registrations 
FOR ALL TO authenticated 
USING (
    auth_user_role() IN ('teacher', 'admin')
);

-- 4. Create RPC function to set/regenerate student passcode
CREATE OR REPLACE FUNCTION set_student_passcode_admin(p_student_id VARCHAR, p_passcode VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    v_first_name VARCHAR(100);
    v_last_name VARCHAR(100);
    v_hash VARCHAR(64);
BEGIN
    -- Security Check: Only teachers and admins are allowed
    IF auth_user_role() NOT IN ('teacher', 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only teachers and admins can set student passcodes.';
    END IF;

    -- Fetch student details from students table
    SELECT first_name, last_name INTO v_first_name, v_last_name 
    FROM public.students 
    WHERE student_id = p_student_id 
    LIMIT 1;

    IF v_first_name IS NULL THEN
        RAISE EXCEPTION 'Student not found in students table.';
    END IF;

    -- Calculate SHA-256 hash of passcode using pgcrypto digest
    v_hash := encode(digest(p_passcode, 'sha256'), 'hex');

    -- Upsert pending_registrations
    INSERT INTO public.pending_registrations (student_id, passcode_hash, plain_passcode, first_name, last_name)
    VALUES (p_student_id, v_hash, p_passcode, v_first_name, v_last_name)
    ON CONFLICT (student_id) DO UPDATE 
    SET passcode_hash = EXCLUDED.passcode_hash,
        plain_passcode = EXCLUDED.plain_passcode,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Create RPC function to reset student password
CREATE OR REPLACE FUNCTION reset_student_password_admin(p_student_id VARCHAR, p_new_password VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    v_auth_id UUID;
BEGIN
    -- Security Check: Only teachers and admins are allowed
    IF auth_user_role() NOT IN ('teacher', 'admin') THEN
        RAISE EXCEPTION 'Unauthorized: Only teachers and admins can reset student passwords.';
    END IF;

    -- Find the student's auth_id from auth map
    SELECT auth_id INTO v_auth_id FROM public.students_auth_map WHERE student_id = p_student_id;

    IF v_auth_id IS NULL THEN
        -- The student is not yet activated/registered in auth.users
        RETURN FALSE;
    END IF;

    -- Update auth.users password using bcrypt hash
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = v_auth_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Add is_active column to teachers table if it doesn't exist
ALTER TABLE public.teachers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 7. Create RPC function to reset teacher password by admin
CREATE OR REPLACE FUNCTION reset_teacher_password_admin(p_teacher_code VARCHAR, p_new_password VARCHAR)
RETURNS BOOLEAN AS $$
DECLARE
    v_auth_id UUID;
BEGIN
    -- Security Check: Only admins can reset teacher passwords
    IF auth_user_role() != 'admin' THEN
        RAISE EXCEPTION 'Unauthorized: Only admins can reset teacher passwords.';
    END IF;

    -- Find the teacher's auth_id
    SELECT id INTO v_auth_id FROM public.teachers WHERE code = p_teacher_code;

    IF v_auth_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Update auth.users password using bcrypt hash
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf', 10)),
        updated_at = now()
    WHERE id = v_auth_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Create trigger to automatically delete auth.users when a teacher is deleted from public.teachers
CREATE OR REPLACE FUNCTION delete_auth_user_on_teacher_delete()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM auth.users WHERE id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_delete_teacher_auth ON public.teachers;
CREATE TRIGGER tr_delete_teacher_auth
AFTER DELETE ON public.teachers
FOR EACH ROW
EXECUTE FUNCTION delete_auth_user_on_teacher_delete();

-- 9. Ensure the bucket 'reading-attachments' exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('reading-attachments', 'reading-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 10. Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- 11. Create Policy to allow authenticated users to upload (INSERT) files to 'reading-attachments'
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
CREATE POLICY "Allow authenticated uploads" ON storage.objects 
FOR INSERT TO authenticated 
WITH CHECK (
    bucket_id = 'reading-attachments'
);

-- 12. Create Policy to allow authenticated users to read/retrieve (SELECT) files
DROP POLICY IF EXISTS "Allow authenticated selects" ON storage.objects;
CREATE POLICY "Allow authenticated selects" ON storage.objects 
FOR SELECT TO authenticated 
USING (
    bucket_id = 'reading-attachments'
);

-- 13. Create Policy to allow owners to update/delete their files
DROP POLICY IF EXISTS "Allow owners to update delete" ON storage.objects;
CREATE POLICY "Allow owners to update delete" ON storage.objects 
FOR ALL TO authenticated 
USING (
    bucket_id = 'reading-attachments' AND owner = auth.uid()
)
WITH CHECK (
    bucket_id = 'reading-attachments' AND owner = auth.uid()
);


