// Placeholder for Firebase configuration
// IMPORTANT: Replace with your actual Firebase project config

const firebaseConfig = {
    apiKey: "AIzaSyDkCDaYtOnsRy1LGv2qwtUytnRSj7iksjE",
    authDomain: "reading-log-tup.firebaseapp.com",
    projectId: "reading-log-tup",
    storageBucket: "reading-log-tup.firebasestorage.app",
    messagingSenderId: "934681668339",
    appId: "1:934681668339:web:a6706d71a0703e75b12586",
    measurementId: "G-RJKYTCM0YD"
};

// Initialize Firebase (Assuming CDN script is included in HTML)
if (typeof firebase !== 'undefined') {
    try {
        firebase.initializeApp(firebaseConfig);
        
        // Initialize services safely checking function existence
        if (typeof firebase.firestore === 'function') {
            window.db = firebase.firestore();
        } else {
            console.warn("Firebase Firestore compat SDK not loaded.");
        }
        
        if (typeof firebase.storage === 'function') {
            window.storage = firebase.storage();
        } else {
            console.warn("Firebase Storage compat SDK not loaded.");
        }
        
        console.log("Firebase initialized successfully.");
    } catch (e) {
        console.error("Firebase initialization error:", e);
    }
} else {
    console.warn("Firebase SDK not found. Make sure to include the CDN scripts.");
}

// ── Global Academic-Year State ────────────────────────────────
window.currentAcademicYear   = null;   // e.g. '2568'
window.currentAcademicYearId = null;   // Document ID

/**
 * Load the default academic year from Firestore.
 */
async function initAcademicYear() {
    try {
        if (!window.db) {
            window.currentAcademicYear = '2568';
            return '2568';
        }
        
        // 1. Check globally selected year from system_settings/current
        const sysDoc = await window.db.collection('system_settings').doc('current').get();
        if (sysDoc.exists && sysDoc.data().defaultAcademicYear) {
            window.currentAcademicYear = sysDoc.data().defaultAcademicYear;
            // Find corresponding ID in academic_years
            const yearSnap = await window.db.collection('academic_years')
                .where('year', '==', window.currentAcademicYear)
                .where('isActive', '==', true)
                .limit(1)
                .get();
            if (!yearSnap.empty) {
                window.currentAcademicYearId = yearSnap.docs[0].id;
            }
        } else {
            // 2. Fallback to schoolSettings/config
            const configDoc = await window.db.collection('schoolSettings').doc('config').get();
            if (configDoc.exists && configDoc.data().currentAcademicYear) {
                window.currentAcademicYear = configDoc.data().currentAcademicYear;
            } else {
                // 3. Fallback to academic_years where isDefault is true
                const defaultSnap = await window.db.collection('academic_years')
                    .where('isDefault', '==', true)
                    .where('isActive', '==', true)
                    .limit(1)
                    .get();
                if (!defaultSnap.empty) {
                    const data = defaultSnap.docs[0].data();
                    window.currentAcademicYear = data.year;
                    window.currentAcademicYearId = defaultSnap.docs[0].id;
                } else {
                    window.currentAcademicYear = '2568';
                }
            }
        }
    } catch (err) {
        console.warn('initAcademicYear fallback:', err);
        window.currentAcademicYear = '2568';
    }

    sessionStorage.setItem('currentAcademicYear',   window.currentAcademicYear   || '');
    sessionStorage.setItem('currentAcademicYearId', window.currentAcademicYearId || '');
    return window.currentAcademicYear;
}

/**
 * Restore academic year from session storage.
 */
function restoreAcademicYearFromSession() {
    const y  = sessionStorage.getItem('currentAcademicYear');
    const id = sessionStorage.getItem('currentAcademicYearId');
    if (y) {
        window.currentAcademicYear   = y;
        window.currentAcademicYearId = id || null;
    }
}

// ── Helper: get current year ──────────────────────────
function getActiveYear() {
    return window.currentAcademicYear
        || sessionStorage.getItem('currentAcademicYear')
        || '2568';
}

// Expose helpers
window.initAcademicYear              = initAcademicYear;
window.restoreAcademicYearFromSession = restoreAcademicYearFromSession;
window.getActiveYear                 = getActiveYear;

