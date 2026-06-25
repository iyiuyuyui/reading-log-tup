document.addEventListener('DOMContentLoaded', async () => {
    // 1. Guard check auth (allow only 'teacher' role)
    const session = checkAuth(['teacher']);
    if (!session) return;

    const teacher = session.user;
    if (!teacher) {
        console.error("Teacher profile data could not be loaded from session.");
        alert("ไม่พบข้อมูลผู้ใช้ของอาจารย์ในเซสชัน กรุณาล็อกอินใหม่อีกครั้ง");
        logout();
        return;
    }

    // Sync localStorage userData for compatibility
    localStorage.setItem('userData', JSON.stringify(teacher));
    
    // 2. Render Teacher Info with fallback handling
    const headerUserMeta = document.getElementById('headerUserMeta');
    const teacherFullName = teacher.name || [teacher.prefix, teacher.firstName, teacher.lastName].filter(Boolean).join(' ') || 'คุณครูผู้ประเมิน';
    if (headerUserMeta) {
        headerUserMeta.innerHTML = `
            <span style="font-weight:700;">${teacherFullName}</span>
            &nbsp;|&nbsp; รหัสประจำตัว: ${teacher.code || teacher.teacherId}
        `;
    }

    // Resolve assignedLevel from session with robust fallbacks
    let teacherAssignedLevel = teacher.assignedLevel;
    
    if (!teacherAssignedLevel) {
        console.warn("assignedLevel not found in session user, attempting Supabase lookup...");
        if (window.supabaseClient && teacher.code) {
            try {
                const { data: tData, error: tErr } = await window.supabaseClient
                    .from('teachers')
                    .select('assigned_level')
                    .eq('code', teacher.code)
                    .maybeSingle();
                if (!tErr && tData) {
                    teacherAssignedLevel = tData.assigned_level;
                }
            } catch (e) {
                console.error("Error fetching teacher profile from Supabase:", e);
            }
        }
        
        // Secondary fallback using teacher code regex
        if (!teacherAssignedLevel) {
            const match = teacher.code ? teacher.code.match(/THTUPPT0([1-6])/) : null;
            teacherAssignedLevel = match ? 'ม.' + match[1] : 'ม.1';
            console.log(`Fallback assignedLevel set based on code: ${teacherAssignedLevel}`);
        }
    }
    
    window.teacherAssignedLevel = teacherAssignedLevel;
    activeLevel = teacherAssignedLevel;

    // Lock selects to assigned level(s)
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const levelSelect = document.getElementById('levelSelect');
    if (levelSelect) {
        levelSelect.innerHTML = assignedGrades.map(g => `<option value="${g}">${formatLevel(g)}</option>`).join('');
        levelSelect.value = assignedGrades[0];
        levelSelect.disabled = assignedGrades.length <= 1;
        levelSelect.addEventListener('change', () => {
            activeLevel = levelSelect.value;
            loadRooms();
        });
    }
    const filterLevel = document.getElementById('filterLevel');
    if (filterLevel) {
        filterLevel.innerHTML = assignedGrades.map(g => `<option value="${g}">${formatLevel(g)}</option>`).join('');
        filterLevel.value = assignedGrades[0];
        filterLevel.disabled = assignedGrades.length <= 1;
        filterLevel.addEventListener('change', () => {
            activeSummaryRoom = null;
            updateSummaryRooms();
            loadSummaryRooms();
            updateRealtimeSummary();
        });
    }

    // Initialize Academic Year Selector
    const activeYear = getActiveYear();
    if (typeof populateYearSelector === 'function') {
        await populateYearSelector('globalYearSelect', activeYear);
    }

    // 3. Load UI elements
    loadRooms();
    loadAnnouncements();
    listenToGradingQueue();
    preloadSummaryData();

    // 4. Setup Announcement form submission
    const annForm = document.getElementById('announcementForm');
    if (annForm) {
        annForm.addEventListener('submit', handleAnnouncementSubmit);
    }
});

async function handleGlobalYearChange(year) {
    if (!year) return;
    window.currentAcademicYear = year;
    sessionStorage.setItem('currentAcademicYear', year);
    showToast(`เปลี่ยนปีการศึกษาเป็น ${year}`, 'success');

    if (window.db) {
        listenToGradingQueue();
        preloadSummaryData();
    }
}
window.handleGlobalYearChange = handleGlobalYearChange;

let selectedGradingLogId = null;
let selectedStarsValue = 4;
let activeLevel = 'ม.1';
let activeRoom = null;
let activeSummaryRoom = null;

// Real-time cached data for classroom summary dashboard
let cachedStudents = [];
let cachedLogs = [];
let activeProfileStudentId = null;

const studentCache = new Map();

// Global variables for summary caching and listener cleanup
let summaryCache = {
    students: null,
    reports: null,
    lastFetched: 0,
    academicYear: null
};
let summaryStudentsUnsubscribe = null;
let summaryReportsUnsubscribe = null;

undefined

// Switch between tabs
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottom = '3px solid transparent';
        btn.style.color = 'var(--color-text-light)';
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });

    if (tabId === 'grading') {
        document.getElementById('btnTabGrading').classList.add('active');
        document.getElementById('btnTabGrading').style.borderBottom = '3px solid var(--color-primary)';
        document.getElementById('btnTabGrading').style.color = 'var(--color-primary)';
        document.getElementById('tabGradingContent').style.display = 'block';
    } else if (tabId === 'summary') {
        document.getElementById('btnTabSummary').classList.add('active');
        document.getElementById('btnTabSummary').style.borderBottom = '3px solid var(--color-primary)';
        document.getElementById('btnTabSummary').style.color = 'var(--color-primary)';
        document.getElementById('tabSummaryContent').style.display = 'block';
        updateSummaryRooms();
        loadSummaryRooms();
        updateRealtimeSummary();
    }
}

// Load room grid based on selected level
function loadRooms() {
    const levelSelect = document.getElementById('levelSelect');
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const session = getSession();
    const teacher = session ? session.user : {};
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const assignedClassrooms = teacher.assignedClassrooms || [];
    
    // Enforce level restriction
    if (levelSelect && !assignedGrades.includes(levelSelect.value)) {
        console.warn(`Unauthorized level access attempt to: ${levelSelect.value}. Reverting to: ${assignedGrades[0]}`);
        levelSelect.value = assignedGrades[0];
    }
    
    activeLevel = levelSelect ? levelSelect.value : (assignedGrades[0] || teacherAssignedLevel);
    const roomsContainer = document.getElementById('roomsContainer');
    roomsContainer.innerHTML = '';

    // Determine total rooms dynamically based on level
    let totalRooms = 11; // default
    if (activeLevel === 'ม.1' || activeLevel === 'ม.2') {
        totalRooms = 13;
    } else if (activeLevel === 'ม.3') {
        totalRooms = 12;
    } else if (activeLevel === 'ม.4' || activeLevel === 'ม.5' || activeLevel === 'ม.6') {
        totalRooms = 11;
    }

    for (let r = 1; r <= totalRooms; r++) {
        const roomName = `${formatLevel(activeLevel)}/${r}`;
        if (assignedClassrooms.length > 0 && !assignedClassrooms.includes(roomName)) {
            continue; // Skip rooms not assigned to this teacher
        }
        const div = document.createElement('div');
        div.className = `class-card ${activeRoom === r ? 'active' : ''}`;
        div.textContent = roomName;
        div.onclick = () => selectClass(r);
        roomsContainer.appendChild(div);
    }
}

// Select a specific class to view its students
async function selectClass(roomNum) {
    const session = getSession();
    const teacher = session ? session.user : {};
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const assignedClassrooms = teacher.assignedClassrooms || [];

    if (!assignedGrades.includes(activeLevel)) {
        console.warn(`Unauthorized level query attempt to: ${activeLevel}. Overriding with: ${assignedGrades[0]}`);
        activeLevel = assignedGrades[0];
    }
    
    // Check if classroom is assigned
    const classroomName = `${formatLevel(activeLevel)}/${roomNum}`;
    if (assignedClassrooms.length > 0 && !assignedClassrooms.includes(classroomName)) {
        console.error(`Unauthorized classroom access: ${classroomName}`);
        alert("ขออภัย: ท่านไม่มีสิทธิ์เข้าถึงข้อมูลของห้องเรียนนี้");
        return;
    }

    activeRoom = roomNum;
    
    // Update visual active state in room grid using exact text match
    document.querySelectorAll('#roomsContainer .class-card').forEach((card) => {
        if (card.textContent === `${formatLevel(activeLevel)}/${roomNum}`) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    const studentListCard = document.getElementById('studentListCard');
    const studentListTitle = document.getElementById('studentListTitle');
    const studentListBody = document.getElementById('studentListBody');

    studentListCard.style.display = 'block';
    studentListTitle.innerHTML = `<span class="material-icons-round text-icon">people</span> รายชื่อนักเรียนห้อง ${formatClass(activeLevel, roomNum)}`;
    studentListBody.innerHTML = `<tr><td colspan="5" class="text-center">กำลังโหลดรายชื่อนักเรียน...</td></tr>`;

    if (!window.db) {
        // Render mock student roster
        renderStudentList(getMockStudents(activeLevel, roomNum));
        return;
    }

    try {
        const targetYear = getActiveYear();
        const { data: dbStudents, error } = await window.supabaseClient
            .from('students')
            .select('*')
            .eq('level', formatLevel(activeLevel))
            .eq('room', roomNum)
            .eq('academic_year', targetYear);

        if (error) throw error;

        const students = (dbStudents || []).map(s => ({
            id: s.id,
            studentId: s.student_id,
            prefix: s.prefix,
            firstName: s.first_name,
            lastName: s.last_name,
            level: s.level,
            room: s.room,
            number: s.number,
            academicYear: s.academic_year,
            totalBooks: s.total_books,
            totalScore: s.total_score,
            totalReadingTime: s.total_reading_time,
            totalPages: s.total_pages
        }));

        // Sort in memory by seat number (เลขที่)
        students.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));

        renderStudentList(students);
    } catch (error) {
        console.error("Error loading students:", error);
        studentListBody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--color-danger)">ไม่สามารถโหลดข้อมูลห้องเรียนนี้ได้: ${error.message}</td></tr>`;
    }
}

// Load classroom summary cards
function loadSummaryRooms() {
    const filterLevelSelect = document.getElementById('filterLevel');
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const session = getSession();
    const teacher = session ? session.user : {};
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const assignedClassrooms = teacher.assignedClassrooms || [];

    const activeSummaryLevel = filterLevelSelect ? filterLevelSelect.value : (assignedGrades[0] || teacherAssignedLevel);
    const summaryRoomsContainer = document.getElementById('summaryRoomsContainer');
    if (!summaryRoomsContainer) return;
    summaryRoomsContainer.innerHTML = '';

    // Determine total rooms dynamically based on level
    let totalRooms = 11; // default
    if (activeSummaryLevel === 'ม.1' || activeSummaryLevel === 'ม.2') {
        totalRooms = 13;
    } else if (activeSummaryLevel === 'ม.3') {
        totalRooms = 12;
    } else if (activeSummaryLevel === 'ม.4' || activeSummaryLevel === 'ม.5' || activeSummaryLevel === 'ม.6') {
        totalRooms = 11;
    }

    // Add a card for "ทั้งหมด" (All)
    const allDiv = document.createElement('div');
    allDiv.className = `class-card ${activeSummaryRoom === null ? 'active' : ''}`;
    allDiv.textContent = 'ทั้งหมด';
    allDiv.onclick = () => selectSummaryClass(null);
    summaryRoomsContainer.appendChild(allDiv);

    for (let r = 1; r <= totalRooms; r++) {
        const roomName = `${formatLevel(activeSummaryLevel)}/${r}`;
        if (assignedClassrooms.length > 0 && !assignedClassrooms.includes(roomName)) {
            continue; // Skip rooms not assigned to this teacher
        }
        const div = document.createElement('div');
        div.className = `class-card ${activeSummaryRoom === r ? 'active' : ''}`;
        div.textContent = roomName;
        div.onclick = () => selectSummaryClass(r);
        summaryRoomsContainer.appendChild(div);
    }
}

// Select a specific classroom card in the summary tab
function selectSummaryClass(roomNum) {
    activeSummaryRoom = roomNum;
    const filterLevelSelect = document.getElementById('filterLevel');
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const activeSummaryLevel = filterLevelSelect ? filterLevelSelect.value : teacherAssignedLevel;
    
    // Update active class on cards
    const cards = document.querySelectorAll('#summaryRoomsContainer .class-card');
    cards.forEach(card => {
        if (roomNum === null && card.textContent === 'ทั้งหมด') {
            card.classList.add('active');
        } else if (roomNum !== null && card.textContent === `${formatLevel(activeSummaryLevel)}/${roomNum}`) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }
    });

    // Update filterRoom dropdown value
    const filterRoomSelect = document.getElementById('filterRoom');
    if (filterRoomSelect) {
        filterRoomSelect.value = roomNum === null ? 'ทั้งหมด' : roomNum.toString();
    }

    updateRealtimeSummary();
}

function renderStudentList(students) {
    const studentListBody = document.getElementById('studentListBody');
    if (students.length === 0) {
        studentListBody.innerHTML = `<tr><td colspan="5" class="text-center">ไม่พบข้อมูลนักเรียนในห้องเรียนนี้</td></tr>`;
        return;
    }

    studentListBody.innerHTML = '';
    students.forEach(student => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${student.number}</td>
            <td>${student.studentId}</td>
            <td><strong>${student.prefix || ''}${student.firstName} ${student.lastName}</strong></td>
            <td>${student.totalBooks || 0} เล่ม</td>
            <td>
                <button class="btn" style="padding:0.4rem 0.8rem; font-size:0.8rem; background-color:rgba(0,0,0,0.05)" onclick="viewStudentProfile('${student.studentId}')">
                    ดูประวัติการอ่าน
                </button>
            </td>
        `;
        studentListBody.appendChild(tr);
    });
}

// View student detailed reading history
async function viewStudentProfile(studentId) {
    activeProfileStudentId = studentId;
    const modal = document.getElementById('studentProfileModal');
    const modalTitle = document.getElementById('profileModalTitle');
    const tableBody = document.getElementById('profileLogsTableBody');
    
    modal.classList.add('open');
    modalTitle.textContent = `📚 ประวัติการอ่านของนักเรียนรหัส ${studentId}`;
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center">กำลังโหลดข้อมูล...</td></tr>`;

    const session = getSession();
    const teacher = session ? session.user : {};
    let studentData = null;
    let logs = [];
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';

    if (window.db) {
        try {
            const targetYear = getActiveYear();
            // Get student info
            const { data: sProfile, error: sErr } = await window.supabaseClient
                .from('students')
                .select('*')
                .eq('student_id', String(studentId).trim())
                .eq('academic_year', targetYear)
                .maybeSingle();

            if (sErr) throw sErr;

            if (sProfile) {
                studentData = {
                    id: sProfile.id,
                    studentId: sProfile.student_id,
                    authId: sProfile.auth_id,
                    prefix: sProfile.prefix,
                    firstName: sProfile.first_name,
                    lastName: sProfile.last_name,
                    level: sProfile.level,
                    room: sProfile.room,
                    number: sProfile.number,
                    academicYear: sProfile.academic_year,
                    totalBooks: sProfile.total_books,
                    totalScore: sProfile.total_score,
                    totalReadingTime: sProfile.total_reading_time,
                    totalPages: sProfile.total_pages
                };
                
                // Enforce grade and classroom isolation
                const sLevel = formatLevel(studentData.level);
                const sClassroom = `${sLevel}/${studentData.room}`;
                const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
                const assignedClassrooms = teacher.assignedClassrooms || [];
                
                if (!assignedGrades.includes(studentData.level) || (assignedClassrooms.length > 0 && !assignedClassrooms.includes(sClassroom))) {
                    console.error(`Unauthorized profile access attempt for student ${studentId} in classroom ${sClassroom}`);
                    alert("ขออภัย: ท่านไม่มีสิทธิ์เข้าถึงข้อมูลของนักเรียนห้องอื่น");
                    closeStudentProfileModal();
                    return;
                }
                
                modalTitle.textContent = `📚 ประวัติการอ่านของ: ${studentData.prefix || ''}${studentData.firstName} ${studentData.lastName} (${formatClass(studentData.level, studentData.room)})`;
            } else {
                tableBody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--color-danger)">ไม่พบข้อมูลนักเรียนของรหัสประจำตัวนี้</td></tr>`;
                return;
            }

            // Get passcode if not activated
            let plainPasscode = null;
            if (!studentData.authId) {
                try {
                    const { data: regData, error: regErr } = await window.supabaseClient
                        .from('pending_registrations')
                        .select('plain_passcode')
                        .eq('student_id', String(studentId).trim())
                        .maybeSingle();
                    if (!regErr && regData) {
                        plainPasscode = regData.plain_passcode;
                    }
                } catch (regErr) {
                    console.error("Error fetching plain passcode:", regErr);
                }
            }
            renderStudentAccountArea(studentId, studentData.authId, plainPasscode);

            // Get logs
            const { data: dbReports, error: rErr } = await window.supabaseClient
                .from('reading_reports')
                .select('*')
                .eq('student_id', String(studentId).trim())
                .eq('academic_year', targetYear);
                
            if (rErr) throw rErr;

            logs = (dbReports || []).map(r => ({
                id: r.id,
                studentId: r.student_id,
                studentLevel: r.student_level,
                studentRoom: r.student_room,
                entryNumber: r.entry_number,
                readDate: r.read_date,
                bookTitle: r.book_title,
                author: r.author,
                publisher: r.publisher,
                bookType: r.book_type,
                pageCount: r.page_count,
                readingTime: r.reading_time,
                summary: r.summary,
                lesson: r.lesson,
                application: r.application,
                reason: r.reason,
                newVocabulary: r.new_vocabulary,
                attachmentUrl: r.attachment_url,
                status: r.status,
                score: r.score,
                stars: r.stars,
                teacherComment: r.teacher_comment,
                reviewedBy: r.reviewed_by,
                reviewedAt: r.reviewed_at
            }));

            // Sort in memory
            logs.sort((a, b) => (parseInt(b.entryNumber) || 0) - (parseInt(a.entryNumber) || 0));
        } catch (error) {
            console.error("Error loading student profile logs:", error);
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center" style="color:var(--color-danger)">เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
            return;
        }
    } else {
        // Fallback mock
        studentData = cachedStudents.find(s => s.studentId === studentId) || { studentId, prefix: 'เด็กชาย', firstName: 'กนกพล', lastName: 'ชุนเกษา', level: 'ม.1', room: 1, number: 1 };
        
        // Enforce grade and classroom isolation
        const sLevel = formatLevel(studentData.level);
        const sClassroom = `${sLevel}/${studentData.room}`;
        const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
        const assignedClassrooms = teacher.assignedClassrooms || [];
        
        if (!assignedGrades.includes(studentData.level) || (assignedClassrooms.length > 0 && !assignedClassrooms.includes(sClassroom))) {
            alert("ขออภัย: ท่านไม่มีสิทธิ์เข้าถึงข้อมูลของนักเรียนห้องอื่น");
            closeStudentProfileModal();
            return;
        }
        
        modalTitle.textContent = `📚 ประวัติการอ่านของ: ${studentData.prefix || ''}${studentData.firstName} ${studentData.lastName} (${formatClass(studentData.level, studentData.room)})`;
        logs = getMockLogsForStudent(studentId);

        // Mock account status
        const isMockActivated = (parseInt(studentId) % 2 === 0);
        studentData.authId = isMockActivated ? 'mock-auth-id' : null;
        let mockPasscode = null;
        if (!studentData.authId) {
            mockPasscode = String(100000 + (parseInt(studentId) || 0) % 900000);
        }
        renderStudentAccountArea(studentId, studentData.authId, mockPasscode);
    }

    renderProfileLogs(logs, studentData);
}

function closeStudentProfileModal() {
    document.getElementById('studentProfileModal').classList.remove('open');
    activeProfileStudentId = null;
}

function renderStudentAccountArea(studentId, authId, plainPasscode) {
    const statusEl = document.getElementById('studentAccountStatus');
    const actionsEl = document.getElementById('studentAccountActions');
    
    if (!statusEl || !actionsEl) return;
    
    if (authId) {
        // Activated student
        statusEl.innerHTML = `<span style="color:#16a34a; font-weight:600;">เปิดใช้งานบัญชีแล้ว</span>`;
        actionsEl.innerHTML = `
            <button class="btn" style="background:#ef4444; color:white; padding:0.4rem 0.8rem; font-size:0.85rem; display:flex; align-items:center; gap:4px; border:none; border-radius:6px; cursor:pointer;" onclick="resetStudentPassword('${studentId}')">
                <span class="material-icons-round" style="font-size:1.1rem;">lock_reset</span>เปลี่ยนรหัสผ่าน
            </button>
        `;
    } else {
        // Unactivated student
        if (plainPasscode) {
            statusEl.innerHTML = `ยังไม่ได้เปิดใช้งาน | รหัสเปิดใช้งาน (Passcode): <strong style="font-size:1.15rem; color:#15803d; letter-spacing:1px; background:#dcfce7; padding:2px 8px; border-radius:4px; border:1px solid #bbf7d0;">${plainPasscode}</strong>`;
            actionsEl.innerHTML = `
                <button class="btn" style="background:#3b82f6; color:white; padding:0.4rem 0.8rem; font-size:0.85rem; display:flex; align-items:center; gap:4px; border:none; border-radius:6px; cursor:pointer;" onclick="regenerateStudentPasscode('${studentId}')">
                    <span class="material-icons-round" style="font-size:1.1rem;">refresh</span>เปลี่ยนรหัสเปิดใช้งานใหม่
                </button>
            `;
        } else {
            statusEl.innerHTML = `<span style="color:#b45309; font-weight:500;">ยังไม่ได้ตั้งรหัสเปิดใช้งาน (กรุณาสร้างรหัสใหม่)</span>`;
            actionsEl.innerHTML = `
                <button class="btn" style="background:#10b981; color:white; padding:0.4rem 0.8rem; font-size:0.85rem; display:flex; align-items:center; gap:4px; border:none; border-radius:6px; cursor:pointer;" onclick="regenerateStudentPasscode('${studentId}')">
                    <span class="material-icons-round" style="font-size:1.1rem;">vpn_key</span>สร้างรหัสเปิดใช้งาน
                </button>
            `;
        }
    }
}

async function resetStudentPassword(studentId) {
    const newPassword = prompt("กรุณาระบุรหัสผ่านใหม่สำหรับนักเรียน (อย่างน้อย 6 ตัวอักษร):");
    if (newPassword === null) return;
    const trimmed = newPassword.trim();
    if (trimmed.length < 6) {
        alert("รหัสผ่านต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
        return;
    }
    
    if (window.db) {
        try {
            const { data, error } = await window.supabaseClient.rpc('reset_student_password_admin', {
                p_student_id: studentId,
                p_new_password: trimmed
            });
            if (error) throw error;
            if (data) {
                alert("เปลี่ยนรหัสผ่านสำเร็จแล้ว นักเรียนสามารถเข้าใช้งานด้วยรหัสผ่านใหม่ได้ทันที");
            } else {
                alert("ไม่สามารถเปลี่ยนรหัสผ่านได้ เนื่องจากไม่พบข้อมูลบัญชีผู้ใช้งานของนักเรียนคนนี้");
            }
        } catch (err) {
            console.error("Error resetting student password:", err);
            alert("เกิดข้อผิดพลาด: " + err.message);
        }
    } else {
        alert(`[Mock Mode] จำลองการเปลี่ยนรหัสผ่านของรหัส ${studentId} เป็น "${trimmed}" สำเร็จ`);
    }
}

async function regenerateStudentPasscode(studentId) {
    const newPasscode = Math.floor(100000 + Math.random() * 900000).toString();
    const ok = confirm(`ต้องการสร้างรหัสเปิดใช้งาน (Passcode) ใหม่สำหรับนักเรียนรหัส ${studentId} ใช่หรือไม่?\n\nรหัสเปิดใช้งานใหม่คือ: ${newPasscode}`);
    if (!ok) return;
    
    if (window.db) {
        try {
            const { data, error } = await window.supabaseClient.rpc('set_student_passcode_admin', {
                p_student_id: studentId,
                p_passcode: newPasscode
            });
            if (error) throw error;
            if (data) {
                alert("สร้างรหัสเปิดใช้งานใหม่สำเร็จแล้ว");
                await viewStudentProfile(studentId);
            } else {
                alert("ไม่สามารถสร้างรหัสเปิดใช้งานได้");
            }
        } catch (err) {
            console.error("Error setting student passcode:", err);
            alert("เกิดข้อผิดพลาด: " + err.message);
        }
    } else {
        alert(`[Mock Mode] จำลองการสร้างรหัสเปิดใช้งานใหม่สำหรับรหัส ${studentId} เป็น "${newPasscode}" สำเร็จ`);
        renderStudentAccountArea(studentId, null, newPasscode);
    }
}

window.resetStudentPassword = resetStudentPassword;
window.regenerateStudentPasscode = regenerateStudentPasscode;

function renderProfileLogs(logs, studentData) {
    const tableBody = document.getElementById('profileLogsTableBody');
    
    // Update individual summary statistics block in modal
    const approvedLogs = logs.filter(l => l.status === 'approved');
    const count = approvedLogs.length;
    const pages = approvedLogs.reduce((sum, log) => sum + (parseInt(log.pageCount) || 0), 0);
    const time = approvedLogs.reduce((sum, log) => sum + (parseInt(log.readingTime) || 0), 0);

    document.getElementById('indivSubmittedCount').textContent = `${count} ครั้ง`;
    document.getElementById('indivPageCount').textContent = `${pages} หน้า`;
    document.getElementById('indivReadingTime').textContent = `${time} นาที`;

    if (logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center">ไม่พบประวัติการบันทึกของนักเรียนคนนี้</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');
        const dateStr = log.readDate ? formatThaiDate(log.readDate) : '-';
        
        let scoreDisplay = '-';
        if (log.status === 'approved') {
            const stars = '⭐'.repeat(log.stars || 0);
            scoreDisplay = `<div><strong>${log.score}/10</strong></div><div>${stars}</div>`;
        }

        let statusText = 'รอตรวจ';
        let statusClass = 'pending';
        if (log.status === 'approved') { statusText = 'อนุมัติ'; statusClass = 'approved'; }
        else if (log.status === 'rejected') { statusText = 'ไม่อนุมัติ'; statusClass = 'rejected'; }

        // Encode student and log data for the button
        const logDataString = JSON.stringify(log).replace(/"/g, '&quot;');
        const studentDataString = JSON.stringify(studentData).replace(/"/g, '&quot;');

        tr.innerHTML = `
            <td>ครั้งที่ ${log.entryNumber}</td>
            <td>${dateStr}</td>
            <td><strong>${log.bookTitle}</strong></td>
            <td>${log.bookType}</td>
            <td>${scoreDisplay}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>
                <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem;" onclick="exportSingleReportFromTeacher(${logDataString}, ${studentDataString})">
                    <span class="material-icons-round" style="font-size:0.9rem;vertical-align:middle;">picture_as_pdf</span> PDF
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// Teacher triggers overlay image generation and download as PDF
async function exportSingleReportFromTeacher(logData, studentData) {
    try {
        const dataUrl = await generateReportImage(logData, studentData);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297);
        const studentName = `${studentData.prefix || ''}${studentData.firstName} ${studentData.lastName}`;
        pdf.save(`บันทึกรักการอ่าน_${studentName}_ครั้งที่_${logData.entryNumber}.pdf`);
    } catch (error) {
        alert("ไม่สามารถสร้างไฟล์ PDF สมุดบันทึกได้: " + error.message);
    }
}

function getMockLogsForStudent(studentId) {
    return [
        {
            id: 'mock_log_1',
            studentId: studentId,
            entryNumber: 1,
            readDate: new Date(),
            bookTitle: 'คิตะยะ ร้านหนังสือเครื่องเขียนเวทมนตร์',
            author: 'Katsuya',
            publisher: 'Bookscape',
            bookType: 'ทั่วไป',
            pageCount: 15,
            readingTime: 45,
            summary: 'เรื่องราวของร้านหนังสือวิเศษที่กระดาษเขียนจดหมายสามารถแปลงเวทมนตร์ให้ความรู้สึกผู้ส่งถึงผู้รับสัมผัสได้จริง',
            lesson: 'การสื่อความรู้สึกที่จริงใจสามารถแก้ไขความเข้าใจผิดของคนเราได้',
            application: 'การใช้การเขียนสื่อสารอย่างสร้างสรรค์และถนอมน้ำใจผู้อื่น',
            reason: 'เห็นชื่อเรื่องแล้วน่าสนใจดีเกี่ยวกับเครื่องเขียนเวทมนตร์',
            newVocabulary: 'เครื่องเขียน หมายถึง อุปกรณ์ต่างๆ ที่ใช้ในการเขียนหนังสือ',
            status: 'approved',
            score: 9,
            stars: 4
        }
    ];
}

// Announcement handling
async function handleAnnouncementSubmit(e) {
    e.preventDefault();
    const title = document.getElementById('annTitle').value.trim();
    const content = document.getElementById('annContent').value.trim();
    const teacher = JSON.parse(localStorage.getItem('userData'));
    const authorLevel = activeLevel || window.teacherAssignedLevel || 'ม.1';

    const docData = {
        title,
        content,
        author_code: teacher.code,
        author_name: teacher.name,
        author_level: authorLevel,
        is_active: true
    };

    if (window.supabaseClient) {
        try {
            const { error } = await window.supabaseClient
                .from('announcements')
                .insert(docData);

            if (error) throw error;
            document.getElementById('announcementForm').reset();
            loadAnnouncements();
            // Send telegram announcement
            sendTelegramMessage(`📢 <b>ประกาศจากโรงเรียน ต.อ.พ.ปท.</b>\nเรื่อง: ${title}\n${content}`);
        } catch (error) {
            console.error("Error creating announcement:", error);
        }
    } else {
        alert("ระบบทดลอง: โพสต์ประกาศสำเร็จ");
        document.getElementById('announcementForm').reset();
    }
}

async function loadAnnouncements() {
    const listDiv = document.getElementById('announcementsList');
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    
    if (!window.db) {
        listDiv.innerHTML = `
            <div class="announcement-item">
                <strong>ยินดีต้อนรับสู่เทอมใหม่</strong>
                <p style="font-size:0.9rem;">เริ่มบันทึกรักการอ่านเล่มแรกเพื่อทำเกียรติบัตรกันเลยค่ะ</p>
                <div style="font-size:0.8rem;color:#777" class="mt-1">โพสต์โดย: คุณครูระบบทดลอง</div>
            </div>
        `;
        return;
    }

    try {
        const { data: dbAnnouncements, error } = await window.supabaseClient
            .from('announcements')
            .select('*')
            .eq('is_active', true);

        if (error) throw error;

        const announcements = [];
        (dbAnnouncements || []).forEach(data => {
            const session = getSession();
            const teacher = session ? session.user : {};
            const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
            if (!data.author_level || assignedGrades.includes(data.author_level)) {
                announcements.push({
                    id: data.id,
                    title: data.title,
                    content: data.content,
                    authorName: data.author_name,
                    authorLevel: data.author_level,
                    createdAt: data.created_at
                });
            }
        });

        if (announcements.length === 0) {
            listDiv.innerHTML = '<p class="text-center font-sm color-light">ยังไม่มีประกาศ</p>';
            return;
        }

        // Sort in memory by createdAt descending
        announcements.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        const latestAnnouncements = announcements.slice(0, 5);

        listDiv.innerHTML = '';
        latestAnnouncements.forEach(data => {
            const div = document.createElement('div');
            div.className = 'announcement-item';
            div.innerHTML = `
                <strong>${data.title}</strong>
                <p style="font-size:0.9rem;">${data.content}</p>
                <div style="font-size:0.8rem;color:#777" class="mt-1">โพสต์โดย: ${data.authorName}</div>
                <div class="announcement-actions">
                    <button class="delete-btn" onclick="deleteAnnouncement('${data.id}')">
                        <span class="material-icons-round" style="font-size:1.1rem">delete</span>
                    </button>
                </div>
            `;
            listDiv.appendChild(div);
        });
    } catch (error) {
        console.error("Error loading announcements:", error);
    }
}

async function deleteAnnouncement(id) {
    if (!confirm("ต้องการลบประกาศนี้ใช่หรือไม่?")) return;
    if (window.supabaseClient) {
        try {
            const { data, error } = await window.supabaseClient
                .from('announcements')
                .select('*')
                .eq('id', id)
                .single();

            if (error) throw error;
            if (data) {
                const session = getSession();
                const teacher = session ? session.user : {};
                const teacherAssignedLevel = window.teacherAssignedLevel || teacher.assignedLevel || 'ม.1';
                const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
                
                // Block if it's from another level
                if (data.author_level && !assignedGrades.includes(data.author_level)) {
                    alert("ท่านไม่มีสิทธิ์ลบประกาศของระดับชั้นอื่น");
                    return;
                }
            }

            const { error: updateErr } = await window.supabaseClient
                .from('announcements')
                .update({ is_active: false })
                .eq('id', id);

            if (updateErr) throw updateErr;
            loadAnnouncements();
        } catch (error) {
            alert("ลบไม่สำเร็จ: " + error.message);
        }
    }
}

let gradingQueueListener = null;

// Listen to logs requiring teacher approval in real-time
let gradingQueueChannel = null;

async function listenToGradingQueue() {
    const queueBody = document.getElementById('gradingQueueBody');
    if (!queueBody) return;

    const session = getSession();
    const teacher = session ? session.user : {};
    const teacherAssignedLevel = window.teacherAssignedLevel || teacher.assignedLevel || 'ม.1';
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const assignedClassrooms = teacher.assignedClassrooms || [];

    if (!window.supabaseClient) {
        // Fallback mock
        const filteredMockQueue = getMockQueue().filter(l => {
            const roomName = `${formatLevel(l.studentLevel)}/${l.studentRoom}`;
            return assignedGrades.includes(l.studentLevel) && (assignedClassrooms.length === 0 || assignedClassrooms.includes(roomName));
        });
        renderGradingQueue(filteredMockQueue);
        return;
    }

    // 1. Initial Load
    await loadGradingQueueData(assignedGrades, assignedClassrooms);

    // 2. Unsubscribe previous channel
    if (gradingQueueChannel) {
        window.supabaseClient.removeChannel(gradingQueueChannel);
    }

    // 3. Subscribe to changes
    gradingQueueChannel = window.supabaseClient
        .channel('grading-queue-changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'reading_reports'
        }, async (payload) => {
            console.log('Realtime change received in grading queue:', payload);
            const prevCount = parseInt(queueBody.dataset.count || '0', 10);
            
            await loadGradingQueueData(assignedGrades, assignedClassrooms);
            
            const newCount = parseInt(queueBody.dataset.count || '0', 10);
            if (newCount > prevCount) {
                const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-84.wav');
                audio.play().catch(e => console.log("Sound play blocked:", e));
                showToast("มีบันทึกการอ่านใหม่ของนักเรียนส่งเข้ามาให้ตรวจประเมิน!", "info");
            }

            // Real-time roster and dashboard updates
            if (activeRoom !== null) {
                await selectClass(activeRoom);
            }
            summaryCache.lastFetched = 0;
            await preloadSummaryData();
        })
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'students'
        }, async (payload) => {
            console.log('Realtime change received in students:', payload);
            if (activeRoom !== null) {
                await selectClass(activeRoom);
            }
            summaryCache.lastFetched = 0;
            await preloadSummaryData();
        })
        .subscribe();
}

async function loadGradingQueueData(assignedGrades, assignedClassrooms) {
    const queueBody = document.getElementById('gradingQueueBody');
    const targetYear = getActiveYear();

    try {
        const { data: dbReports, error } = await window.supabaseClient
            .from('reading_reports')
            .select(`
                *,
                student:students(*)
            `)
            .eq('status', 'pending')
            .eq('academic_year', targetYear)
            .in('student_level', assignedGrades);

        if (error) throw error;

        const logs = [];
        (dbReports || []).forEach(r => {
            const student = r.student;
            if (!student) return;

            const sLevel = formatLevel(r.student_level);
            const sRoom = r.student_room || 0;
            const classroomName = `${sLevel}/${sRoom}`;

            if (assignedClassrooms.length > 0 && !assignedClassrooms.includes(classroomName)) {
                return;
            }

            const studentName = `${student.prefix || ''}${student.first_name} ${student.last_name} (${formatClass(student.level, student.room)})`;
            
            logs.push({
                id: r.id,
                studentName: studentName,
                studentId: r.student_id,
                studentLevel: r.student_level,
                studentRoom: r.student_room,
                entryNumber: r.entry_number,
                readDate: r.read_date,
                bookTitle: r.book_title,
                author: r.author,
                publisher: r.publisher,
                bookType: r.book_type,
                pageCount: r.page_count,
                readingTime: r.reading_time,
                summary: r.summary,
                lesson: r.lesson,
                application: r.application,
                reason: r.reason,
                newVocabulary: r.new_vocabulary,
                attachmentUrl: r.attachment_url,
                status: r.status,
                score: r.score,
                stars: r.stars,
                createdAt: r.created_at
            });
        });

        // Sort in memory by createdAt ascending
        logs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        renderGradingQueue(logs);
        queueBody.dataset.count = logs.length;

    } catch (error) {
        console.error("Error loading grading queue data:", error);
        queueBody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--color-danger)">ไม่สามารถดึงข้อมูลรายการตรวจประเมินได้: ${error.message}</td></tr>`;
    }
}

function renderGradingQueue(logs) {
    const queueBody = document.getElementById('gradingQueueBody');
    if (logs.length === 0) {
        queueBody.innerHTML = `<tr><td colspan="5" class="text-center">🎉 ตรวจหมดแล้ว! ไม่มีรายการบันทึกรอตรวจค้างส่ง</td></tr>`;
        return;
    }

    queueBody.innerHTML = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');
        const dateStr = log.readDate ? formatThaiDate(log.readDate) : '-';
        tr.innerHTML = `
            <td><strong>${log.studentName || log.studentId}</strong></td>
            <td>${dateStr}</td>
            <td><strong>${log.bookTitle}</strong></td>
            <td>${log.bookType}</td>
            <td>
                <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="openGradingModal('${log.id}', ${JSON.stringify(log).replace(/"/g, '&quot;')})">
                    ตรวจประเมิน
                </button>
            </td>
        `;
        queueBody.appendChild(tr);
    });
}

// Grading Modal handling
function openGradingModal(logId, logData) {
    selectedGradingLogId = logId;
    document.getElementById('gradingModal').classList.add('open');

    // Fill UI
    document.getElementById('gradeStudentName').textContent = logData.studentName || logData.studentId;
    document.getElementById('gradeBookTitle').textContent = logData.bookTitle;
    document.getElementById('gradeAuthor').textContent = logData.author || '-';
    document.getElementById('gradePublisher').textContent = logData.publisher || '-';
    document.getElementById('gradeBookType').textContent = logData.bookType;
    document.getElementById('gradePageCount').textContent = logData.pageCount;
    document.getElementById('gradeReadingTime').textContent = logData.readingTime;
    document.getElementById('gradeSummary').textContent = logData.summary;
    document.getElementById('gradeLesson').textContent = logData.lesson;
    
    // Handle attachments
    const fileContainer = document.getElementById('attachmentContainer');
    const fileLink = document.getElementById('gradeAttachmentLink');
    if (logData.attachmentUrl) {
        fileContainer.style.display = 'block';
        fileLink.href = logData.attachmentUrl;
    } else {
        fileContainer.style.display = 'none';
    }

    // Reset fields
    updateScoreVal(8);
    document.getElementById('gradeScore').value = 8;
    setStars(4);
    document.getElementById('teacherComment').value = '';
}

function closeGradingModal() {
    document.getElementById('gradingModal').classList.remove('open');
    selectedGradingLogId = null;
}

function updateScoreVal(val) {
    document.getElementById('scoreVal').textContent = val;
}

function setStars(val) {
    selectedStarsValue = val;
    const stars = document.querySelectorAll('#starRating .star');
    stars.forEach((star, index) => {
        if (index < val) star.classList.add('selected');
        else star.classList.remove('selected');
    });
}

// Submit Grade (Approved / Rejected) to Supabase
async function submitGrade(status) {
    if (!selectedGradingLogId) return;
    
    const teacher = JSON.parse(localStorage.getItem('userData'));
    const score = parseInt(document.getElementById('gradeScore').value);
    const stars = selectedStarsValue;
    const comment = document.getElementById('teacherComment').value.trim();

    if (window.supabaseClient) {
        try {
            // Retrieve report first to check permissions
            const { data: logData, error: logErr } = await window.supabaseClient
                .from('reading_reports')
                .select(`
                    *,
                    student:students(*)
                `)
                .eq('id', selectedGradingLogId)
                .single();

            if (logErr || !logData) throw new Error("ไม่พบบันทึกการอ่าน");

            const teacherAssignedLevel = window.teacherAssignedLevel || teacher.assignedLevel || 'ม.1';
            const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
            const assignedClassrooms = teacher.assignedClassrooms || [];

            if (!assignedGrades.includes(logData.student_level)) {
                throw new Error("ท่านไม่มีสิทธิ์ตรวจประเมินบันทึกการอ่านของระดับชั้นอื่น");
            }
            
            const student = logData.student;
            if (student) {
                const sLevel = formatLevel(student.level);
                const sClassroom = `${sLevel}/${student.room}`;
                if (assignedClassrooms.length > 0 && !assignedClassrooms.includes(sClassroom)) {
                    throw new Error("ท่านไม่มีสิทธิ์ตรวจประเมินบันทึกการอ่านของนักเรียนห้องอื่น");
                }
            }

            // Perform single database update. 
            // Recalculations are processed server-side in PostgreSql triggers.
            const { error: updateErr } = await window.supabaseClient
                .from('reading_reports')
                .update({
                    status: status,
                    score: status === 'approved' ? score : 0,
                    stars: status === 'approved' ? stars : 0,
                    teacher_comment: comment,
                    reviewed_by: teacher.teacherId || teacher.id,
                    reviewed_at: new Date().toISOString()
                })
                .eq('id', selectedGradingLogId);

            if (updateErr) throw updateErr;

            // Log activity in activity_logs
            const studentName = student ? `${student.prefix || ''}${student.first_name} ${student.last_name}` : logData.student_id;
            await window.supabaseClient
                .from('activity_logs')
                .insert({
                    action: status === 'approved' ? 'approve_reading_log' : 'reject_reading_log',
                    details: `${status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}บันทึกการอ่านของ ${studentName} เล่ม: ${logData.book_title}`,
                    performed_by: teacher.name
                });

            alert("บันทึกคะแนนเรียบร้อยแล้ว!");
            closeGradingModal();

            // Telegram Alert
            const statusEmoji = status === 'approved' ? '✅ อนุมัติการอ่าน' : '❌ ให้กลับไปแก้ไข';
            const studentLevel = logData.student_level || 'ม.1';
            const bookTitle = logData.book_title;
            const alertMsg = `<b>ประเมินผลบันทึกการอ่านหนังสือ</b>\nผู้ส่ง: ${studentName} (${formatClass(logData.student_level, logData.student_room)})\nเล่ม: ${bookTitle}\nผลประเมิน: ${statusEmoji}\nโดย: ${teacher.name}`;
            
            if (typeof sendTelegramMessageForLevel === 'function') {
                sendTelegramMessageForLevel(studentLevel, alertMsg);
            } else {
                sendTelegramMessage(alertMsg);
            }

            // Invalidate summaryCache when a report is graded
            summaryCache.lastFetched = 0;
            preloadSummaryData();
            if (typeof window.invalidateDashboardCache === 'function') {
                window.invalidateDashboardCache();
            }
        } catch (dbError) {
            console.error("Error submitting grade:", dbError);
            alert("ไม่สามารถบันทึกผลการประเมินได้: " + dbError.message);
        }
    } else {
        alert("ระบบทดลอง: ตรวจประเมินสำเร็จ");
        closeGradingModal();
    }
}

// Summary Dashboard Preload
async function preloadSummaryData() {
    const session = getSession();
    const teacher = session ? session.user : {};
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    const assignedClassrooms = teacher.assignedClassrooms || [];

    if (!window.db) {
        // Load mock data filtered by level and classroom
        cachedStudents = getMockSummaryStudents().filter(s => {
            const classroomName = `${formatLevel(s.level)}/${s.room}`;
            return assignedGrades.includes(s.level) && (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName));
        });
        cachedLogs = getMockSummaryLogs().filter(l => {
            const classroomName = `${formatLevel(l.studentLevel)}/${l.studentRoom || 1}`;
            return assignedGrades.includes(l.studentLevel) && (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName));
        });
        return;
    }
    
    // Clean up any existing listeners
    if (summaryStudentsUnsubscribe) {
        summaryStudentsUnsubscribe();
        summaryStudentsUnsubscribe = null;
    }
    if (summaryReportsUnsubscribe) {
        summaryReportsUnsubscribe();
        summaryReportsUnsubscribe = null;
    }

    const now = Date.now();
    const cacheTTL = 30000; // 30 seconds
    const targetYear = getActiveYear();

    // Check if the cache is valid for this academic year and is within TTL
    if (summaryCache.students && summaryCache.reports && 
        summaryCache.academicYear === targetYear && 
        (now - summaryCache.lastFetched) < cacheTTL) {
        console.log("Using cached summary data (TTL: 30s)");
        
        // Filter from cache
        cachedStudents = [];
        summaryCache.students.forEach(data => {
            const sLevel = formatLevel(data.level);
            const sRoom = data.room || 0;
            const classroomName = `${sLevel}/${sRoom}`;
            if (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName)) {
                cachedStudents.push(data);
            }
        });

        cachedLogs = [];
        summaryCache.reports.forEach(data => {
            const sLevel = formatLevel(data.studentLevel);
            const sRoom = data.studentRoom || 0;
            const classroomName = `${sLevel}/${sRoom}`;
            if (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName)) {
                cachedLogs.push(data);
            }
        });

        if (document.getElementById('tabSummaryContent').style.display !== 'none') {
            updateRealtimeSummary();
        }
        return;
    }

    try {
        console.log("Fetching summary data from Supabase (cache expired/invalid)");
        
        // Fetch students via one-time select
        const { data: dbStudents, error: sErr } = await window.supabaseClient
            .from('students')
            .select('*')
            .in('level', assignedGrades)
            .eq('academic_year', targetYear);
            
        if (sErr) throw sErr;
            
        const rawStudents = (dbStudents || []).map(s => ({
            id: s.id,
            studentId: s.student_id,
            prefix: s.prefix,
            firstName: s.first_name,
            lastName: s.last_name,
            level: s.level,
            room: s.room,
            number: s.number,
            academicYear: s.academic_year,
            totalBooks: s.total_books,
            totalScore: s.total_score,
            totalReadingTime: s.total_reading_time,
            totalPages: s.total_pages
        }));

        // Fetch reports via one-time select
        const { data: dbReports, error: rErr } = await window.supabaseClient
            .from('reading_reports')
            .select('*')
            .in('student_level', assignedGrades)
            .eq('academic_year', targetYear);

        if (rErr) throw rErr;

        const rawReports = (dbReports || []).map(r => ({
            id: r.id,
            studentProfileId: r.student_profile_id,
            studentId: r.student_id,
            academicYear: r.academic_year,
            studentLevel: r.student_level,
            studentRoom: r.student_room,
            entryNumber: r.entry_number,
            readDate: r.read_date,
            bookTitle: r.book_title,
            author: r.author,
            publisher: r.publisher,
            bookType: r.book_type,
            pageCount: r.page_count,
            readingTime: r.reading_time,
            summary: r.summary,
            lesson: r.lesson,
            application: r.application,
            reason: r.reason,
            newVocabulary: r.new_vocabulary,
            attachmentUrl: r.attachment_url,
            status: r.status,
            score: r.score,
            stars: r.stars,
            teacherComment: r.teacher_comment,
            reviewedBy: r.reviewed_by,
            reviewedAt: r.reviewed_at,
            createdAt: r.created_at
        }));

        // Save to cache
        summaryCache = {
            students: rawStudents,
            reports: rawReports,
            lastFetched: now,
            academicYear: targetYear
        };

        // Filter and update globals
        cachedStudents = [];
        rawStudents.forEach(data => {
            const sLevel = formatLevel(data.level);
            const sRoom = data.room || 0;
            const classroomName = `${sLevel}/${sRoom}`;
            if (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName)) {
                cachedStudents.push(data);
            }
        });

        cachedLogs = [];
        rawReports.forEach(data => {
            const sLevel = formatLevel(data.studentLevel);
            const sRoom = data.studentRoom || 0;
            const classroomName = `${sLevel}/${sRoom}`;
            if (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName)) {
                cachedLogs.push(data);
            }
        });

        if (document.getElementById('tabSummaryContent').style.display !== 'none') {
            updateRealtimeSummary();
        }
    } catch (err) {
        console.error("preloadSummaryData error:", err);
    }
}

// Populate Rooms in filter dropdown based on level selection and teacher assignments
function updateSummaryRooms() {
    const session = getSession();
    const teacher = session ? session.user : {};
    const levelVal = document.getElementById('filterLevel').value;
    const roomSelect = document.getElementById('filterRoom');
    roomSelect.innerHTML = '<option value="ทั้งหมด">ทั้งหมด</option>';
    
    if (levelVal === 'ทั้งหมด') {
        return;
    }
    
    const assignedClassrooms = teacher.assignedClassrooms || [];
    
    let totalRooms = 11;
    if (levelVal === 'ม.1' || levelVal === 'ม.2') {
        totalRooms = 13;
    } else if (levelVal === 'ม.3') {
        totalRooms = 12;
    } else if (levelVal === 'ม.4' || levelVal === 'ม.5' || levelVal === 'ม.6') {
        totalRooms = 11;
    }

    for (let r = 1; r <= totalRooms; r++) {
        const classroomName = `${formatLevel(levelVal)}/${r}`;
        if (assignedClassrooms.length === 0 || assignedClassrooms.includes(classroomName)) {
            const opt = document.createElement('option');
            opt.value = r.toString();
            opt.textContent = `ห้อง ${r}`;
            roomSelect.appendChild(opt);
        }
    }
}

// Filter and recalculate statistics dynamically
function updateRealtimeSummary() {
    const searchVal = document.getElementById('filterSearch').value.toLowerCase().trim();
    const session = getSession();
    const teacher = session ? session.user : {};
    const teacherAssignedLevel = window.teacherAssignedLevel || 'ม.1';
    const assignedGrades = teacher.assignedGrades || [teacherAssignedLevel];
    
    // Force level selection to match one of the assigned levels
    const filterLevelSelect = document.getElementById('filterLevel');
    if (filterLevelSelect && !assignedGrades.includes(filterLevelSelect.value)) {
        filterLevelSelect.value = assignedGrades[0];
    }
    
    const levelVal = filterLevelSelect ? filterLevelSelect.value : assignedGrades[0];
    const roomVal = document.getElementById('filterRoom').value;
    const startDateVal = document.getElementById('filterStartDate').value;
    const endDateVal = document.getElementById('filterEndDate').value;
    const sortVal = document.getElementById('filterSort').value;

    // 1. Filter students
    let filteredStudents = cachedStudents.filter(student => {
        if (levelVal !== 'ทั้งหมด') {
            const sLevel = formatLevel(student.level);
            const targetLevel = formatLevel(levelVal);
            if (sLevel !== targetLevel) return false;
        }
        if (roomVal !== 'ทั้งหมด') {
            if (student.room.toString() !== roomVal.toString()) return false;
        }
        if (searchVal) {
            const fullName = `${student.prefix || ''}${student.firstName} ${student.lastName}`.toLowerCase();
            const id = student.studentId.toLowerCase();
            if (!fullName.includes(searchVal) && !id.includes(searchVal)) return false;
        }
        return true;
    });

    // 2. Filter logs
    let filteredLogs = cachedLogs.filter(log => {
        if (log.status !== 'approved') return false;

        if (startDateVal) {
            const readDate = log.readDate?.toDate ? log.readDate.toDate() : new Date(log.readDate);
            const startDate = new Date(startDateVal);
            startDate.setHours(0,0,0,0);
            if (readDate < startDate) return false;
        }
        if (endDateVal) {
            const readDate = log.readDate?.toDate ? log.readDate.toDate() : new Date(log.readDate);
            const endDate = new Date(endDateVal);
            endDate.setHours(23,59,59,999);
            if (readDate > endDate) return false;
        }

        return filteredStudents.some(s => s.studentId === log.studentId);
    });

    // Statistics aggregation
    const totalStudentsCount = filteredStudents.length;
    const studentLogsMap = new Map();
    const studentPagesMap = new Map();
    const studentTimeMap = new Map();
    const studentPendingMap = new Map();
    
    filteredStudents.forEach(s => {
        studentLogsMap.set(s.studentId, 0);
        studentPagesMap.set(s.studentId, 0);
        studentTimeMap.set(s.studentId, 0);
        studentPendingMap.set(s.studentId, 0);
    });

    let totalPagesRead = 0;
    let totalTimeSpent = 0;
    
    filteredLogs.forEach(log => {
        const sId = log.studentId;
        if (studentLogsMap.has(sId)) {
            studentLogsMap.set(sId, studentLogsMap.get(sId) + 1);
            studentPagesMap.set(sId, studentPagesMap.get(sId) + (parseInt(log.pageCount) || 0));
            studentTimeMap.set(sId, studentTimeMap.get(sId) + (parseInt(log.readingTime) || 0));
        }
        totalPagesRead += (parseInt(log.pageCount) || 0);
        totalTimeSpent += (parseInt(log.readingTime) || 0);
    });

    // Count pending logs from cachedLogs for the current year
    const targetYear = getActiveYear();
    cachedLogs.forEach(log => {
        if (log.academicYear === targetYear && log.status === 'pending') {
            const sId = log.studentId;
            if (studentPendingMap.has(sId)) {
                studentPendingMap.set(sId, studentPendingMap.get(sId) + 1);
            }
        }
    });

    const submittedStudents = [];
    const notSubmittedStudents = [];

    filteredStudents.forEach(student => {
        const count = studentLogsMap.get(student.studentId) || 0;
        const pages = studentPagesMap.get(student.studentId) || 0;
        const time = studentTimeMap.get(student.studentId) || 0;
        const pendingCount = studentPendingMap.get(student.studentId) || 0;
        
        const studentSummary = {
            ...student,
            booksCount: count,
            pagesCount: pages,
            timeCount: time,
            pendingCount: pendingCount
        };

        // Submitted means having either approved or pending logs
        if (count > 0 || pendingCount > 0) {
            submittedStudents.push(studentSummary);
        } else {
            notSubmittedStudents.push(studentSummary);
        }
    });

    // Sort submitted students
    if (sortVal === 'number-asc') {
        submittedStudents.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
        notSubmittedStudents.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
    } else if (sortVal === 'books-desc') {
        submittedStudents.sort((a, b) => b.booksCount - a.booksCount);
    } else if (sortVal === 'pages-desc') {
        submittedStudents.sort((a, b) => b.pagesCount - a.pagesCount);
    } else if (sortVal === 'time-desc') {
        submittedStudents.sort((a, b) => b.timeCount - a.timeCount);
    }

    // Group books
    const booksMap = new Map();
    filteredLogs.forEach(log => {
        const key = `${log.bookTitle.trim()}||${log.author.trim()}||${log.bookType}`;
        if (booksMap.has(key)) {
            booksMap.set(key, booksMap.get(key) + 1);
        } else {
            booksMap.set(key, 1);
        }
    });

    const uniqueBooks = [];
    booksMap.forEach((count, key) => {
        const [title, author, type] = key.split('||');
        uniqueBooks.push({ title, author, type, count });
    });
    uniqueBooks.sort((a, b) => b.count - a.count);

    // Update UI Stats
    document.getElementById('sumSubmitted').textContent = `${submittedStudents.length} คน`;
    document.getElementById('sumNotSubmitted').textContent = `${notSubmittedStudents.length} คน`;
    document.getElementById('sumTotalBooks').textContent = `${filteredLogs.length} เล่ม`;
    document.getElementById('sumTotalPages').textContent = `${totalPagesRead} หน้า`;
    document.getElementById('sumTotalTime').textContent = `${totalTimeSpent} นาที`;
    
    const avg = totalStudentsCount > 0 ? (filteredLogs.length / totalStudentsCount).toFixed(1) : '0.0';
    document.getElementById('sumAverageBooks').textContent = `${avg} เล่ม`;

    let classLabel = 'สรุปภาพรวมทั้งหมด';
    if (levelVal !== 'ทั้งหมด') {
        classLabel = `สรุประดับชั้น ${formatLevel(levelVal)}`;
        if (roomVal !== 'ทั้งหมด') {
            classLabel += ` ห้อง ${roomVal}`;
        }
    }
    document.getElementById('summaryClassLabel').textContent = classLabel;

    // Render tables
    const subBody = document.getElementById('sumSubmittedBody');
    if (submittedStudents.length === 0) {
        subBody.innerHTML = `<tr><td colspan="5" class="text-center">ไม่มีข้อมูลนักเรียนที่ส่งในเงื่อนไขนี้</td></tr>`;
    } else {
        subBody.innerHTML = '';
        submittedStudents.forEach(s => {
            const tr = document.createElement('tr');
            
            let booksDisplay = `<span style="font-weight:700;">${s.booksCount} เล่ม</span>`;
            if (s.pendingCount > 0) {
                booksDisplay += ` <span class="status-badge pending" style="padding: 2px 6px; font-size: 0.75rem; margin-left: 5px;">รอตรวจ ${s.pendingCount} เล่ม</span>`;
            }

            tr.innerHTML = `
                <td>เลขที่ ${s.number}</td>
                <td><strong>${s.prefix || ''}${s.firstName} ${s.lastName}</strong></td>
                <td>${formatClass(s.level, s.room)}</td>
                <td>${booksDisplay} <span style="font-size:0.8rem;color:#777;">(${s.pagesCount} หน้า, ${s.timeCount} นาที)</span></td>
                <td>
                    <button class="btn" style="padding:0.4rem 0.8rem; font-size:0.8rem; background-color:var(--color-primary); color:white;" onclick="viewStudentProfile('${s.studentId}')">
                        ดูรายละเอียด
                    </button>
                </td>
            `;
            subBody.appendChild(tr);
        });
    }

    const notSubBody = document.getElementById('sumNotSubmittedBody');
    if (notSubmittedStudents.length === 0) {
        notSubBody.innerHTML = `<tr><td colspan="4" class="text-center">นักเรียนทุกคนส่งบันทึกครบถ้วนแล้ว!</td></tr>`;
    } else {
        notSubBody.innerHTML = '';
        notSubmittedStudents.forEach(s => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>เลขที่ ${s.number}</td>
                <td>${s.studentId}</td>
                <td><strong>${s.prefix || ''}${s.firstName} ${s.lastName}</strong></td>
                <td>${formatClass(s.level, s.room)}</td>
            `;
            notSubBody.appendChild(tr);
        });
    }

    const booksBody = document.getElementById('sumBooksBody');
    if (uniqueBooks.length === 0) {
        booksBody.innerHTML = `<tr><td colspan="4" class="text-center">ไม่พบรายการหนังสือ</td></tr>`;
    } else {
        booksBody.innerHTML = '';
        uniqueBooks.forEach(b => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${b.title}</strong></td>
                <td>${b.author || '-'}</td>
                <td>${b.type}</td>
                <td><span class="status-badge approved" style="font-size:0.85rem;">${b.count} ครั้ง</span></td>
            `;
            booksBody.appendChild(tr);
        });
    }
}

// Download Classroom Summary A4 PDF
async function downloadClassReportPDF() {
    const levelVal = document.getElementById('filterLevel').value;
    const roomVal = document.getElementById('filterRoom').value;
    
    let classText = 'ทุกระดับชั้น';
    if (levelVal !== 'ทั้งหมด') {
        classText = formatLevel(levelVal);
        if (roomVal !== 'ทั้งหมด') {
            classText += `/ ${roomVal}`;
        }
    }
    
    const teacher = JSON.parse(localStorage.getItem('userData')) || { name: 'คุณครูผู้ประเมิน' };
    
    document.getElementById('printReportMeta').textContent = `ระดับชั้น/ห้อง: ${classText} | วันที่สร้างรายงาน: ${formatThaiDate(new Date())}`;
    
    const submittedCountStr = document.getElementById('sumSubmitted').textContent;
    const notSubmittedCountStr = document.getElementById('sumNotSubmitted').textContent;
    const totalBooksStr = document.getElementById('sumTotalBooks').textContent;
    const totalPagesStr = document.getElementById('sumTotalPages').textContent;
    const totalTimeStr = document.getElementById('sumTotalTime').textContent;
    const averageBooksStr = document.getElementById('sumAverageBooks').textContent;
    
    const submittedCount = parseInt(submittedCountStr);
    const notSubmittedCount = parseInt(notSubmittedCountStr);
    const totalStudents = submittedCount + notSubmittedCount;
    
    document.getElementById('printTotalStudents').textContent = `${totalStudents} คน`;
    document.getElementById('printSubmittedCount').textContent = `${submittedCount} คน`;
    document.getElementById('printNotSubmittedCount').textContent = `${notSubmittedCount} คน`;
    document.getElementById('printTotalBooks').textContent = `${totalBooksStr}`;
    document.getElementById('printTotalPages').textContent = `${totalPagesStr}`;
    document.getElementById('printTotalTime').textContent = `${totalTimeStr}`;
    document.getElementById('printAverageBooks').textContent = `${averageBooksStr}`;
    
    document.getElementById('printTeacherName').textContent = `(${teacher.name})`;

    // Populate Tables in Print Layout
    const printSubBody = document.getElementById('printSubmittedTableBody');
    const printNotSubBody = document.getElementById('printNotSubmittedTableBody');
    const printBooksBody = document.getElementById('printBooksTableBody');
    
    // Submitted
    const subRows = document.querySelectorAll('#sumSubmittedBody tr');
    printSubBody.innerHTML = '';
    if (subRows.length > 0 && !subRows[0].textContent.includes('ไม่มีข้อมูล')) {
        subRows.forEach(row => {
            const cols = row.querySelectorAll('td');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border: 1px solid #000; padding: 6px;">${cols[0].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px;">-</td>
                <td style="border: 1px solid #000; padding: 6px;">${cols[1].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px; font-weight: bold;">${cols[3].textContent.split(' ')[0]} เล่ม</td>
            `;
            printSubBody.appendChild(tr);
        });
    } else {
        printSubBody.innerHTML = `<tr><td colspan="4" style="border: 1px solid #000; padding: 6px; text-align: center;">ไม่มีข้อมูลนักเรียนที่ส่ง</td></tr>`;
    }
    
    // Not Submitted
    const notSubRows = document.querySelectorAll('#sumNotSubmittedBody tr');
    printNotSubBody.innerHTML = '';
    if (notSubRows.length > 0 && !notSubRows[0].textContent.includes('นักเรียนทุกคน')) {
        notSubRows.forEach(row => {
            const cols = row.querySelectorAll('td');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border: 1px solid #000; padding: 6px;">${cols[0].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px;">${cols[1].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px;">${cols[2].textContent}</td>
            `;
            printNotSubBody.appendChild(tr);
        });
    } else {
        printNotSubBody.innerHTML = `<tr><td colspan="3" style="border: 1px solid #000; padding: 6px; text-align: center;">นักเรียนทุกคนส่งบันทึกครบถ้วนแล้ว</td></tr>`;
    }
    
    // Books
    const booksRows = document.querySelectorAll('#sumBooksBody tr');
    printBooksBody.innerHTML = '';
    if (booksRows.length > 0 && !booksRows[0].textContent.includes('ไม่พบรายการหนังสือ')) {
        booksRows.forEach(row => {
            const cols = row.querySelectorAll('td');
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="border: 1px solid #000; padding: 6px;">${cols[0].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px;">${cols[1].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px;">${cols[2].textContent}</td>
                <td style="border: 1px solid #000; padding: 6px; text-align: center;">${cols[3].textContent}</td>
            `;
            printBooksBody.appendChild(tr);
        });
    } else {
        printBooksBody.innerHTML = `<tr><td colspan="4" style="border: 1px solid #000; padding: 6px; text-align: center;">ไม่มีข้อมูลหนังสือ</td></tr>`;
    }
    
    // Generate A4 PDF using Canvas Overlay (highly compatible with Thai font)
    const container = document.getElementById('classReportPrintContainer');
    container.style.left = '0px';
    container.style.top = '0px';
    container.style.zIndex = '-1';
    
    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
        
        const imgX = (pdfWidth - imgWidth * ratio) / 2;
        const imgY = 0;
        
        pdf.addImage(imgData, 'JPEG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);
        
        const filename = `รายงานห้องเรียน_${classText.replace(/[\s/]/g, '')}.pdf`;
        pdf.save(filename);
        
        if (window.supabaseClient) {
            await window.supabaseClient
                .from('activity_logs')
                .insert({
                    action: 'DOWNLOAD_CLASS_REPORT',
                    details: `ดาวน์โหลดรายงานห้องเรียนระดับ ${classText} (ส่งแล้ว: ${submittedCount} คน, ยังไม่ส่ง: ${notSubmittedCount} คน, หนังสือ: ${totalBooksStr} เล่ม, หน้า: ${totalPagesStr} หน้า)`,
                    performed_by: teacher.name || 'คุณครู'
                });
        }
    } catch (err) {
        console.error("Failed to generate Class Report PDF:", err);
        alert("ไม่สามารถสร้าง PDF ได้: " + err.message);
    } finally {
        container.style.left = '-9999px';
        container.style.top = '-9999px';
    }
}

// Print summary report
function printReport() {
    const container = document.getElementById('classReportPrintContainer');
    const printWindow = window.open('', '_blank', 'width=800,height=600');
    printWindow.document.write(`
        <html>
            <head>
                <title>พิมพ์รายงานสรุปผล</title>
                <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700&display=swap" rel="stylesheet">
                <style>
                    body { font-family: 'Sarabun', sans-serif; padding: 20px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 10px; margin-bottom: 20px; }
                    th, td { border: 1px solid #000; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    h2, h3, h4 { margin: 5px 0; }
                </style>
            </head>
            <body>
                ${container.innerHTML}
                <script>
                    window.onload = function() {
                        window.print();
                        window.close();
                    }
                </script>
            </body>
        </html>
    `);
    printWindow.document.close();
}

// Download Individual One Page Summary PDF
async function downloadIndividualOnePagePDF() {
    if (!activeProfileStudentId) return;
    
    const teacher = JSON.parse(localStorage.getItem('userData')) || { name: 'คุณครูผู้ประเมิน' };
    
    let student = cachedStudents.find(s => s.studentId === activeProfileStudentId);
    if (!student) {
        student = { studentId: activeProfileStudentId, prefix: 'เด็กชาย', firstName: 'ทดสอบ', lastName: 'ระบบ', level: 'ม.1', room: 1, number: 1 };
    }
    
    const studentName = `${student.prefix || ''}${student.firstName} ${student.lastName}`;
    const classText = formatClass(student.level, student.room);
    
    // Update HTML metadata in print container
    document.getElementById('printIndivStudentMeta').textContent = `นักเรียน: ${studentName} | ระดับชั้น/ห้อง: ${classText} | เลขที่: ${student.number}`;
    
    // Filter approved logs for this student
    const studentLogs = cachedLogs.filter(log => log.studentId === activeProfileStudentId && log.status === 'approved');
    
    const booksCount = studentLogs.length;
    const totalPages = studentLogs.reduce((sum, log) => sum + (parseInt(log.pageCount) || 0), 0);
    const totalTime = studentLogs.reduce((sum, log) => sum + (parseInt(log.readingTime) || 0), 0);
    
    document.getElementById('printIndivCount').textContent = `${booksCount} ครั้ง`;
    document.getElementById('printIndivPages').textContent = `${totalPages} หน้า`;
    document.getElementById('printIndivTime').textContent = `${totalTime} นาที`;
    
    const printIndivBody = document.getElementById('printIndivTableBody');
    printIndivBody.innerHTML = '';
    
    if (studentLogs.length > 0) {
        studentLogs.forEach(log => {
            const tr = document.createElement('tr');
            const dateStr = log.readDate ? formatThaiDate(log.readDate) : '-';
            tr.innerHTML = `
                <td style="border: 1px solid #000; padding: 6px; text-align: center;">ครั้งที่ ${log.entryNumber}</td>
                <td style="border: 1px solid #000; padding: 6px;">${dateStr}</td>
                <td style="border: 1px solid #000; padding: 6px;"><strong>${log.bookTitle}</strong></td>
                <td style="border: 1px solid #000; padding: 6px;">${log.author}</td>
                <td style="border: 1px solid #000; padding: 6px; text-align: center;">${log.pageCount} หน้า</td>
                <td style="border: 1px solid #000; padding: 6px; text-align: center; font-weight: bold; color: green;">${log.score}/10</td>
            `;
            printIndivBody.appendChild(tr);
        });
    } else {
        printIndivBody.innerHTML = `<tr><td colspan="6" style="border: 1px solid #000; padding: 6px; text-align: center;">ไม่มีประวัติการส่งบันทึกที่อนุมัติ</td></tr>`;
    }
    
    // Generate Individual PDF
    const container = document.getElementById('individualReportPrintContainer');
    container.style.left = '0px';
    container.style.top = '0px';
    container.style.zIndex = '-1';
    
    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = canvas.width;
        const imgHeight = canvas.height;
        const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
        
        const imgX = (pdfWidth - imgWidth * ratio) / 2;
        const imgY = 0;
        
        pdf.addImage(imgData, 'JPEG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);
        
        const filename = `สรุปผลการอ่าน_${studentName}.pdf`;
        pdf.save(filename);
        
        if (window.supabaseClient) {
            await window.supabaseClient
                .from('activity_logs')
                .insert({
                    action: 'DOWNLOAD_INDIVIDUAL_REPORT',
                    details: `ดาวน์โหลดสรุปประวัติการอ่านรายบุคคลของ: ${studentName}`,
                    performed_by: teacher.name || 'คุณครู'
                });
        }
    } catch (err) {
        console.error("Failed to generate Individual PDF:", err);
        alert("ไม่สามารถสร้าง PDF ได้: " + err.message);
    } finally {
        container.style.left = '-9999px';
        container.style.top = '-9999px';
    }
}

// Mock rosters generator
function getMockStudents(level, room) {
    return [
        { number: 1, studentId: '36113', prefix: 'เด็กชาย', firstName: 'กนกพล', lastName: 'ชุนเกษา', level: level, room: room, totalBooks: 2 },
        { number: 2, studentId: '36114', prefix: 'เด็กชาย', firstName: 'กรภัทร', lastName: 'ถ้ำกลาง', level: level, room: room, totalBooks: 5 }
    ];
}

function getMockQueue() {
    return [
        {
            id: 'mock_pending_1',
            studentId: '36113',
            studentName: 'ด.ช. กนกพล ชุนเกษา (ม.1/1)',
            readDate: new Date(),
            bookTitle: 'คิตะยะ ร้านหนังสือเครื่องเขียนเวทมนตร์',
            author: 'Katsuya',
            publisher: 'Bookscape',
            bookType: 'ทั่วไป',
            pageCount: 15,
            readingTime: 45,
            summary: 'เรื่องราวของร้านหนังสือวิเศษที่กระดาษเขียนจดหมายสามารถแปลงเวทมนตร์ให้ความรู้สึกผู้ส่งถึงผู้รับสัมผัสได้จริง',
            lesson: 'การสื่อความรู้สึกที่จริงใจสามารถแก้ไขความเข้าใจผิดของคนเราได้',
            attachmentUrl: ''
        }
    ];
}

function getMockSummaryStudents() {
    return [
        { studentId: '36113', prefix: 'เด็กชาย', firstName: 'กนกพล', lastName: 'ชุนเกษา', level: 'ม.1', room: 1, number: 1 },
        { studentId: '36114', prefix: 'เด็กชาย', firstName: 'กรภัทร', lastName: 'ถ้ำกลาง', level: 'ม.1', room: 1, number: 2 },
        { studentId: '36115', prefix: 'เด็กหญิง', firstName: 'นงลักษณ์', lastName: 'รักเรียน', level: 'ม.1', room: 1, number: 3 },
        { studentId: '36116', prefix: 'เด็กหญิง', firstName: 'ศิริรัตน์', lastName: 'ขยันอ่าน', level: 'ม.1', room: 2, number: 1 }
    ];
}

function getMockSummaryLogs() {
    return [
        {
            id: 'log1',
            studentId: '36113',
            entryNumber: 1,
            readDate: new Date(),
            bookTitle: 'คิตะยะ ร้านหนังสือเครื่องเขียนเวทมนตร์',
            author: 'Katsuya',
            publisher: 'Bookscape',
            bookType: 'ทั่วไป',
            pageCount: 15,
            readingTime: 45,
            status: 'approved',
            score: 9,
            stars: 4
        },
        {
            id: 'log2',
            studentId: '36114',
            entryNumber: 1,
            readDate: new Date(),
            bookTitle: 'แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์',
            author: 'J.K. Rowling',
            publisher: 'นานมีบุ๊คส์',
            bookType: 'นวนิยาย',
            pageCount: 30,
            readingTime: 60,
            status: 'approved',
            score: 10,
            stars: 5
        }
    ];
}
