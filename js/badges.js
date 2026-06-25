/**
 * badges.js — Gamification / badge system (Supabase edition)
 */

const BADGES_CRITERIA = [
    { id: 'new_reader',       name: 'นักอ่านหน้าใหม่', emoji: '📚', desc: 'บันทึกหนังสือเล่มแรกที่ผ่านการอนุมัติ', threshold: 1  },
    { id: 'good_reader',      name: 'นักอ่านดีเด่น',   emoji: '📖', desc: 'อ่านสะสมครบ 5 เล่ม',                  threshold: 5  },
    { id: 'gold_reader',      name: 'นักอ่านทองคำ',     emoji: '🏆', desc: 'อ่านสะสมครบ 15 เล่ม',                threshold: 15 },
    { id: 'excellent_reader', name: 'นักอ่านยอดเยี่ยม', emoji: '👑', desc: 'อ่านสะสมครบ 30 เล่ม',                threshold: 30 }
];

async function loadBadges(studentId, academicYear) {
    const container = document.getElementById('badgesList');
    if (!container) return;

    let booksCount = 0;

    if (window.supabaseClient) {
        try {
            const year = academicYear || getActiveYear();
            const { data, error } = await window.supabaseClient
                .from('students')
                .select('total_books')
                .eq('student_id', studentId)
                .eq('academic_year', year)
                .maybeSingle();

            if (error) throw error;
            booksCount = data ? (data.total_books || 0) : 0;
        } catch (err) {
            console.error('loadBadges error:', err);
            booksCount = 0;
        }
    }

    container.innerHTML = '';
    BADGES_CRITERIA.forEach(badge => {
        const unlocked = booksCount >= badge.threshold;
        const el = document.createElement('div');
        el.className = `badge-item${unlocked ? ' unlocked' : ''}`;
        el.title = badge.desc;
        el.innerHTML = `
            <span style="font-size:1.5rem;">${badge.emoji}</span>
            <span>${badge.name}</span>
        `;
        container.appendChild(el);
    });
}

window.loadBadges = loadBadges;
