-- ============================================================
-- supabase-global-passcode.sql
-- Run this once in Supabase Dashboard > SQL Editor
-- ============================================================
-- Creates app_settings table for school-wide configuration
-- and inserts the global student activation passcode (TUPREAD)
-- ============================================================

-- 1. Create app_settings table if not exists
CREATE TABLE IF NOT EXISTS public.app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Enable RLS
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- 3. Policy: allow service role (edge functions) to read/write
CREATE POLICY "Service role can manage app_settings"
    ON public.app_settings
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. Policy: authenticated users (admin/teacher) can read settings
CREATE POLICY "Authenticated users can read app_settings"
    ON public.app_settings
    FOR SELECT
    TO authenticated
    USING (true);

-- 5. Insert the global activation passcode
-- Change 'TUPREAD' to any passcode you want (case-insensitive matching)
INSERT INTO public.app_settings (key, value, description)
VALUES (
    'global_activation_passcode',
    'TUPREAD',
    'รหัสเปิดใช้งานบัญชีสำหรับนักเรียนทุกคน (ถาวร ไม่หมดอายุ)'
)
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value,
        description = EXCLUDED.description,
        updated_at = NOW();

-- Verify the insert
SELECT key, value, description FROM public.app_settings WHERE key = 'global_activation_passcode';
