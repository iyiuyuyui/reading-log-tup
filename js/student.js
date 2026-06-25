/**
 * Student Dashboard Module (Supabase Cloud Edition)
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Guard check auth (allow only 'student' role)
    const session = checkAuth(['student']);
    if (!session) return; // Will auto-redirect in checkAuth if not valid

    const student = session.user;
    
    // 2. Render Student Metadata in Header
    const headerUserMeta = document.getElementById('headerUserMeta');
    if (headerUserMeta) {
        headerUserMeta.innerHTML = `
            <span style="font-weight:700;">${student.prefix || ''}${student.firstName} ${student.lastName}</span>
            &nbsp;|&nbsp; ชั้น ${formatLevel(student.level)} ห้อง ${student.room} เลขที่ ${student.number}
            &nbsp;|&nbsp; ปีการศึกษา ${student.academicYear || '2568'}
        `;
    }

    // Initialize Academic Year Selector
    const activeYear = getActiveYear();
    if (typeof populateYearSelector === 'function') {
        await populateYearSelector('globalYearSelect', activeYear);
    }

    // 3. Load & Render Reading Data
    loadReadingHistory(student.studentId);
    loadBadges(student.studentId);
    
    // 4. Setup Form submit
    const readingForm = document.getElementById('readingLogForm');
    if (readingForm) {
        readingForm.addEventListener('submit', (e) => handleReadingSubmit(e, student));
    }
});

async function handleGlobalYearChange(year) {
    if (!year) return;
    window.currentAcademicYear = year;
    sessionStorage.setItem('currentAcademicYear', year);
    showToast(`เปลี่ยนปีการศึกษาเป็น ${year}`, 'success');

    const session = getSession();
    if (session && session.user) {
        // Query the corresponding students table record for the new year to fetch correct profile ID
        try {
            const { data } = await window.supabaseClient
                .from('students')
                .select('*')
                .eq('student_id', session.user.studentId)
                .eq('academic_year', year)
                .maybeSingle();
            
            if (data) {
                session.user.id = data.id;
                session.user.level = data.level;
                session.user.room = data.room;
                session.user.number = data.number;
                session.user.academicYear = data.academic_year;
                setSession(session);
                
                // Update Metadata in Header
                const headerUserMeta = document.getElementById('headerUserMeta');
                if (headerUserMeta) {
                    headerUserMeta.innerHTML = `
                        <span style="font-weight:700;">${session.user.prefix || ''}${session.user.firstName} ${session.user.lastName}</span>
                        &nbsp;|&nbsp; ชั้น ${formatLevel(session.user.level)} ห้อง ${session.user.room} เลขที่ ${session.user.number}
                        &nbsp;|&nbsp; ปีการศึกษา ${session.user.academicYear}
                    `;
                }
            }
        } catch (e) {
            console.error("Year change reload profile error:", e);
        }

        loadReadingHistory(session.user.studentId);
        loadBadges(session.user.studentId);
    }
}
window.handleGlobalYearChange = handleGlobalYearChange;

// Toggle Accordion Panels
function toggleAccordion(id) {
    const trigger = document.querySelector(`[onclick="toggleAccordion('${id}')"]`);
    const content = document.getElementById(`${id}Content`);
    
    if (!content) return;
    
    if (content.classList.contains('open')) {
        content.classList.remove('open');
        if (trigger) trigger.classList.remove('active');
    } else {
        // Close other accordion tabs
        document.querySelectorAll('.accordion-content').forEach(c => c.classList.remove('open'));
        document.querySelectorAll('.accordion-trigger').forEach(t => t.classList.remove('active'));
        
        content.classList.add('open');
        if (trigger) trigger.classList.add('active');
    }
}
window.toggleAccordion = toggleAccordion;

// Modal Form handling
function openReadingForm() {
    const modal = document.getElementById('readingModal');
    if (modal) modal.classList.add('open');
    const readDate = document.getElementById('readDate');
    if (readDate) readDate.valueAsDate = new Date();
}
window.openReadingForm = openReadingForm;

function closeReadingForm() {
    const modal = document.getElementById('readingModal');
    if (modal) modal.classList.remove('open');
    const form = document.getElementById('readingLogForm');
    if (form) form.reset();
}
window.closeReadingForm = closeReadingForm;

// Load and Render student reading records from Supabase
async function loadReadingHistory(studentId) {
    const tableBody = document.getElementById('logsTableBody');
    if (!window.supabaseClient) {
        // Connect mock logs table
        renderLogsTable(getMockLogs());
        updateDashboardStats(getMockLogs());
        return;
    }

    try {
        const targetYear = getActiveYear();
        const { data: dbReports, error } = await window.supabaseClient
            .from('reading_reports')
            .select('*')
            .eq('student_id', String(studentId).trim())
            .eq('academic_year', targetYear);

        if (error) throw error;

        // Map DB snake_case schema to frontend camelCase properties
        const logs = (dbReports || []).map(r => ({
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

        // Sort in memory by entryNumber descending
        logs.sort((a, b) => (parseInt(b.entryNumber) || 0) - (parseInt(a.entryNumber) || 0));

        renderLogsTable(logs);
        updateDashboardStats(logs);
        
        // Update Auto-Increment Field in form
        const nextNum = logs.length > 0 ? Math.max(...logs.map(l => l.entryNumber || 0)) + 1 : 1;
        const entryNumField = document.getElementById('entryNumber');
        if (entryNumField) entryNumField.value = nextNum;
        
    } catch (error) {
        console.error("Error loading logs:", error);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--color-danger)">ไม่สามารถโหลดข้อมูลประวัติการบันทึกได้: ${error.message}</td></tr>`;
        }
    }
}
window.loadReadingHistory = loadReadingHistory;

function renderLogsTable(logs) {
    const tableBody = document.getElementById('logsTableBody');
    if (!tableBody) return;
    
    if (logs.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center">ไม่มีข้อมูลประวัติการอ่าน เริ่มต้นบันทึกหนังสือเล่มแรกเลย!</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';
    logs.forEach(log => {
        const tr = document.createElement('tr');
        
        const dateStr = log.readDate ? formatThaiDate(log.readDate) : '-';
        
        // Stars/Score render
        let scoreDisplay = '-';
        if (log.status === 'approved') {
            const stars = '⭐'.repeat(log.stars || 0);
            scoreDisplay = `<div><strong>${log.score}/10</strong></div><div>${stars}</div>`;
        }
        
        // Status class
        let statusText = 'รอตรวจ';
        let statusClass = 'pending';
        if (log.status === 'approved') { statusText = 'อนุมัติ'; statusClass = 'approved'; }
        else if (log.status === 'rejected') { statusText = 'ไม่อนุมัติ'; statusClass = 'rejected'; }

        tr.innerHTML = `
            <td>ครั้งที่ ${log.entryNumber}</td>
            <td>${dateStr}</td>
            <td><strong>${log.bookTitle}</strong><div style="font-size:0.8rem;color:var(--color-text-light)">ผู้แต่ง: ${log.author || '-'}</div></td>
            <td>${log.bookType || '-'}</td>
            <td>${scoreDisplay}</td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
        `;
        tableBody.appendChild(tr);
    });
}

function updateDashboardStats(logs) {
    const approvedLogs = logs.filter(l => l.status === 'approved');
    
    // Calculations
    const totalBooks = approvedLogs.length;
    const totalPages = approvedLogs.reduce((sum, log) => sum + (parseInt(log.pageCount) || 0), 0);
    const totalTime = approvedLogs.reduce((sum, log) => sum + (parseInt(log.readingTime) || 0), 0);
    const totalScore = approvedLogs.reduce((sum, log) => sum + (parseFloat(log.score) || 0), 0);
    
    const statBooks = document.getElementById('statBooks');
    const statPages = document.getElementById('statPages');
    const statTime = document.getElementById('statTime');
    const statScore = document.getElementById('statScore');
    
    if (statBooks) statBooks.textContent = `${totalBooks} เล่ม`;
    if (statPages) statPages.textContent = `${totalPages} หน้า`;
    if (statTime) statTime.textContent = `${totalTime} นาที`;
    if (statScore) statScore.textContent = `${totalScore.toFixed(1)} คะแนน`;
}

// Upload file to Supabase Storage bucket (private)
async function uploadToSupabaseStorage(file, studentId) {
    if (!window.supabaseClient) throw new Error("ระบบฝากรูปยังไม่ได้เชื่อมต่อ");
    const year = getActiveYear();
    const cleanFileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const filePath = `uploads/students/${studentId}/${year}/${cleanFileName}`;

    const { data, error } = await window.supabaseClient.storage
        .from('reading-attachments')
        .upload(filePath, file);

    if (error) {
        throw new Error("อัปโหลดไฟล์ล้มเหลว: " + error.message);
    }

    // Generate signed URL valid for 1 year
    const { data: signedData, error: signedError } = await window.supabaseClient.storage
        .from('reading-attachments')
        .createSignedUrl(filePath, 60 * 60 * 24 * 365);

    if (signedError) {
        throw new Error("สร้างลิงก์เข้าถึงรูปภาพล้มเหลว: " + signedError.message);
    }

    return signedData.signedUrl;
}

// Handle submit new reading log record
async function handleReadingSubmit(e, student) {
    e.preventDefault();
    
    // File upload logic (Optional attachment)
    const fileInput = document.getElementById('bookFile');
    let fileUrl = '';
    
    if (fileInput && fileInput.files.length > 0) {
        const file = fileInput.files[0];
        try {
            fileUrl = await uploadToSupabaseStorage(file, student.studentId);
        } catch (uploadError) {
            console.error("File upload failed:", uploadError);
            alert("แนบไฟล์รูปไม่สำเร็จ: " + uploadError.message + "\n(จะดำเนินการส่งข้อมูลประวัติการอ่านต่อโดยไม่มีรูปภาพ)");
        }
    }

    const docData = {
        student_profile_id: student.id, // Yearly Profile UUID (Foreign Key)
        student_id: student.studentId,
        student_level: formatLevel(student.level),
        student_room: parseInt(student.room) || 0,
        academic_year: getActiveYear(),
        entry_number: parseInt(document.getElementById('entryNumber').value),
        read_date: document.getElementById('readDate').value,
        book_title: document.getElementById('bookTitle').value.trim(),
        author: document.getElementById('author').value.trim(),
        publisher: document.getElementById('publisher').value.trim(),
        book_type: document.getElementById('bookType').value,
        page_count: parseInt(document.getElementById('pageCount').value) || 0,
        reading_time: parseInt(document.getElementById('readingTime').value) || 0,
        summary: document.getElementById('summary').value.trim(),
        lesson: document.getElementById('lesson').value.trim(),
        application: document.getElementById('application').value.trim(),
        reason: document.getElementById('reason').value.trim(),
        new_vocabulary: document.getElementById('newVocabulary').value.trim(),
        attachment_url: fileUrl,
        status: 'pending',
        score: 0,
        stars: 0
    };
    
    if (window.supabaseClient) {
        try {
            // Write to database reading_reports
            const { error: dbError } = await window.supabaseClient
                .from('reading_reports')
                .insert(docData);

            if (dbError) throw dbError;

            closeReadingForm();
            loadReadingHistory(student.studentId);
            alert("ส่งบันทึกการอ่านเรียบร้อยแล้ว รอการอนุมัติจากครู!");
            
            // Telegram Alert to notify teachers (Routes via server-side Edge Function)
            const studentName = `${student.prefix || ''}${student.firstName} ${student.lastName}`;
            const alertText = `📗 <b>มีผู้ส่งบันทึกการอ่านใหม่</b>\nผู้ส่ง: ${studentName} (${formatClass(student.level, student.room)} เลขที่ ${student.number})\nหนังสือ: ${docData.book_title}\nประเภท: ${docData.book_type} (${docData.page_count} หน้า)`;
            
            if (typeof sendTelegramMessageForLevel === 'function') {
                sendTelegramMessageForLevel(student.level, alertText);
            } else {
                sendTelegramMessage(alertText);
            }
            
        } catch (dbError) {
            console.error("Error adding document:", dbError);
            alert("ไม่สามารถบันทึกข้อมูลลงฐานข้อมูลได้: " + dbError.message);
        }
    } else {
        alert("ระบบทดลอง: บันทึกสำเร็จชั่วคราว");
        closeReadingForm();
    }
}

// Mock logs data fallback
function getMockLogs() {
    return [
        {
            id: 'mock1',
            entryNumber: 1,
            readDate: new Date(),
            bookTitle: 'แฮร์รี่ พอตเตอร์ กับศิลาอาถรรพ์',
            author: 'J.K. Rowling',
            publisher: 'นานมีบุ๊คส์',
            bookType: 'นวนิยาย',
            pageCount: 30,
            readingTime: 60,
            summary: 'เรื่องราวของเด็กชายผู้รอดชีวิตที่ค้นพบว่าตัวเองเป็นพ่อมดและได้เข้าเรียนโรงเรียนฮอกวอตส์',
            lesson: 'มิตรภาพและความกล้าหาญคือพลังที่ยิ่งใหญ่ที่สุด',
            application: 'การใช้ความสามัคคีและมิตรภาพในการแก้ไขปัญหาต่างๆ ในชีวิตประจำวัน',
            reason: 'เนื่องจากเป็นหนังสือที่ได้รับความนิยมสูงและมีข้อคิดที่น่าสนใจเกี่ยวกับมิตรภาพ',
            newVocabulary: 'ศิลาอาถรรพ์ หมายถึง หินวิเศษที่ให้ชีวิตเป็นอมตะ',
            status: 'approved',
            score: 10,
            stars: 5
        }
    ];
}
