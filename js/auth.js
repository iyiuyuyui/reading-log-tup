/**
 * auth.js — Authentication module (Supabase Cloud Production Hardened)
 */

// ── Session Helpers ────────────────────────────────────────────
function getSession() {
    try {
        return JSON.parse(localStorage.getItem('userSession') || 'null');
    } catch { return null; }
}

function setSession(data) {
    localStorage.setItem('userSession', JSON.stringify(data));
}

function clearSession() {
    localStorage.removeItem('userSession');
    sessionStorage.clear();
}

function checkAuth(roles) {
    const session = getSession();
    if (!session || !session.role) {
        window.location.href = 'login.html';
        return null;
    }
    if (roles && !roles.includes(session.role)) {
        window.location.href = 'login.html';
        return null;
    }
    return session;
}

// ── Property Mapping Helpers (DB snake_case -> JS camelCase) ───
function mapStudentToCamelCase(data) {
    if (!data) return null;
    return {
        id: data.id,
        studentId: data.student_id,
        prefix: data.prefix,
        firstName: data.first_name,
        lastName: data.last_name,
        level: data.level,
        room: data.room,
        number: data.number,
        academicYear: data.academic_year,
        role: 'student'
    };
}

function mapTeacherToCamelCase(data) {
    if (!data) return null;
    return {
        teacherId: data.id,
        code: data.code,
        name: data.name,
        assignedLevel: data.assigned_level,
        assignedGrades: data.assigned_grades || [data.assigned_level],
        assignedClassrooms: data.assigned_classrooms || [],
        role: 'teacher'
    };
}

// ── Login Logic ────────────────────────────────────────────────
async function loginAdmin(password) {
    if (!window.supabaseClient) throw new Error('ฐานข้อมูลยังไม่ได้เชื่อมต่อ');

    const email = 'admin@readinglog.tup';
    const { data: authData, error: authError } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (authError) {
        throw new Error('รหัสผ่านผู้ดูแลระบบไม่ถูกต้อง');
    }

    setSession({
        role: 'admin',
        token: authData.session.access_token,
        user: {
            code: 'THTUPPT',
            name: 'ผู้ดูแลระบบ',
            role: 'admin'
        }
    });
    return true;
}

async function loginTeacher(code, password) {
    if (!window.supabaseClient) throw new Error('ฐานข้อมูลยังไม่ได้เชื่อมต่อ');
    if (!code || !password) throw new Error('กรุณากรอกรหัสครูและรหัสผ่าน');

    const email = `${String(code).trim()}@teacher.readinglog`;
    const { data: authData, error: authError } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (authError) {
        throw new Error('รหัสประจำตัวครูหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Fetch teacher details from database
    const { data: teacherProfile, error: profileError } = await window.supabaseClient
        .from('teachers')
        .select('*')
        .eq('id', authData.user.id)
        .single();

    if (profileError || !teacherProfile) {
        throw new Error('ไม่พบข้อมูลโปรไฟล์ประจำตัวครู กรุณาติดต่อผู้ดูแลระบบ');
    }

    if (teacherProfile.is_active === false) {
        await window.supabaseClient.auth.signOut();
        throw new Error('บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    }

    const sessionUser = mapTeacherToCamelCase(teacherProfile);
    setSession({
        role: 'teacher',
        token: authData.session.access_token,
        user: sessionUser
    });
    
    // Save to localStorage for compatibility with legacy dashboards
    localStorage.setItem('userData', JSON.stringify(sessionUser));
    return teacherProfile;
}

async function loginStudent(studentId, password) {
    if (!window.supabaseClient) throw new Error('ฐานข้อมูลยังไม่ได้เชื่อมต่อ');
    if (!studentId || !password) throw new Error('กรุณากรอกรหัสประจำตัวและรหัสผ่าน');

    // Load active academic year
    if (!window.currentAcademicYear) await initAcademicYear();
    const year = getActiveYear();

    const email = `${String(studentId).trim()}@student.readinglog`;
    const { data: authData, error: authError } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (authError) {
        throw new Error('รหัสประจำตัวนักเรียนหรือรหัสผ่านไม่ถูกต้อง');
    }

    // Fetch student active yearly profile
    const { data: studentProfile, error: profileError } = await window.supabaseClient
        .from('students')
        .select('*')
        .eq('student_id', String(studentId).trim())
        .eq('academic_year', year)
        .maybeSingle();

    if (profileError || !studentProfile) {
        // Fallback: If not found in current year, pick their most recent yearly profile
        const { data: latestProfile } = await window.supabaseClient
            .from('students')
            .select('*')
            .eq('student_id', String(studentId).trim())
            .order('academic_year', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (!latestProfile) {
            throw new Error('ไม่พบข้อมูลทะเบียนนักเรียนในชั้นเรียนประจำปี กรุณาติดต่อครูประจำชั้น');
        }
        
        window.currentAcademicYear = latestProfile.academic_year;
        sessionStorage.setItem('currentAcademicYear', latestProfile.academic_year);
        
        const sessionUser = mapStudentToCamelCase(latestProfile);
        setSession({
            role: 'student',
            token: authData.session.access_token,
            user: sessionUser
        });
        return latestProfile;
    }

    const sessionUser = mapStudentToCamelCase(studentProfile);
    setSession({
        role: 'student',
        token: authData.session.access_token,
        user: sessionUser
    });
    return studentProfile;
}

async function logout() {
    if (window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
    }
    clearSession();
    window.location.href = 'login.html';
}

// ── Role Guards ────────────────────────────────────────────────
function requireAdmin()   { return checkAuth(['admin']); }
function requireTeacher() { return checkAuth(['teacher', 'admin']); }
function requireStudent() { return checkAuth(['student']); }

// ── Activation Modal Handling ─────────────────────────────────
function openActivationModal(e) {
    if (e) e.preventDefault();
    const modal = document.getElementById('activationModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeActivationModal() {
    const modal = document.getElementById('activationModal');
    if (modal) {
        modal.style.display = 'none';
    }
    const form = document.getElementById('activationForm');
    if (form) form.reset();
    const errMsg = document.getElementById('actErrorMessage');
    if (errMsg) errMsg.textContent = '';
}

// Expose functions globally
window.getSession      = getSession;
window.setSession      = setSession;
window.clearSession    = clearSession;
window.checkAuth       = checkAuth;
window.requireAuth     = checkAuth;
window.requireAdmin    = requireAdmin;
window.requireTeacher  = requireTeacher;
window.requireStudent  = requireStudent;
window.loginAdmin      = loginAdmin;
window.loginTeacher    = loginTeacher;
window.loginStudent    = loginStudent;
window.logout          = logout;
window.openActivationModal = openActivationModal;
window.closeActivationModal = closeActivationModal;

// ── Login UI Initialization (only runs on login.html) ─────────
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (!loginForm) return;

    const tabs = document.querySelectorAll('.role-tab');
    const sections = document.querySelectorAll('.form-section');
    const errBox = document.getElementById('errorMessage');

    // 1. Tab Switching
    tabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const role = tab.getAttribute('data-role');
            sections.forEach(sec => {
                sec.classList.remove('active');
            });

            if (role === 'student') {
                document.getElementById('studentSection').classList.add('active');
            } else if (role === 'teacher') {
                document.getElementById('teacherSection').classList.add('active');
            } else if (role === 'admin') {
                document.getElementById('adminSection').classList.add('active');
            }
            errBox.textContent = '';
        });
    });

    // 2. Login Submit
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.textContent = '';

        const activeTab = document.querySelector('.role-tab.active');
        const role = activeTab ? activeTab.getAttribute('data-role') : 'student';

        try {
            if (role === 'student') {
                const studentId = document.getElementById('studentId').value.trim();
                const studentPassword = document.getElementById('studentPassword').value;
                if (!studentId) throw new Error('กรุณากรอกรหัสประจำตัวนักเรียน');
                if (!studentPassword) throw new Error('กรุณากรอกรหัสผ่าน');
                
                await loginStudent(studentId, studentPassword);
                window.location.href = 'student-dashboard.html';
            } else if (role === 'teacher') {
                const code = document.getElementById('teacherUserCode').value.trim();
                const password = document.getElementById('teacherPassword').value;
                if (!code) throw new Error('กรุณากรอกรหัสประจำตัวครู');
                if (!password) throw new Error('กรุณากรอกรหัสผ่านครู');
                
                await loginTeacher(code, password);
                window.location.href = 'teacher-dashboard.html';
            } else if (role === 'admin') {
                const adminCode = document.getElementById('adminCode').value.trim();
                if (!adminCode) throw new Error('กรุณากรอกรหัสผ่านผู้ดูแลระบบ');
                
                await loginAdmin(adminCode);
                window.location.href = 'admin-dashboard.html';
            }
        } catch (err) {
            errBox.textContent = err.message;
        }
    });

    // 3. Activation Form Submit
    const activationForm = document.getElementById('activationForm');
    if (activationForm) {
        activationForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const actErr = document.getElementById('actErrorMessage');
            actErr.textContent = '';

            const studentId = document.getElementById('actStudentId').value.trim();
            const passcode = document.getElementById('actPasscode').value.trim();
            const newPassword = document.getElementById('actPassword').value;

            if (!studentId || !passcode || !newPassword) {
                actErr.textContent = 'กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง';
                return;
            }

            try {
                // Call Supabase Edge Function to Activate Student Account
                const response = await fetch(`${SUPABASE_URL}/functions/v1/activate-student-account`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ studentId, passcode, newPassword })
                });

                const resData = await response.json();
                if (!response.ok) {
                    throw new Error(resData.error || 'การเปิดใช้งานบัญชีล้มเหลว');
                }

                alert(resData.message || 'เปิดใช้งานบัญชีสำเร็จ! กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่');
                closeActivationModal();
                
                // Pre-fill student ID for ease of login
                document.getElementById('studentId').value = studentId;
                document.getElementById('studentPassword').focus();

            } catch (err) {
                actErr.textContent = err.message;
            }
        });
    }
});
