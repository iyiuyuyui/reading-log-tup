/**
 * supabase-config.js
 * ─────────────────────────────────────────────────────────────
 * Initializes the Supabase client and exposes it as window.db
 * and window.supabaseClient.
 *
 * ⚠️  REPLACE the two placeholder values below with your own
 *     project credentials from:
 *     Supabase Dashboard → Settings → API
 * ─────────────────────────────────────────────────────────────
 */

const SUPABASE_URL      = 'https://hvatiafejlzprzievfxe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh2YXRpYWZlamx6cHJ6aWV2ZnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIxMzI2MTUsImV4cCI6MjA5NzcwODYxNX0.Z6c4anoFgQ8--53qZLco_SFMTw9nCNqN_eKpJFj1hlA';

// ── Client Initialisation ─────────────────────────────────────
const { createClient } = supabase;

window.supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: {
        params: { eventsPerSecond: 10 }
    }
});

// Convenience alias used throughout the app
window.db = window.supabaseClient;

// ── Global Academic-Year State ────────────────────────────────
window.currentAcademicYear   = null;   // e.g. '2568'
window.currentAcademicYearId = null;   // UUID

/**
 * Load the default academic year from Supabase.
 * Falls back to '2568' when offline / table empty.
 */
async function initAcademicYear() {
    try {
        const { data, error } = await window.supabaseClient
            .from('academic_years')
            .select('year_name')
            .eq('is_default', true)
            .eq('is_active', true)
            .single();

        if (data) {
            window.currentAcademicYear   = data.year_name;
            window.currentAcademicYearId = data.year_name;
        } else {
            // Fallback: pick the most recent active year
            const { data: latest } = await window.supabaseClient
                .from('academic_years')
                .select('year_name')
                .eq('is_active', true)
                .order('year_name', { ascending: false })
                .limit(1)
                .single();

            if (latest) {
                window.currentAcademicYear   = latest.year_name;
                window.currentAcademicYearId = latest.year_name;
            } else {
                window.currentAcademicYear = '2568';
            }
        }
    } catch (err) {
        console.warn('initAcademicYear fallback:', err);
        window.currentAcademicYear = '2568';
    }

    // Persist to session storage so pages that reload remember it
    sessionStorage.setItem('currentAcademicYear',   window.currentAcademicYear   || '');
    sessionStorage.setItem('currentAcademicYearId', window.currentAcademicYearId || '');
    return window.currentAcademicYear;
}

/**
 * Restore academic year from session storage (fast, no network).
 * Always call initAcademicYear() once on first page load.
 */
function restoreAcademicYearFromSession() {
    const y  = sessionStorage.getItem('currentAcademicYear');
    const id = sessionStorage.getItem('currentAcademicYearId');
    if (y) {
        window.currentAcademicYear   = y;
        window.currentAcademicYearId = id || null;
    }
}

// ── Helper: get current year (with session fallback) ──────────
function getActiveYear() {
    return window.currentAcademicYear
        || sessionStorage.getItem('currentAcademicYear')
        || '2568';
}

// Expose helpers
window.initAcademicYear              = initAcademicYear;
window.restoreAcademicYearFromSession = restoreAcademicYearFromSession;
window.getActiveYear                 = getActiveYear;
