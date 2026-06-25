/**
 * Admin Dashboard Module
 */

// State variables for student management & dashboard
let allStudents = [];
let filteredStudents = [];
let allReadingReports = [];
let activeDataset = null;

let currentPage = 1;
let pageSize = 25;
let sortBy = 'studentId';
let sortOrder = 'asc';
let pageCursors = {};
let searchTimeout = null;

let selectedStudentIds = new Set();
let currentWorkbook = null;
let currentWorkbookName = "";
let parsedStudentsPreview = [];
let weeklyChartInstance = null;

// Initialize real-time listeners for Firebase collections
let statsUnsubscribe = null;
let trendsUnsubscribe = null;
let studentsUnsubscribe = null;
let yearsUnsubscribe = null;

// Dashboard caches (30-second TTL)
const cacheTTL = 30000; // 30 seconds
let statsCache = {
    data: null,
    lastFetched: 0,
    academicYear: null
};
let trendsCacheObj = {
    data: null,
    lastFetched: 0,
    academicYear: null
};
let systemStatsCacheObj = {
    data: null,
    lastFetched: 0
};

// Centralized cache invalidator helper
function invalidateDashboardCache() {
    console.log("[CACHE] Invalidating all dashboard statistics caches");
    statsCache.lastFetched = 0;
    trendsCacheObj.lastFetched = 0;
    systemStatsCacheObj.lastFetched = 0;
    
    // Trigger refetching of dashboard statistics instantly if we are on dashboard
    const targetYear = getActiveYear();
    fetchSystemStatsDashboard();
    fetchDashboardStatistics(targetYear);
    fetchWeeklyReadingTrends(targetYear);
}
window.invalidateDashboardCache = invalidateDashboardCache;

document.addEventListener('DOMContentLoaded', () => {
    // 1. Guard check auth (allow only 'admin' role)
    const session = checkAuth(['admin']);
    if (!session) return;

    // 2. Setup sidebar navigation clicks
    const sidebarLinks = document.querySelectorAll('.sidebar-link');
    const adminSections = document.querySelectorAll('.admin-section');
    
    sidebarLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            
            sidebarLinks.forEach(l => l.classList.remove('active'));
            adminSections.forEach(s => s.classList.remove('active'));
            
            link.classList.add('active');
            
            const targetId = `${link.dataset.target}Sec`;
            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
            }
        });
    });

    // 3. Load Admin Data
    initRealtimeListeners();
    seedTeachersIfEmpty().then(() => {
        loadTeachersList();
    });
    loadSettings();

    // 4. Setup Settings submit handler
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', saveSettings);
    }

    const tgConfigsForm = document.getElementById('telegramConfigsForm');
    if (tgConfigsForm) {
        tgConfigsForm.addEventListener('submit', saveTelegramConfigs);
    }

    // 5. Setup Add Teacher submit handler
    const addTeacherForm = document.getElementById('addTeacherForm');
    if (addTeacherForm) {
        addTeacherForm.addEventListener('submit', handleAddTeacherSubmit);
    }
    
    // 6. Setup teacher form grades/classrooms handlers
    document.querySelectorAll('input[name="assignedGrades"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const currentCheckedRooms = Array.from(document.querySelectorAll('input[name="assignedClassrooms"]:checked')).map(c => c.value);
            updateTeacherFormClassrooms(currentCheckedRooms);
        });
    });
    
    const cancelEditBtn = document.getElementById('btnCancelEditTeacher');
    if (cancelEditBtn) {
        cancelEditBtn.addEventListener('click', resetTeacherForm);
    }

    // Initial load for student pagination roster
    currentPage = 1;
    pageCursors = {};
    loadStudentsPage();
});



// Caching / Fetching Helpers with temporary debug logging
// Caching / Fetching Helpers with temporary debug logging
async function fetchDashboardStatistics(targetYear) {
    if (!window.supabaseClient) return;
    const now = Date.now();
    if (statsCache.data && statsCache.academicYear === targetYear && (now - statsCache.lastFetched) < cacheTTL) {
        if (typeof DEBUG_FIRESTORE !== 'undefined' && DEBUG_FIRESTORE) {
            console.log("[CACHE] [DEBUG] dashboard_statistics reads: serving from cache");
        }
        window.systemStats = statsCache.data;
        renderDashboardStats(statsCache.data);
        return;
    }

    try {
        console.warn(`[CACHE] [DEBUG] dashboard_statistics reads: fetching from Supabase for year ${targetYear}`);
        
        // Fetch students via one-time select
        const { data: studentsData, error: sErr } = await window.supabaseClient
            .from('students')
            .select('level, room, student_id')
            .eq('academic_year', targetYear);
            
        if (sErr) throw sErr;

        // Fetch reports via one-time select
        const { data: reportsData, error: rErr } = await window.supabaseClient
            .from('reading_reports')
            .select('student_level, student_room, student_id, status')
            .eq('academic_year', targetYear);

        if (rErr) throw rErr;

        // Fetch teachers count (not year-dependent)
        const { count: teachersCount, error: tErr } = await window.supabaseClient
            .from('teachers')
            .select('*', { count: 'exact', head: true });

        if (tErr) throw tErr;

        let approvedReports = 0;
        let pendingReports = 0;
        const activeStudentsSet = new Set();
        
        reportsData.forEach(r => {
            if (r.status === 'approved') {
                activeStudentsSet.add(r.student_id);
                approvedReports++;
            } else if (r.status === 'pending') {
                pendingReports++;
            }
        });

        const aggregatedStats = {
            totalStudents: studentsData.length,
            totalTeachers: teachersCount || 0,
            approvedReports: approvedReports,
            pendingReports: pendingReports,
            activeStudents: activeStudentsSet.size,
            totalLogs: reportsData.length,
            byGrade: { "ม.1": 0, "ม.2": 0, "ม.3": 0, "ม.4": 0, "ม.5": 0, "ม.6": 0 },
            byClassroom: {}
        };

        studentsData.forEach(s => {
            const lvl = s.level;
            const rm = s.room || 0;
            const classKey = `${lvl}/${rm}`;

            if (aggregatedStats.byGrade[lvl] !== undefined) {
                aggregatedStats.byGrade[lvl]++;
            }
            aggregatedStats.byClassroom[classKey] = (aggregatedStats.byClassroom[classKey] || 0) + 1;
        });

        statsCache = {
            data: aggregatedStats,
            lastFetched: now,
            academicYear: targetYear
        };

        window.systemStats = aggregatedStats;
        renderDashboardStats(aggregatedStats);
    } catch (err) {
        console.error("fetchDashboardStatistics error:", err);
    }
}

async function fetchWeeklyReadingTrends(targetYear) {
    if (!window.supabaseClient) return;
    const now = Date.now();
    if (trendsCacheObj.data && trendsCacheObj.academicYear === targetYear && (now - trendsCacheObj.lastFetched) < cacheTTL) {
        if (typeof DEBUG_FIRESTORE !== 'undefined' && DEBUG_FIRESTORE) {
            console.log("[CACHE] [DEBUG] weekly_reading_trends reads: serving from cache");
        }
        window.weeklyReadingTrends = trendsCacheObj.data;
        updateAnalyticsChart();
        return;
    }

    try {
        console.warn(`[CACHE] [DEBUG] weekly_reading_trends reads: fetching from Supabase for year ${targetYear}`);
        const { data: reportsData, error } = await window.supabaseClient
            .from('reading_reports')
            .select('reviewed_at')
            .eq('academic_year', targetYear)
            .eq('status', 'approved');

        if (error) throw error;

        const aggregatedTrends = {
            daily: {},
            monthly: {},
            yearly: {}
        };
        
        (reportsData || []).forEach(r => {
            const date = r.reviewed_at ? new Date(r.reviewed_at) : null;
            if (date) {
                const dateStr = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
                const monthStr = dateStr.substring(0, 7);
                const yearStr = dateStr.substring(0, 4);
                
                aggregatedTrends.daily[dateStr] = (aggregatedTrends.daily[dateStr] || 0) + 1;
                aggregatedTrends.monthly[monthStr] = (aggregatedTrends.monthly[monthStr] || 0) + 1;
                aggregatedTrends.yearly[yearStr] = (aggregatedTrends.yearly[yearStr] || 0) + 1;
            }
        });

        trendsCacheObj = {
            data: aggregatedTrends,
            lastFetched: now,
            academicYear: targetYear
        };

        window.weeklyReadingTrends = aggregatedTrends;
        updateAnalyticsChart();
    } catch (err) {
        console.error("fetchWeeklyReadingTrends error:", err);
    }
}

async function fetchSystemStatsDashboard() {
    const targetYear = getActiveYear();
    await fetchDashboardStatistics(targetYear);
}

function renderSystemStatsDashboard(stats) {
    // Deprecated. renderDashboardStats handles all updates now.
}

let yearsChannel = null;
let activeDatasetChannel = null;
let statsRealtimeChannel = null;

function setupPartitionedRealtimeListeners() {
    const targetYear = getActiveYear();
    
    if (yearsChannel) {
        window.supabaseClient.removeChannel(yearsChannel);
        yearsChannel = null;
    }
    if (statsRealtimeChannel) {
        window.supabaseClient.removeChannel(statsRealtimeChannel);
        statsRealtimeChannel = null;
    }

    if (!window.supabaseClient) return;

    yearsChannel = window.supabaseClient
        .channel('academic_years_changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'academic_years' },
            (payload) => {
                if (typeof loadAcademicYears === 'function') {
                    loadAcademicYears();
                }
            }
        )
        .subscribe();

    statsRealtimeChannel = window.supabaseClient
        .channel('dashboard_stats_changes')
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'students' },
            (payload) => {
                console.log("[REALTIME] Students table change detected:", payload);
                invalidateDashboardCache();
            }
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'reading_reports' },
            (payload) => {
                console.log("[REALTIME] Reading reports table change detected:", payload);
                invalidateDashboardCache();
            }
        )
        .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'teachers' },
            (payload) => {
                console.log("[REALTIME] Teachers table change detected:", payload);
                invalidateDashboardCache();
            }
        )
        .subscribe();

    fetchDashboardStatistics(targetYear);
    fetchWeeklyReadingTrends(targetYear);
    loadStudentsPage();
}

function initRealtimeListeners() {
    if (!window.supabaseClient) {
        console.warn("Supabase not connected, loading mock analytics");
        loadMockAnalytics();
        return;
    }

    if (activeDatasetChannel) {
        window.supabaseClient.removeChannel(activeDatasetChannel);
        activeDatasetChannel = null;
    }

    activeDatasetChannel = window.supabaseClient
        .channel('active_dataset_changes')
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'school_settings' },
            (payload) => {
                if (payload.new && payload.new.key === 'active_dataset') {
                    loadActiveDatasetFromSettings();
                }
            }
        )
        .subscribe();

    loadActiveDatasetFromSettings();
    fetchSystemStatsDashboard();

    initAcademicYear().then(async (year) => {
        await populateYearSelector('globalYearSelect', year);
        setupPartitionedRealtimeListeners();
    });
}

async function loadActiveDatasetFromSettings() {
    try {
        if (!window.supabaseClient) return;
        const { data, error } = await window.supabaseClient
            .from('school_settings')
            .select('value')
            .eq('key', 'active_dataset')
            .maybeSingle();

        if (!error && data && data.value) {
            activeDataset = JSON.parse(data.value);
            updateActiveDatasetUI();
        } else {
            activeDataset = null;
            const banner = document.getElementById('activeDatasetBanner');
            if (banner) banner.style.display = 'none';
        }
    } catch (e) {
        console.error("Error loading active dataset from settings:", e);
    }
}

async function handleGlobalYearChange(year) {
    if (!year) return;
    window.currentAcademicYear = year;
    sessionStorage.setItem('currentAcademicYear', year);
    
    if (window.supabaseClient) {
        try {
            await window.supabaseClient
                .from('academic_years')
                .update({ is_default: false })
                .neq('year_name', year);

            await window.supabaseClient
                .from('academic_years')
                .update({ is_default: true })
                .eq('year_name', year);
        } catch (e) {
            console.error("Failed to write default academic year:", e);
        }
    }
    
    setupPartitionedRealtimeListeners();
    showToast(`เปลี่ยนปีการศึกษาหลักเป็นปี ${year} เรียบร้อยแล้ว`, 'success');
}

window.handleGlobalYearChange = handleGlobalYearChange;

// Fallback logic for offline / mock mode
function loadMockAnalytics() {
    document.getElementById('totalStudents').textContent = "5,002 คน";
    document.getElementById('totalLogs').textContent = "128 รายการ";
    document.getElementById('totalAnnouncements').textContent = "1 รายการ";
    document.getElementById('activeStudents').textContent = "842 คน";
    
    // Mock charts
    initWeeklyChartInstance('line', ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'], [12, 19, 3, 5, 2, 3, 15]);
}

// Helper to extract JS Date object from report timestamp fields
function getDateFromReport(report) {
    if (report.readDate) {
        return report.readDate.toDate ? report.readDate.toDate() : new Date(report.readDate);
    }
    if (report.createdAt) {
        return report.createdAt.toDate ? report.createdAt.toDate() : new Date(report.createdAt);
    }
    return null;
}

// Global chart rendering controller
function initWeeklyChartInstance(type, labels, dataPoints) {
    const ctx = document.getElementById('weeklyChart');
    if (!ctx) return;
    
    if (weeklyChartInstance) {
        weeklyChartInstance.destroy();
    }
    
    weeklyChartInstance = new Chart(ctx.getContext('2d'), {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: 'จำนวนการบันทึก (เล่ม)',
                data: dataPoints,
                borderColor: '#87CEEB',
                backgroundColor: type === 'line' ? 'rgba(135, 206, 235, 0.2)' : '#DDA0DD',
                borderWidth: 3,
                fill: type === 'line',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

// Update Reading Analytics based on timeframe and chart type
function updateAnalyticsChart() {
    const timeframe = document.getElementById('chartTimeframe').value;
    const type = document.getElementById('chartType').value;
    
    if (!window.weeklyReadingTrends) {
        initWeeklyChartInstance(type, ['ไม่มีข้อมูล'], [0]);
        return;
    }

    let labels = [];
    let counts = [];
    
    const now = new Date();
    
    if (timeframe === 'daily') {
        // Last 7 days
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(now.getDate() - i);
            days.push(d);
        }
        
        labels = days.map(d => d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }));
        counts = days.map(d => {
            const dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            return window.weeklyReadingTrends.daily?.[dateStr] || 0;
        });
        
    } else if (timeframe === 'weekly') {
        // Last 8 weeks (sum of daily in range)
        const weekLabels = [];
        const weekCounts = [];
        for (let i = 7; i >= 0; i--) {
            const start = new Date();
            start.setDate(now.getDate() - (i + 1) * 7 + 1);
            start.setHours(0, 0, 0, 0);
            
            const end = new Date();
            end.setDate(now.getDate() - i * 7);
            end.setHours(23, 59, 59, 999);
            
            const labelStr = `${start.getDate()} ${start.toLocaleDateString('th-TH', { month: 'short' })} - ${end.getDate()} ${end.toLocaleDateString('th-TH', { month: 'short' })}`;
            weekLabels.push(labelStr);
            
            let weekSum = 0;
            const temp = new Date(start);
            while (temp <= end) {
                const dateStr = temp.getFullYear() + '-' + String(temp.getMonth() + 1).padStart(2, '0') + '-' + String(temp.getDate()).padStart(2, '0');
                weekSum += window.weeklyReadingTrends.daily?.[dateStr] || 0;
                temp.setDate(temp.getDate() + 1);
            }
            weekCounts.push(weekSum);
        }
        labels = weekLabels;
        counts = weekCounts;
        
    } else if (timeframe === 'monthly') {
        // Months of current year
        const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
        const year = now.getFullYear();
        labels = months;
        counts = months.map((_, mIdx) => {
            const monthStr = `${year}-${String(mIdx + 1).padStart(2, '0')}`;
            return window.weeklyReadingTrends.monthly?.[monthStr] || 0;
        });
        
    } else if (timeframe === 'yearly') {
        // Last 5 years
        const currentYear = now.getFullYear();
        for (let i = 4; i >= 0; i--) {
            const yr = currentYear - i;
            labels.push(`ปี พ.ศ. ${yr + 543}`); // Thai Buddhist Era
            const count = window.weeklyReadingTrends.yearly?.[yr.toString()] || 0;
            counts.push(count);
        }
    }
    
    initWeeklyChartInstance(type, labels, counts);
}

// Update Active Dataset Banner details
function updateActiveDatasetUI() {
    const banner = document.getElementById('activeDatasetBanner');
    if (!banner) return;
    
    if (activeDataset) {
        document.getElementById('activeDatasetName').textContent = activeDataset.fileName || '-';
        document.getElementById('activeDatasetRecords').textContent = (activeDataset.totalRecords || 0).toLocaleString('th-TH');
        
        const dateStr = activeDataset.importDate?.toDate
            ? activeDataset.importDate.toDate().toLocaleString('th-TH')
            : (activeDataset.importDate ? new Date(activeDataset.importDate).toLocaleString('th-TH') : '-');
            
        document.getElementById('activeDatasetDate').textContent = dateStr;
        document.getElementById('activeDatasetUser').textContent = activeDataset.uploadedBy || 'ผู้ดูแลระบบ';
        banner.style.display = 'block';
    } else {
        banner.style.display = 'none';
    }
}

// Render dashboard stats and grade/classroom tables
function renderDashboardStats(stats) {
    if (!stats) return;

    const totalStudentsElem = document.getElementById('totalStudents');
    if (totalStudentsElem) totalStudentsElem.textContent = `${(stats.totalStudents || 0).toLocaleString('th-TH')} คน`;

    const totalTeachersElem = document.getElementById('totalTeachers');
    if (totalTeachersElem) totalTeachersElem.textContent = `${(stats.totalTeachers || 0).toLocaleString('th-TH')} คน`;

    const approvedReportsElem = document.getElementById('approvedReports');
    if (approvedReportsElem) approvedReportsElem.textContent = `${(stats.approvedReports || 0).toLocaleString('th-TH')} รายการ`;

    const pendingReportsElem = document.getElementById('pendingReports');
    if (pendingReportsElem) pendingReportsElem.textContent = `${(stats.pendingReports || 0).toLocaleString('th-TH')} รายการ`;

    const activeStudentsElem = document.getElementById('activeStudents');
    if (activeStudentsElem) activeStudentsElem.textContent = `${(stats.activeStudents || 0).toLocaleString('th-TH')} คน`;

    const totalLogsElem = document.getElementById('totalLogs');
    if (totalLogsElem) totalLogsElem.textContent = `${(stats.totalLogs || 0).toLocaleString('th-TH')} รายการ`;

    // ── Grade Breakdown ──────────────────────────────
    const grades = ['ม.1', 'ม.2', 'ม.3', 'ม.4', 'ม.5', 'ม.6'];
    const gradeBody = document.getElementById('gradeBreakdownBody');
    if (gradeBody) {
        gradeBody.innerHTML = grades.map(g => {
            const count = stats.byGrade?.[g] || 0;
            const pct = stats.totalStudents > 0 ? ((count / stats.totalStudents) * 100).toFixed(1) : '0.0';
            return `<tr>
                <td><strong>ระดับชั้น ${g}</strong></td>
                <td>${count.toLocaleString('th-TH')} คน</td>
                <td>${pct}%</td>
            </tr>`;
        }).join('');
    }

    // ── Classroom Breakdown ──────────────────────────
    const classBody = document.getElementById('classroomBreakdownBody');
    if (classBody && stats.byClassroom) {
        const sortedClassrooms = Object.keys(stats.byClassroom).sort((a, b) => {
            const matchA = a.match(/ม\.([1-6])\/([0-9]+)/);
            const matchB = b.match(/ม\.([1-6])\/([0-9]+)/);
            if (matchA && matchB) {
                const lvlA = parseInt(matchA[1], 10);
                const lvlB = parseInt(matchB[1], 10);
                if (lvlA !== lvlB) return lvlA - lvlB;
                return parseInt(matchA[2], 10) - parseInt(matchB[2], 10);
            }
            return a.localeCompare(b);
        });

        let classHtml = '';
        for (let i = 0; i < sortedClassrooms.length; i += 2) {
            const c1 = sortedClassrooms[i];
            const count1 = stats.byClassroom[c1];
            
            const c2 = sortedClassrooms[i + 1] || '';
            const count2 = c2 ? stats.byClassroom[c2] : '';
            
            classHtml += `<tr>
                <td><strong>ห้องเรียน ${c1}</strong></td>
                <td>${count1} คน</td>
                <td>${c2 ? `<strong>ห้องเรียน ${c2}</strong>` : ''}</td>
                <td>${c2 ? `${count2} คน` : ''}</td>
            </tr>`;
        }
        classBody.innerHTML = classHtml || '<tr><td colspan="4" class="text-center">ไม่มีข้อมูลห้องเรียน</td></tr>';
    }
}

// Sync calculated summaries to database (Not required in Supabase since we use Materialized Views)
async function syncStatsToSupabase(stats) {
    // No-op. Materialized views handle this on the database level.
}

// Full database recalculate function for stats and trends
async function recalculateSystemStats() {
    if (!window.supabaseClient) return;
    try {
        console.log("Recalculating statistics...");
        // Refresh materialized view
        const { error } = await window.supabaseClient.rpc('refresh_classroom_stats');
        if (error) throw error;

        // Invalidate cache
        invalidateDashboardCache();
        console.log("Recalculation complete!");
    } catch (err) {
        console.error("Error in recalculateSystemStats:", err);
    }
}

// Triggered when file input selects Excel
async function importExcelData(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        currentWorkbookName = file.name;
        currentWorkbook = await parseExcelWorkbook(file);
        
        const sheetSelect = document.getElementById('previewSheetSelect');
        sheetSelect.innerHTML = '';
        
        // Combine sheets option
        const optAll = document.createElement('option');
        optAll.value = 'all';
        optAll.textContent = 'นำเข้าทุกแผ่นงาน (Combine All)';
        sheetSelect.appendChild(optAll);
        
        currentWorkbook.SheetNames.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sheetSelect.appendChild(opt);
        });

        document.getElementById('previewFileName').textContent = file.name;
        
        handlePreviewSheetChange();
        document.getElementById('importPreviewModal').classList.add('open');
        
    } catch (err) {
        alert("เกิดข้อผิดพลาดในการโหลดไฟล์ Excel: " + err.message);
        event.target.value = '';
    }
}

function handlePreviewSheetChange() {
    if (!currentWorkbook) return;
    
    const selectedSheet = document.getElementById('previewSheetSelect').value;
    parsedStudentsPreview = extractStudentsFromSheet(currentWorkbook, selectedSheet);
    
    document.getElementById('previewTotalRecords').textContent = parsedStudentsPreview.length.toLocaleString('th-TH');
    
    const previewBody = document.getElementById('previewTableBody');
    previewBody.innerHTML = '';
    
    const sample = parsedStudentsPreview.slice(0, 5);
    if (sample.length === 0) {
        previewBody.innerHTML = '<tr><td colspan="5" class="text-center">ไม่พบข้อมูลแถวนักเรียนที่ถูกต้องในแผ่นงานนี้</td></tr>';
        return;
    }
    
    sample.forEach(s => {
        const tr = document.createElement('tr');
        const fullName = `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.trim();
        tr.innerHTML = `
            <td><code>${s.studentId}</code></td>
            <td><strong>${fullName}</strong></td>
            <td>${formatLevel(s.level)}</td>
            <td>ห้อง ${s.room}</td>
            <td>เลขที่ ${s.number}</td>
        `;
        previewBody.appendChild(tr);
    });
}

function closeImportPreview() {
    document.getElementById('importPreviewModal').classList.remove('open');
    document.getElementById('excelFile').value = '';
    currentWorkbook = null;
    parsedStudentsPreview = [];
}

// Commit parsed Excel data to Firestore based on replacement modes
async function confirmExcelImport() {
    if (parsedStudentsPreview.length === 0) {
        alert("ไม่พบข้อมูลนักเรียนที่จะนำเข้า");
        return;
    }

    const mode = document.querySelector('input[name="importMode"]:checked').value;
    
    if (mode === 'replace') {
        const replaceConfirmed = confirm(
            "⚠️ ยืนยันการแทนที่ข้อมูลเดิมใช่หรือไม่?\n\n" +
            "การทำเช่นนี้จะลบข้อมูลนักเรียนเดิมทั้งหมด และรีเซ็ตจำนวนเล่มที่สะสม (totalBooks)\n" +
            "ประวัติรายงานการอ่านยังคงอยู่ในระบบ แต่ผู้ใช้นักเรียนจะเริ่มต้นใหม่"
        );
        if (!replaceConfirmed) return;
    }

    const btnConfirm = document.getElementById('btnConfirmImport');
    const progressBar = document.getElementById('importProgressBar');
    const progressTxt = document.getElementById('importProgressText');
    const progress = document.getElementById('importProgress');
    
    btnConfirm.disabled = true;
    progress.style.display = 'block';
    progressBar.style.width = '0%';
    progressTxt.textContent = 'กำลังเตรียมนำเข้าข้อมูล...';

    try {
        const datasetId = `ds_${Date.now()}`;
        const importDate = new Date();
        
        const result = await batchWriteStudents(parsedStudentsPreview, mode, datasetId, currentWorkbookName, importDate, progressTxt, progressBar);
        
        if (result.success) {
            const activeDatasetObj = {
                datasetId,
                importDate: importDate.toISOString(),
                fileName: currentWorkbookName,
                totalRecords: parsedStudentsPreview.length,
                uploadedBy: 'ผู้ดูแลระบบ (Admin)',
                mode: mode
            };
            
            await window.supabaseClient
                .from('school_settings')
                .upsert({
                    key: 'active_dataset',
                    value: JSON.stringify(activeDatasetObj)
                }, { onConflict: 'key' });

            // Recalculate stats & trends
            progressTxt.textContent = 'กำลังคำนวณและอัปเดตสถิติระบบ...';
            await recalculateSystemStats();
            invalidateDashboardCache();

            // Log activity
            await window.supabaseClient
                .from('activity_logs')
                .insert({
                    action: 'IMPORT_STUDENTS',
                    details: `นำเข้านักเรียน ${parsedStudentsPreview.length} คน จากไฟล์ ${currentWorkbookName} (โหมด: ${mode})`,
                    performed_by: 'ผู้ดูแลระบบ (Admin)'
                });

            alert(`นำเข้าสำเร็จ!\nจำนวนนักเรียนที่จัดการลงระบบ: ${result.count} คน`);
            closeImportPreview();
        } else {
            alert(`เกิดข้อผิดพลาดในการนำเข้าข้อมูล: ${result.error}`);
        }
    } catch (err) {
        console.error("confirmExcelImport error:", err);
        alert(`เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        btnConfirm.disabled = false;
        progress.style.display = 'none';
    }
}

// Bulk batch write students (Replace, Merge, or Update)
async function batchWriteStudents(students, mode, datasetId, fileName, importDate, progressTxt, progressBar) {
    if (!window.supabaseClient) throw new Error("ไม่ได้เชื่อมต่อฐานข้อมูล Supabase");
    
    const targetYear = getActiveYear();
    let count = 0;

    try {
        // Fetch all existing students in the target academic year to check for matches
        const { data: existingStudents, error: fetchErr } = await window.supabaseClient
            .from('students')
            .select('id, student_id, level, room')
            .eq('academic_year', targetYear);

        if (fetchErr) throw fetchErr;
        
        const existingStudentMap = new Map(); // studentId -> id
        (existingStudents || []).forEach(s => {
            if (s.student_id) {
                existingStudentMap.set(String(s.student_id).trim(), s.id);
            }
        });

        if (mode === 'replace') {
            progressTxt.textContent = `โหมด Replace: ลบข้อมูลนักเรียนของปีการศึกษา ${targetYear} ที่ตรงกับระดับชั้นนำเข้า...`;
            progressBar.style.width = '15%';
            
            const targetLevels = Array.from(new Set(students.map(s => s.level)));
            
            const { error: delErr } = await window.supabaseClient
                .from('students')
                .delete()
                .eq('academic_year', targetYear)
                .in('level', targetLevels);
                
            if (delErr) throw delErr;
            
            // Clear map for deleted student IDs
            (existingStudents || []).forEach(s => {
                if (targetLevels.includes(s.level)) {
                    existingStudentMap.delete(String(s.student_id).trim());
                }
            });
        }
        
        progressTxt.textContent = 'กำลังเตรียมข้อมูลและสร้างรหัสผ่านเพื่อลงทะเบียน...';
        progressBar.style.width = '40%';
        
        const studentsToUpsert = [];
        const pendingRegistrationsToUpsert = [];
        const passcodeDownloadList = []; // Array of { studentId, name, level, room, number, passcode }

        for (let idx = 0; idx < students.length; idx++) {
            const s = students[idx];
            const sid = String(s.studentId).trim();
            const exists = existingStudentMap.has(sid);
            
            if (mode === 'update' && !exists) {
                continue;
            }

            const docData = {
                student_id: sid,
                prefix: s.prefix || '',
                first_name: s.firstName || '',
                last_name: s.lastName || '',
                level: s.level,
                room: s.room || 0,
                number: s.number || 0,
                academic_year: targetYear,
                dataset_id: datasetId,
                source_file: fileName,
                import_date: importDate.toISOString(),
                updated_at: new Date().toISOString()
            };

            if (exists && (mode === 'merge' || mode === 'update')) {
                docData.id = existingStudentMap.get(sid);
                // Do not reset totals on update/merge
            } else {
                // Initial values for new students
                docData.total_books = 0;
                docData.total_pages = 0;
                docData.total_reading_time = 0;
                docData.total_score = 0;

                // Generate temporary registration passcode for new student
                const passcode = generatePasscode();
                const hash = await sha256(passcode);
                
                pendingRegistrationsToUpsert.push({
                    student_id: sid,
                    passcode_hash: hash,
                    plain_passcode: passcode,
                    first_name: s.firstName || '',
                    last_name: s.lastName || ''
                });

                passcodeDownloadList.push({
                    studentId: sid,
                    name: `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.trim(),
                    level: s.level,
                    room: s.room || 0,
                    number: s.number || 0,
                    passcode: passcode
                });
            }

            studentsToUpsert.push(docData);
            count++;
        }

        progressTxt.textContent = 'กำลังบันทึกข้อมูลลงฐานข้อมูล Supabase...';
        progressBar.style.width = '70%';

        // Bulk upsert students
        if (studentsToUpsert.length > 0) {
            const { error: upsertErr } = await window.supabaseClient
                .from('students')
                .upsert(studentsToUpsert, { onConflict: 'student_id,academic_year' });
            if (upsertErr) throw upsertErr;
        }

        // Bulk upsert pending registrations
        if (pendingRegistrationsToUpsert.length > 0) {
            const { error: regErr } = await window.supabaseClient
                .from('pending_registrations')
                .upsert(pendingRegistrationsToUpsert, { onConflict: 'student_id' });
            if (regErr) throw regErr;
        }

        progressBar.style.width = '100%';
        progressTxt.textContent = `เสร็จสมบูรณ์! จัดการข้อมูลนักเรียนสำเร็จ ${count} คน`;

        // Save passcode list to window so it can be downloaded by admin
        if (passcodeDownloadList.length > 0) {
            window.latestPasscodeExportList = passcodeDownloadList;
            showPasscodeDownloadUI(passcodeDownloadList.length);
        }

        return { success: true, count };
        
    } catch (error) {
        console.error("batchWriteStudents error:", error);
        return { success: false, error: error.message };
    }
}

// Student filters and pagination handling

function handleLevelFilterChange() {
    const lvl = document.getElementById('filterLevel').value;
    const roomSelect = document.getElementById('filterRoom');
    roomSelect.innerHTML = '<option value="">ห้องทั้งหมด</option>';
    
    if (lvl) {
        for (let r = 1; r <= 15; r++) {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = `ห้อง ${r}`;
            roomSelect.appendChild(opt);
        }
    }
    
    currentPage = 1;
    pageCursors = {};
    loadStudentsPage();
}

function applyFiltersAndRenderTable() {
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(() => {
        currentPage = 1;
        pageCursors = {};
        loadStudentsPage();
    }, 500);
}

async function loadStudentsPage() {
    if (!window.supabaseClient) return;
    
    const searchVal = document.getElementById('studentSearch').value.trim();
    const levelVal = document.getElementById('filterLevel').value;
    const roomVal = document.getElementById('filterRoom').value;
    const targetYear = getActiveYear();
    
    selectedStudentIds.clear();
    const selectAllCheck = document.getElementById('selectAllStudents');
    if (selectAllCheck) selectAllCheck.checked = false;
    
    const bulkBar = document.getElementById('bulkActionsBar');
    if (bulkBar) bulkBar.style.display = 'none';
    
    const tableBody = document.getElementById('adminStudentsTable');
    tableBody.innerHTML = '<tr><td colspan="8" class="text-center">กำลังโหลดข้อมูลนักเรียน...</td></tr>';
    
    try {
        let query = window.supabaseClient
            .from('students')
            .select('*', { count: 'exact' })
            .eq('academic_year', targetYear);
            
        if (levelVal) {
            query = query.eq('level', levelVal);
        }
        if (roomVal) {
            query = query.eq('room', Number(roomVal));
        }
        
        if (searchVal) {
            if (/^\d+$/.test(searchVal)) {
                query = query.like('student_id', `${searchVal}%`);
            } else {
                query = query.or(`first_name.ilike.%${searchVal}%,last_name.ilike.%${searchVal}%`);
            }
        }

        // Sorting mapping
        let sortCol = 'student_id';
        if (sortBy === 'firstName') sortCol = 'first_name';
        else if (sortBy === 'studentId') sortCol = 'student_id';
        else if (sortBy === 'level') sortCol = 'level';
        else if (sortBy === 'room') sortCol = 'room';
        else if (sortBy === 'number') sortCol = 'number';
        else if (sortBy === 'totalBooks') sortCol = 'total_books';

        query = query.order(sortCol, { ascending: sortOrder === 'asc' });

        const offset = (currentPage - 1) * pageSize;
        const { data, count, error } = await query.range(offset, offset + pageSize - 1);

        if (error) throw error;

        const totalRecords = count || 0;
        const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        
        allStudents = (data || []).map(s => ({
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
            totalPages: s.total_pages,
            sourceFile: s.source_file,
            datasetVersion: s.dataset_id,
            importDate: s.import_date
        }));
        
        document.getElementById('paginationInfo').textContent = searchVal
            ? `หน้า ${currentPage} (ผลการค้นหา)`
            : `หน้า ${currentPage} จาก ${totalPages} (ทั้งหมด ${totalRecords.toLocaleString('th-TH')} คน)`;
            
        document.getElementById('btnPrevPage').disabled = (currentPage === 1);
        document.getElementById('btnNextPage').disabled = (currentPage >= totalPages || allStudents.length < pageSize);
        
        renderStudentTable(allStudents);
    } catch (err) {
        console.error("loadStudentsPage error:", err);
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center" style="color:var(--color-danger)">เกิดข้อผิดพลาดในการโหลดข้อมูลนักเรียน<br><small style="display:block; margin-top:0.5rem; font-size:0.8rem; color:#888;">สาเหตุ: ${err.message || err}</small></td></tr>`;
    }
}

function renderStudentTable(students) {
    const tableBody = document.getElementById('adminStudentsTable');
    tableBody.innerHTML = '';
    
    if (students.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8" class="text-center">ไม่พบข้อมูลนักเรียนตามเงื่อนไขที่กรอง</td></tr>';
        return;
    }
    
    students.forEach(s => {
        const tr = document.createElement('tr');
        const fullName = `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.trim();
        const levelStr = formatLevel(s.level);
        const roomStr = s.room || '-';
        const numStr = s.number || '-';
        
        const fileStr = s.sourceFile ? s.sourceFile : 'ก่อนหน้านี้ / บันทึกเดิม';
        const verStr = s.datasetVersion ? s.datasetVersion.substring(0, 12) : 'v1.0';
        
        const dateStr = s.importDate?.toDate
            ? s.importDate.toDate().toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : (s.importDate ? new Date(s.importDate).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-');

        const isChecked = selectedStudentIds.has(s.studentId) ? 'checked' : '';
        
        tr.innerHTML = `
            <td style="text-align:center;"><input type="checkbox" class="student-row-check" data-id="${s.studentId}" ${isChecked} onchange="handleRowCheckboxChange(this)"></td>
            <td><code>${s.studentId}</code></td>
            <td><strong>${fullName}</strong></td>
            <td>${levelStr}</td>
            <td>ห้อง ${roomStr}</td>
            <td>เลขที่ ${numStr}</td>
            <td>
                <div style="font-size:0.8rem; font-weight:600; color:var(--color-bg-dark);">${fileStr}</div>
                <div style="font-size:0.7rem; color:#888;">เวอร์ชัน: ${verStr} (${dateStr})</div>
            </td>
            <td>
                <button class="btn btn-danger" style="padding:0.35rem 0.75rem; font-size:0.8rem; background:#fee2e2; color:#ef4444; border: 1px solid #fecaca; border-radius: var(--border-radius-sm);" onclick="deleteSingleStudent('${s.studentId}')" title="ลบข้อมูลนักเรียน">
                    <span class="material-icons-round" style="font-size:0.95rem; vertical-align:middle;">delete</span> ลบ
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function toggleSelectAllStudents(masterCheck) {
    const checkboxes = document.querySelectorAll('.student-row-check');
    checkboxes.forEach(cb => {
        const id = cb.getAttribute('data-id');
        cb.checked = masterCheck.checked;
        if (masterCheck.checked) {
            selectedStudentIds.add(id);
        } else {
            selectedStudentIds.delete(id);
        }
    });
    updateBulkActionsUI();
}

function handleRowCheckboxChange(cb) {
    const id = cb.getAttribute('data-id');
    if (cb.checked) {
        selectedStudentIds.add(id);
    } else {
        selectedStudentIds.delete(id);
    }
    
    const visibleCheckboxes = document.querySelectorAll('.student-row-check');
    const allChecked = Array.from(visibleCheckboxes).every(el => el.checked);
    const selectAllCheck = document.getElementById('selectAllStudents');
    if (selectAllCheck) selectAllCheck.checked = allChecked;
    
    updateBulkActionsUI();
}

function updateBulkActionsUI() {
    const bulkBar = document.getElementById('bulkActionsBar');
    const selectedCountSpan = document.getElementById('selectedCount');
    if (!bulkBar) return;
    
    if (selectedStudentIds.size > 0) {
        selectedCountSpan.textContent = selectedStudentIds.size.toLocaleString('th-TH');
        bulkBar.style.display = 'flex';
    } else {
        bulkBar.style.display = 'none';
    }
}

function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value, 10);
    currentPage = 1;
    applyFiltersAndRenderTable();
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        loadStudentsPage();
    }
}

function nextPage() {
    currentPage++;
    loadStudentsPage();
}

// Student record deletions
async function deleteSingleStudent(docId) {
    const student = allStudents.find(s => s.id === docId);
    if (!student) return;
    const studentId = student.studentId;
    const fullName = `${student.prefix || ''}${student.firstName} ${student.lastName}`;
    
    const conf = confirm(`❓ คุณต้องการลบข้อมูลของนักเรียน ${fullName} (รหัส: ${studentId}) ใช่หรือไม่?\nการดำเนินการนี้จะลบข้อมูลถาวรออกจากระบบ`);
    if (!conf) return;

    try {
        if (!window.supabaseClient) {
            alert("ระบบทดลอง: ลบสำเร็จ");
            return;
        }

        // Delete from students table
        const { error: delErr } = await window.supabaseClient
            .from('students')
            .delete()
            .eq('id', docId);

        if (delErr) throw delErr;

        // Clean up pending registration if exists
        await window.supabaseClient
            .from('pending_registrations')
            .delete()
            .eq('student_id', studentId);

        // Add activity log
        await window.supabaseClient
            .from('activity_logs')
            .insert({
                action: 'DELETE_STUDENT',
                details: `ลบนักเรียน ${fullName} (รหัส ${studentId})`,
                performed_by: 'ผู้ดูแลระบบ (Admin)'
            });

        invalidateDashboardCache();

        alert(`ลบข้อมูลนักเรียนสำเร็จ!`);
        currentPage = 1;
        loadStudentsPage();
    } catch (err) {
        console.error("deleteSingleStudent error:", err);
        alert(`เกิดข้อผิดพลาดในการลบ: ${err.message}`);
    }
}

async function deleteSelectedStudents() {
    if (selectedStudentIds.size === 0) return;
    
    const count = selectedStudentIds.size;
    const conf = confirm(`⚠️ คุณแน่ใจหรือไม่ว่าต้องการลบนักเรียนที่เลือกทั้งหมด ${count} คน?\nการดำเนินการนี้ไม่สามารถกู้คืนได้`);
    if (!conf) return;

    try {
        if (!window.supabaseClient) {
            alert("ระบบทดลอง: ลบสำเร็จ");
            selectedStudentIds.clear();
            updateBulkActionsUI();
            return;
        }

        const list = Array.from(selectedStudentIds);
        
        // Delete selected students in bulk
        const { error } = await window.supabaseClient
            .from('students')
            .delete()
            .in('student_id', list);
            
        if (error) throw error;

        // Add activity log
        await window.supabaseClient
            .from('activity_logs')
            .insert({
                action: 'DELETE_STUDENTS_BULK',
                details: `ลบกลุ่มนักเรียนจำนวน ${count} คน`,
                performed_by: 'ผู้ดูแลระบบ (Admin)'
            });

        invalidateDashboardCache();

        alert(`ลบนักเรียน ${count} คน เรียบร้อยแล้ว`);
        selectedStudentIds.clear();
        updateBulkActionsUI();
        document.getElementById('selectAllStudents').checked = false;
        
        currentPage = 1;
        pageCursors = {};
        loadStudentsPage();
    } catch (err) {
        console.error("deleteSelectedStudents error:", err);
        alert(`เกิดข้อผิดพลาดในการลบกลุ่มนักเรียน: ${err.message}`);
    }
}

async function deleteAllStudents() {
    const activeYear = getActiveYear();
    const count = window.systemStats?.totalStudents || 0;
    if (count === 0) {
        alert(`ไม่มีข้อมูลนักเรียนให้ลบในปีการศึกษา ${activeYear}`);
        return;
    }

    const conf1 = confirm(`🚨🚨🚨 คำเตือนสำคัญมาก!\n\nคุณแน่ใจจริงหรือไม่ว่าต้องการลบข้อมูลนักเรียนทั้งหมดในปีการศึกษา ${activeYear} จำนวน ${count} คน?\nสถิติและข้อมูลรายชื่อทั้งหมดจะถูกล้างออกจากระบบ`);
    if (!conf1) return;

    const conf2 = prompt(`เพื่อความปลอดภัยและป้องกันการคลิกผิดพลาด\nกรุณาพิมพ์คำว่า "DELETE ALL" (ตัวใหญ่ทั้งหมด) ในช่องด้านล่างเพื่อยืนยันการลบ:`);
    if (conf2 !== "DELETE ALL") {
        alert("คำยืนยันไม่ถูกต้อง ยกเลิกการลบข้อมูล");
        return;
    }

    try {
        if (!window.supabaseClient) {
            alert("ระบบทดลอง: ลบทั้งหมดสำเร็จ");
            return;
        }

        // Delete students of active academic year
        const { data, error: delErr } = await window.supabaseClient
            .from('students')
            .delete()
            .eq('academic_year', activeYear)
            .select();
        
        if (delErr) throw delErr;
        const deleted = data ? data.length : 0;

        // Reset active dataset setting
        await window.supabaseClient
            .from('school_settings')
            .delete()
            .eq('key', 'active_dataset');

        await window.supabaseClient
            .from('activity_logs')
            .insert({
                action: 'DELETE_ALL_STUDENTS',
                details: `ล้างข้อมูลนักเรียนทั้งหมดในปีการศึกษา ${activeYear} จำนวน ${deleted} คน`,
                performed_by: 'ผู้ดูแลระบบ (Admin)'
            });

        invalidateDashboardCache();

        alert(`ล้างฐานข้อมูลสำเร็จ! ลบข้อมูลนักเรียนในปีการศึกษา ${activeYear} ไปทั้งหมด ${deleted} คน`);
        currentPage = 1;
        pageCursors = {};
        loadStudentsPage();
        
    } catch (err) {
        console.error("deleteAllStudents error:", err);
        alert(`เกิดข้อผิดพลาดในการลบข้อมูลทั้งหมด: ${err.message}`);
    }
}

// Fetch all filtered students from Firestore (not just current paginated slice)
async function fetchAllFilteredStudents() {
    if (!window.supabaseClient) return [];
    
    const searchVal = document.getElementById('studentSearch').value.trim();
    const levelVal = document.getElementById('filterLevel').value;
    const roomVal = document.getElementById('filterRoom').value;
    const targetYear = getActiveYear();
    
    let query = window.supabaseClient
        .from('students')
        .select('*')
        .eq('academic_year', targetYear);
        
    if (levelVal) {
        query = query.eq('level', levelVal);
    }
    if (roomVal) {
        query = query.eq('room', Number(roomVal));
    }
    
    if (searchVal) {
        if (/^\d+$/.test(searchVal)) {
            query = query.like('student_id', `${searchVal}%`);
        } else {
            query = query.or(`first_name.ilike.%${searchVal}%,last_name.ilike.%${searchVal}%`);
        }
    }

    // Sorting mapping
    let sortCol = 'student_id';
    if (sortBy === 'firstName') sortCol = 'first_name';
    else if (sortBy === 'studentId') sortCol = 'student_id';
    else if (sortBy === 'level') sortCol = 'level';
    else if (sortBy === 'room') sortCol = 'room';
    else if (sortBy === 'number') sortCol = 'number';
    else if (sortBy === 'totalBooks') sortCol = 'total_books';

    query = query.order(sortCol, { ascending: sortOrder === 'asc' });
    
    const { data, error } = await query.limit(6000);
    if (error) {
        console.error("fetchAllFilteredStudents error:", error);
        return [];
    }
    
    return (data || []).map(s => ({
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
        totalPages: s.total_pages,
        sourceFile: s.source_file,
        datasetVersion: s.dataset_id,
        importDate: s.import_date
    }));
}


// Export students to Excel using SheetJS
async function exportStudentsToExcel() {
    const list = await fetchAllFilteredStudents();
    if (list.length === 0) {
        alert("ไม่มีข้อมูลส่งออก");
        return;
    }
    
    const rows = list.map(s => ({
        'รหัสประจำตัว': s.studentId,
        'คำนำหน้า': s.prefix || '',
        'ชื่อ': s.firstName || '',
        'นามสกุล': s.lastName || '',
        'ระดับชั้น': formatLevel(s.level),
        'ห้อง': s.room || '',
        'เลขที่': s.number || '',
        'ไฟล์ที่มา': s.sourceFile || 'ประวัติเดิม',
        'เวอร์ชัน': s.datasetVersion || 'v1.0',
        'วันที่นำเข้า': s.importDate?.toDate 
            ? s.importDate.toDate().toLocaleDateString('th-TH')
            : (s.importDate ? new Date(s.importDate).toLocaleDateString('th-TH') : '-')
    }));
    
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "นักเรียนที่กรอง");
    
    XLSX.writeFile(wb, `student_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// Export students to PDF using html2canvas + jsPDF (to render Thai font correctly)
async function exportStudentsToPDF() {
    const list = await fetchAllFilteredStudents();
    if (list.length === 0) {
        alert("ไม่มีข้อมูลให้ส่งออก");
        return;
    }
    
    alert("กำลังสร้างไฟล์ PDF รายชื่อนักเรียน กรุณารอสักครู่...");
    
    const printDiv = document.createElement('div');
    printDiv.style.position = 'absolute';
    printDiv.style.left = '-9999px';
    printDiv.style.top = '-9999px';
    printDiv.style.width = '800px';
    printDiv.style.padding = '30px';
    printDiv.style.backgroundColor = '#ffffff';
    printDiv.style.fontFamily = "'Sarabun', sans-serif";
    printDiv.style.color = '#333333';
    
    let filterInfoStr = "";
    const lvlVal = document.getElementById('filterLevel').value;
    const roomVal = document.getElementById('filterRoom').value;
    if (lvlVal) filterInfoStr += ` ระดับชั้น ${lvlVal}`;
    if (roomVal) filterInfoStr += ` ห้อง ${roomVal}`;
    
    printDiv.innerHTML = `
        <div style="text-align:center; margin-bottom:20px;">
            <h1 style="font-size:24px; margin-bottom:5px; color:#2a2a72;">รายชื่อนักเรียนในระบบบันทึกรักการอ่าน</h1>
            <p style="font-size:14px; color:#777;">ชุดข้อมูล: ${activeDataset ? activeDataset.fileName : 'ทั้งหมด'}${filterInfoStr} | วันที่ส่งออก: ${new Date().toLocaleDateString('th-TH')}</p>
        </div>
        <table style="width:100%; border-collapse:collapse; font-size:12px; margin-top:10px;">
            <thead>
                <tr style="background-color:#f2f4f8; border-bottom:2px solid #ddd; text-align:left;">
                    <th style="padding:10px; border:1px solid #ddd;">เลขที่</th>
                    <th style="padding:10px; border:1px solid #ddd;">รหัสนักเรียน</th>
                    <th style="padding:10px; border:1px solid #ddd;">ชื่อ-นามสกุล</th>
                    <th style="padding:10px; border:1px solid #ddd;">ระดับชั้น</th>
                    <th style="padding:10px; border:1px solid #ddd;">ห้อง</th>
                    <th style="padding:10px; border:1px solid #ddd;">ไฟล์ที่มา</th>
                    <th style="padding:10px; border:1px solid #ddd;">วันที่นำเข้า</th>
                </tr>
            </thead>
            <tbody>
                ${list.map(s => {
                    const fullName = `${s.prefix || ''}${s.firstName || ''} ${s.lastName || ''}`.trim();
                    const dateStr = s.importDate?.toDate
                        ? s.importDate.toDate().toLocaleDateString('th-TH')
                        : (s.importDate ? new Date(s.importDate).toLocaleDateString('th-TH') : '-');
                    return `
                        <tr style="border-bottom:1px solid #eee;">
                            <td style="padding:8px; border:1px solid #ddd;">${s.number || '-'}</td>
                            <td style="padding:8px; border:1px solid #ddd;"><code>${s.studentId}</code></td>
                            <td style="padding:8px; border:1px solid #ddd; font-weight:600;">${fullName}</td>
                            <td style="padding:8px; border:1px solid #ddd;">${formatLevel(s.level)}</td>
                            <td style="padding:8px; border:1px solid #ddd;">ห้อง ${s.room || '-'}</td>
                            <td style="padding:8px; border:1px solid #ddd; font-size:10px;">${s.sourceFile || 'บันทึกเดิม'}</td>
                            <td style="padding:8px; border:1px solid #ddd;">${dateStr}</td>
                        </tr>
                    `;
                }).join('')}
            </tbody>
        </table>
    `;
    
    document.body.appendChild(printDiv);
    
    try {
        const { jsPDF } = window.jspdf;
        const canvas = await html2canvas(printDiv, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210;
        const pageHeight = 297;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        let heightLeft = imgHeight;
        let position = 0;

        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft >= 0) {
            position = heightLeft - imgHeight;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        const filename = `student_list_${new Date().toISOString().slice(0, 10)}.pdf`;
        pdf.save(filename);
    } catch (error) {
        console.error("PDF generation failed:", error);
        alert("พิมพ์เอกสาร PDF ล้มเหลว");
    } finally {
        document.body.removeChild(printDiv);
    }
}

// Config setup CRUD
async function loadSettings() {
    if (!window.supabaseClient) return;

    try {
        const { data: settingsData, error: settingsErr } = await window.supabaseClient
            .from('school_settings')
            .select('*');
            
        if (settingsErr) throw settingsErr;
        
        const settingsMap = {};
        (settingsData || []).forEach(item => {
            settingsMap[item.key] = item.value;
        });

        if (settingsMap['current_academic_year']) {
            document.getElementById('currentYear').value = settingsMap['current_academic_year'];
        } else {
            document.getElementById('currentYear').value = '2568';
        }
        document.getElementById('telegramToken').value = settingsMap['telegram_bot_token'] || '';
        document.getElementById('telegramChatId').value = settingsMap['telegram_chat_id'] || '';
        document.getElementById('imgbbKey').value = settingsMap['imgbb_api_key'] || '687acb6098a4ae2c2d69dff4d42c3d6c';

        // Load grade-specific Telegram configs
        const { data: tgData, error: tgErr } = await window.supabaseClient
            .from('telegram_configs')
            .select('*');
            
        if (tgErr) throw tgErr;
        
        (tgData || []).forEach(item => {
            const tokenInput = document.getElementById(`tgToken_${item.level_key}`);
            const chatIdInput = document.getElementById(`tgChatId_${item.level_key}`);
            if (tokenInput) tokenInput.value = item.bot_token || '';
            if (chatIdInput) chatIdInput.value = item.chat_id || '';
        });
    } catch (err) {
        console.error("Error loading settings:", err);
    }
}

async function saveSettings(e) {
    e.preventDefault();
    const currentYear = document.getElementById('currentYear').value.trim();
    const telegramBotToken = document.getElementById('telegramToken').value.trim();
    const telegramChatId = document.getElementById('telegramChatId').value.trim();
    const imgbbApiKey = document.getElementById('imgbbKey').value.trim();

    if (!window.supabaseClient) {
        alert("ระบบทดลอง: บันทึกข้อมูลตั้งค่าสำเร็จ");
        return;
    }

    try {
        const settingsToUpsert = [
            { key: 'current_academic_year', value: currentYear, updated_at: new Date().toISOString() },
            { key: 'telegram_bot_token', value: telegramBotToken, updated_at: new Date().toISOString() },
            { key: 'telegram_chat_id', value: telegramChatId, updated_at: new Date().toISOString() },
            { key: 'imgbb_api_key', value: imgbbApiKey, updated_at: new Date().toISOString() }
        ];

        const { error } = await window.supabaseClient
            .from('school_settings')
            .upsert(settingsToUpsert, { onConflict: 'key' });

        if (error) throw error;

        alert("บันทึกการตั้งค่าลง Supabase เรียบร้อยแล้ว!");
    } catch (err) {
        alert("เกิดข้อผิดพลาดในการบันทึกค่า: " + err.message);
    }
}

async function testTelegramNotification() {
    const telegramBotToken = document.getElementById('telegramToken').value.trim();
    const telegramChatId = document.getElementById('telegramChatId').value.trim();

    if (!telegramBotToken || !telegramChatId) {
        alert("กรุณากรอกทั้ง Telegram Bot Token และ Telegram Chat ID ในฟอร์มด้านบนก่อนทำการทดสอบ");
        return;
    }

    if (!window.supabaseClient) {
        alert("ระบบทดลอง: ส่งแจ้งเตือนทดสอบสำเร็จ (จำลอง)");
        return;
    }

    const session = getSession();
    const token = session ? session.token : null;

    try {
        const url = `${SUPABASE_URL}/functions/v1/send-telegram-notification`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                level: 'global',
                message: '🔔 <b>ทดสอบการเชื่อมต่อ Telegram</b>\nส่งจากระบบควบคุมผู้ดูแลระบบ (Admin Dashboard)\nสถานะ: ใช้งานได้ปกติ! ✅',
                test_token: telegramBotToken,
                test_chat_id: telegramChatId
            })
        });

        const resData = await response.json();
        if (!response.ok) {
            throw new Error(resData.error || 'การส่งแจ้งเตือนทดสอบล้มเหลว');
        }

        alert("ส่งข้อความทดสอบการแจ้งเตือนสำเร็จ! กรุณาตรวจสอบในกลุ่ม Telegram ของคุณ");
    } catch (err) {
        console.error("Test Telegram error:", err);
        alert("การส่งแจ้งเตือนทดสอบล้มเหลว: " + err.message);
    }
}

async function testLevelTelegramConfig(levelKey) {
    let botToken = document.getElementById(`tgToken_${levelKey}`).value.trim();
    let chatId = document.getElementById(`tgChatId_${levelKey}`).value.trim();

    // Fallback to global inputs if level-specific is empty
    if (!botToken || !chatId) {
        const globalToken = document.getElementById('telegramToken').value.trim();
        const globalChatId = document.getElementById('telegramChatId').value.trim();
        
        botToken = botToken || globalToken;
        chatId = chatId || globalChatId;
    }

    if (!botToken || !chatId) {
        alert(`กรุณากรอก Bot Token และ Chat ID ของระดับชั้น ${levelKey.replace('M', 'ม.')} หรือของส่วนกลางก่อนทำการทดสอบ`);
        return;
    }

    if (!window.supabaseClient) {
        alert("ระบบทดลอง: ส่งแจ้งเตือนทดสอบสำเร็จ (จำลอง)");
        return;
    }

    const session = getSession();
    const token = session ? session.token : null;

    try {
        const url = `${SUPABASE_URL}/functions/v1/send-telegram-notification`;
        const levelThai = levelKey.replace('M', 'ม.');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                level: levelKey,
                message: `🔔 <b>ทดสอบการเชื่อมต่อ Telegram ระดับชั้น ${levelThai}</b>\nส่งจากระบบควบคุมผู้ดูแลระบบ (Admin Dashboard)\nสถานะ: เชื่อมต่อได้ปกติ! ✅`,
                test_token: botToken,
                test_chat_id: chatId
            })
        });

        const resData = await response.json();
        if (!response.ok) {
            throw new Error(resData.error || 'การส่งแจ้งเตือนทดสอบล้มเหลว');
        }

        alert(`ส่งข้อความทดสอบการแจ้งเตือนระดับชั้น ${levelThai} สำเร็จ! กรุณาตรวจสอบในกลุ่ม Telegram ของคุณ`);
    } catch (err) {
        console.error("Test Level Telegram error:", err);
        alert(`การส่งแจ้งเตือนทดสอบระดับชั้น ${levelKey.replace('M', 'ม.')} ล้มเหลว: ` + err.message);
    }
}

async function saveTelegramConfigs(e) {
    e.preventDefault();
    if (!window.supabaseClient) {
        alert("ระบบทดลอง: บันทึกสำเร็จ");
        return;
    }
    try {
        const configsToUpsert = [];
        for (let i = 1; i <= 6; i++) {
            const tokenVal = document.getElementById(`tgToken_M${i}`).value.trim();
            const chatIdVal = document.getElementById(`tgChatId_M${i}`).value.trim();
            configsToUpsert.push({
                level_key: `M${i}`,
                bot_token: tokenVal,
                chat_id: chatIdVal,
                updated_at: new Date().toISOString()
            });
        }
        
        const { error } = await window.supabaseClient
            .from('telegram_configs')
            .upsert(configsToUpsert, { onConflict: 'level_key' });
            
        if (error) throw error;
        
        alert("บันทึกการตั้งค่า Telegram รายระดับชั้นสำเร็จ!");
    } catch (err) {
        alert("เกิดข้อผิดพลาดในการบันทึก: " + err.message);
    }
}

async function seedMockStudents() {
    if (!confirm("❓ คุณต้องการนำเข้าข้อมูลนักเรียนจำลองจำนวน 100 คน เพื่อการทดสอบระบบ ใช่หรือไม่?\n(ข้อมูลเก่าจะไม่ถูกลบ หากต้องการเริ่มใหม่กรุณากด 'ล้างข้อมูลนักเรียนทั้งหมด' ก่อน)")) {
        return;
    }

    const btn = document.getElementById('btnSeedMock');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="material-icons-round spinning" style="font-size:1.1rem; vertical-align:middle;">sync</span> กำลังนำเข้าข้อมูล...`;

    try {
        if (!window.supabaseClient) {
            alert("ระบบทดลอง: นำเข้าข้อมูลจำลองสำเร็จ 100 คน");
            btn.disabled = false;
            btn.innerHTML = originalText;
            return;
        }

        const thaiBoysFirstNames = ["กิตติภพ", "จิรายุ", "ชยพล", "ณัฐกร", "ธนกฤต", "ธีรภัทร์", "ปัญญากร", "พชร", "ยศกร", "วรเมธ", "ศรุต", "อนาวิล", "อภิสิทธิ์", "ธนพล", "พลวัต", "สิรวิชญ์"];
        const thaiGirlsFirstNames = ["กัญญาณัฐ", "จารุพิชญ์", "ชนิกานต์", "ณิชารีย์", "ธัญพิชชา", "นภัสสร", "ปาริฉัตร", "พิชญา", "รินรดา", "ศศิธร", "อรัญญา", "ปวันรัตน์", "มนัสวี", "สิรินทร์"];
        const thaiLastNames = ["สุวรรณคีรี", "เลิศวิจิตร", "พงษ์พิพัฒน์", "รุ่งเรือง", "ดีเลิศ", "เจริญพร", "พิพัฒนา", "ปัญญาสกุล", "วงศ์เทวา", "ประดิษฐ์ศิลป์", "เกียรติขจร", "สิทธิรักษ์", "ศิริวัฒน์"];

        const mockStudents = [];
        let idCounter = 50001;
        const levels = ["ม.1", "ม.2", "ม.3", "ม.4", "ม.5", "ม.6"];
        const targetYear = getActiveYear();
        
        for (let i = 0; i < 100; i++) {
            const level = levels[i % levels.length];
            const isHighSchool = (level === "ม.4" || level === "ม.5" || level === "ม.6");
            const isBoy = Math.random() > 0.5;
            
            const prefix = isBoy 
                ? (isHighSchool ? "นาย" : "เด็กชาย") 
                : (isHighSchool ? "นางสาว" : "เด็กหญิง");
            const firstName = isBoy 
                ? thaiBoysFirstNames[Math.floor(Math.random() * thaiBoysFirstNames.length)] 
                : thaiGirlsFirstNames[Math.floor(Math.random() * thaiGirlsFirstNames.length)];
            const lastName = thaiLastNames[Math.floor(Math.random() * thaiLastNames.length)];
            
            const room = (i % 3) + 1; // Rooms 1 to 3
            const number = Math.floor(i / 18) + 1; 

            mockStudents.push({
                student_id: String(idCounter + i),
                prefix,
                first_name: firstName,
                last_name: lastName,
                level,
                room,
                number,
                academic_year: targetYear,
                total_books: 0,
                total_pages: 0,
                total_reading_time: 0,
                total_score: 0,
                source_file: "Mock_Data_Seeding.xlsx",
                dataset_id: "mock_seed",
                import_date: new Date().toISOString()
            });
        }

        const { error: upsertErr } = await window.supabaseClient
            .from('students')
            .upsert(mockStudents, { onConflict: 'student_id,academic_year' });
            
        if (upsertErr) throw upsertErr;

        // Update active dataset config
        const activeDataset = {
            datasetId: "mock_seed_" + Date.now(),
            importDate: new Date().toISOString(),
            fileName: "Mock_Data_Seeding.xlsx",
            totalRecords: 100,
            uploadedBy: 'ผู้ดูแลระบบ (Admin)'
        };
        
        await window.supabaseClient
            .from('school_settings')
            .upsert({
                key: 'active_dataset',
                value: JSON.stringify(activeDataset),
                updated_at: new Date().toISOString()
            });

        // Rebuild Stats
        await recalculateSystemStats();

        // Log activity
        await window.supabaseClient
            .from('activity_logs')
            .insert({
                action: 'IMPORT_STUDENTS',
                details: `นำเข้าข้อมูลจำลองนักเรียน 100 คน สำเร็จ`,
                performed_by: 'ผู้ดูแลระบบ (Admin)'
            });

        alert("นำเข้าข้อมูลจำลองนักเรียน 100 คน สำเร็จเรียบร้อย!");
        currentPage = 1;
        pageCursors = {};
        loadStudentsPage();

    } catch (error) {
        console.error("Error seeding mock students:", error);
        alert("เกิดข้อผิดพลาดในการนำข้อมูลจำลองลงระบบ: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}

// Auto-seeding initial 12 teachers if database is empty
async function seedTeachersIfEmpty() {
    // No-op in Supabase production. Admin creates accounts via Edge Function.
    return;
}

function parseTeacherName(fullName) {
    if (!fullName) return { prefix: '', firstName: '', lastName: '' };
    
    const prefixes = ['Miss.', 'Miss', 'Mr.', 'Mr', 'Mrs.', 'Mrs', 'เด็กชาย', 'เด็กหญิง', 'นาย', 'นางสาว', 'นาง', 'ครู'];
    let prefix = '';
    let rest = fullName.trim();
    
    for (const p of prefixes) {
        if (rest.startsWith(p)) {
            prefix = p;
            rest = rest.substring(p.length).trim();
            break;
        }
    }
    
    const parts = rest.split(/\s+/);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || '';
    
    return { prefix, firstName, lastName };
}

function updateTeacherFormClassrooms(selectedClassrooms = []) {
    const container = document.getElementById('teacherClassroomsContainer');
    if (!container) return;
    
    const checkedGrades = Array.from(document.querySelectorAll('input[name="assignedGrades"]:checked')).map(cb => cb.value);
    
    if (checkedGrades.length === 0) {
        container.innerHTML = '<span style="color:#888; font-size:0.9rem; grid-column: span 2;">กรุณาเลือกระดับชั้นก่อน</span>';
        return;
    }
    
    let html = '';
    checkedGrades.forEach(grade => {
        let totalRooms = 11;
        if (grade === 'ม.1' || grade === 'ม.2') totalRooms = 13;
        else if (grade === 'ม.3') totalRooms = 12;
        
        for (let r = 1; r <= totalRooms; r++) {
            const roomName = `${grade}/${r}`;
            const checked = selectedClassrooms.includes(roomName) ? 'checked' : '';
            html += `
                <label style="display:inline-flex; align-items:center; gap:0.25rem; font-size:0.85rem;">
                    <input type="checkbox" name="assignedClassrooms" value="${roomName}" ${checked}>
                    ${roomName}
                </label>
            `;
        }
    });
    container.innerHTML = html;
}

function editTeacher(code, teacherDataStr) {
    const data = JSON.parse(decodeURIComponent(teacherDataStr));
    
    document.getElementById('editTeacherMode').value = "true";
    document.getElementById('teacherFormTitle').innerHTML = `<span class="material-icons-round text-icon" style="vertical-align:middle;">edit</span> แก้ไขข้อมูลคุณครู`;
    document.getElementById('btnSubmitTeacher').textContent = "💾 บันทึกการแก้ไข";
    document.getElementById('btnCancelEditTeacher').style.display = "inline-block";
    
    const codeInput = document.getElementById('newTeacherCode');
    codeInput.value = data.code;
    codeInput.disabled = true;
    
    document.getElementById('newTeacherPrefix').value = data.prefix || '';
    document.getElementById('newTeacherFirstName').value = data.firstName || '';
    document.getElementById('newTeacherLastName').value = data.lastName || '';
    
    const grades = data.assignedGrades || [];
    document.querySelectorAll('input[name="assignedGrades"]').forEach(cb => {
        cb.checked = grades.includes(cb.value);
    });
    
    const classrooms = data.assignedClassrooms || [];
    updateTeacherFormClassrooms(classrooms);
    
    document.getElementById('newTeacherActive').checked = data.isActive !== false;
}

function resetTeacherForm() {
    document.getElementById('editTeacherMode').value = "false";
    document.getElementById('teacherFormTitle').innerHTML = `<span class="material-icons-round text-icon" style="vertical-align:middle;">person_add</span> เพิ่มคุณครูใหม่`;
    document.getElementById('btnSubmitTeacher').textContent = "➕ บันทึกข้อมูลครู";
    document.getElementById('btnCancelEditTeacher').style.display = "none";
    
    const codeInput = document.getElementById('newTeacherCode');
    codeInput.value = '';
    codeInput.disabled = false;
    
    document.getElementById('newTeacherPrefix').value = '';
    document.getElementById('newTeacherFirstName').value = '';
    document.getElementById('newTeacherLastName').value = '';
    
    document.querySelectorAll('input[name="assignedGrades"]').forEach(cb => cb.checked = false);
    document.getElementById('teacherClassroomsContainer').innerHTML = '<span style="color:#888; font-size:0.9rem; grid-column: span 2;">กรุณาเลือกระดับชั้นก่อน</span>';
    
    document.getElementById('newTeacherActive').checked = true;
}

// Load Teachers List
async function loadTeachersList() {
    const tableBody = document.getElementById('adminTeachersTableBody');
    if (!tableBody) return;

    if (!window.supabaseClient) {
        renderMockTeachers();
        return;
    }

    try {
        const { data, error } = await window.supabaseClient
            .from('teachers')
            .select('*')
            .order('code', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center">ไม่มีข้อมูลคุณครูในระบบ กรุณาเพิ่มคุณครูใหม่</td></tr>`;
            return;
        }

        tableBody.innerHTML = '';
        data.forEach(teacher => {
            const tr = document.createElement('tr');
            
            const assignedGrades = teacher.assigned_grades || (teacher.assigned_level ? [teacher.assigned_level] : []);
            const assignedClassrooms = teacher.assigned_classrooms || [];
            const isActive = teacher.is_active !== false;
            
            const statusBadge = isActive 
                ? '<span class="status-badge status-approved">เปิดใช้งาน</span>' 
                : '<span class="status-badge status-rejected">ระงับการใช้งาน</span>';
            
            const parsedName = parseTeacherName(teacher.name);
            const dataStr = encodeURIComponent(JSON.stringify({
                code: teacher.code,
                prefix: parsedName.prefix || '',
                firstName: parsedName.firstName || '',
                lastName: parsedName.lastName || '',
                assignedGrades,
                assignedClassrooms,
                isActive
            }));
            
            tr.innerHTML = `
                <td><code>${teacher.code}</code></td>
                <td><strong>${teacher.name}</strong></td>
                <td>${assignedGrades.join(', ') || '-'}</td>
                <td style="max-width: 250px; overflow-x: auto; white-space: nowrap;">${assignedClassrooms.join(', ') || '-'}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex; gap:0.25rem;">
                        <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="editTeacher('${teacher.code}', '${dataStr}')">
                            <span class="material-icons-round" style="font-size:1rem; vertical-align:middle;">edit</span> แก้ไข
                        </button>
                        <button class="btn btn-danger" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="deleteTeacher('${teacher.code}')">
                            <span class="material-icons-round" style="font-size:1rem; vertical-align:middle;">delete</span> ลบ
                        </button>
                    </div>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    } catch (error) {
        console.error("Error loading teachers list:", error);
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--color-danger)">เกิดข้อผิดพลาดในการโหลดข้อมูลคุณครู</td></tr>`;
    }
}

// Render Mock Teachers for Demo/Offline
function renderMockTeachers() {
    const tableBody = document.getElementById('adminTeachersTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    const mockData = [
        { code: "THTUPPT01_1", name: "นางสาวภัสสร ลามื่อ", grades: ["ม.1"], classrooms: ["ม.1/1", "ม.1/2", "ม.1/3", "ม.1/4", "ม.1/5", "ม.1/6", "ม.1/7"], isActive: true },
        { code: "THTUPPT01_2", name: "นางสาวมัลลิกา สิงห์แฮด", grades: ["ม.1"], classrooms: ["ม.1/8", "ม.1/9", "ม.1/10", "ม.1/11", "ม.1/12", "ม.1/13"], isActive: true },
        { code: "THTUPPT02_1", name: "นางสาวกนกวรรณ รอดไหม", grades: ["ม.2"], classrooms: ["ม.2/1", "ม.2/2", "ม.2/3", "ม.2/4", "ม.2/5", "ม.2/6", "ม.2/7"], isActive: true }
    ];
    mockData.forEach(item => {
        const tr = document.createElement('tr');
        const statusBadge = item.isActive 
            ? '<span class="status-badge status-approved">เปิดใช้งาน</span>' 
            : '<span class="status-badge status-rejected">ระงับการใช้งาน</span>';
            
        tr.innerHTML = `
            <td><code>${item.code}</code></td>
            <td><strong>${item.name}</strong> (บัญชีทดสอบ)</td>
            <td>${item.grades.join(', ')}</td>
            <td>${item.classrooms.join(', ')}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-danger" style="padding:0.4rem 0.8rem; font-size:0.85rem;" onclick="deleteTeacher('${item.code}')" disabled title="บัญชีทดสอบไม่สามารถลบได้">
                    <span class="material-icons-round" style="font-size:1rem; vertical-align:middle;">delete</span> ลบ
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

// Handle Add Teacher Submit
async function handleAddTeacherSubmit(e) {
    e.preventDefault();
    
    const isEdit = document.getElementById('editTeacherMode').value === "true";
    const code = document.getElementById('newTeacherCode').value.trim();
    const prefix = document.getElementById('newTeacherPrefix').value.trim();
    const firstName = document.getElementById('newTeacherFirstName').value.trim();
    const lastName = document.getElementById('newTeacherLastName').value.trim();
    const password = document.getElementById('newTeacherPassword')?.value || '';
    
    const assignedGrades = Array.from(document.querySelectorAll('input[name="assignedGrades"]:checked')).map(cb => cb.value);
    const assignedClassrooms = Array.from(document.querySelectorAll('input[name="assignedClassrooms"]:checked')).map(cb => cb.value);
    const isActive = document.getElementById('newTeacherActive').checked;
    
    if (!code || !firstName || !lastName || assignedGrades.length === 0) {
        alert("กรุณากรอกข้อมูลให้ครบถ้วน และเลือกระดับชั้นที่ดูแลอย่างน้อย 1 ระดับชั้น");
        return;
    }
    
    if (!isEdit && !password) {
        alert("กรุณากรอกรหัสผ่านสำหรับคุณครูใหม่");
        return;
    }
    
    const name = [prefix, firstName, lastName].filter(Boolean).join(' ');
    
    if (!window.supabaseClient) {
        alert("ระบบทดลอง: เพิ่ม/แก้ไขคุณครูสำเร็จ");
        resetTeacherForm();
        return;
    }
    
    try {
        if (!isEdit) {
            // Check if teacher code already exists
            const { data: existing, error: checkErr } = await window.supabaseClient
                .from('teachers')
                .select('code')
                .eq('code', code)
                .maybeSingle();
                
            if (checkErr) throw checkErr;
            if (existing) {
                alert("เกิดข้อผิดพลาด: มีรหัสครูนี้ในระบบแล้ว");
                return;
            }
            
            // Call Edge Function to create teacher auth account and profile
            const { data: resData, error: funcErr } = await window.supabaseClient.functions.invoke('create-teacher-account', {
                body: { code, prefix, firstName, lastName, assignedGrades, assignedClassrooms, password }
            });
            
            if (funcErr) {
                let errorMsg = funcErr.message;
                if (funcErr.context && typeof funcErr.context.text === 'function') {
                    try {
                        const bodyText = await funcErr.context.text();
                        const bodyJson = JSON.parse(bodyText);
                        if (bodyJson && bodyJson.error) {
                            errorMsg = bodyJson.error;
                        } else if (bodyJson && bodyJson.message) {
                            errorMsg = bodyJson.message;
                        } else if (bodyText) {
                            errorMsg = bodyText;
                        }
                    } catch (e) {
                        console.warn("Failed to parse edge function error body:", e);
                    }
                }
                throw new Error(errorMsg);
            }
            
            if (resData && resData.error) {
                throw new Error(resData.error);
            }
        } else {
            // Update existing teacher profile
            const { error: updateErr } = await window.supabaseClient
                .from('teachers')
                .update({
                    name,
                    assigned_level: assignedGrades[0] || 'ม.1',
                    assigned_grades: assignedGrades,
                    assigned_classrooms: assignedClassrooms,
                    is_active: isActive
                })
                .eq('code', code);
                
            if (updateErr) throw updateErr;

            // If a new password is provided, update it in auth.users
            if (password) {
                const { error: pwdErr } = await window.supabaseClient.rpc('reset_teacher_password_admin', {
                    p_teacher_code: code,
                    p_new_password: password
                });
                if (pwdErr) throw pwdErr;
            }
        }
        
        invalidateDashboardCache();
        
        alert(isEdit ? "แก้ไขข้อมูลครูสำเร็จ!" : "เพิ่มข้อมูลคุณครูสำเร็จ!");
        resetTeacherForm();
        loadTeachersList();
    } catch (error) {
        console.error("Error saving teacher:", error);
        alert("บันทึกข้อมูลครูไม่สำเร็จ: " + error.message);
    }
}

// Delete Teacher
async function deleteTeacher(teacherCode) {
    if (!confirm(`คุณต้องการลบข้อมูลคุณครูรหัส ${teacherCode} ใช่หรือไม่?`)) {
        return;
    }

    if (!window.supabaseClient) {
        alert("ระบบทดลอง: ลบข้อมูลคุณครูสำเร็จ (ไม่มีฐานข้อมูลเชื่อมต่อ)");
        return;
    }

    try {
        const { error } = await window.supabaseClient
            .from('teachers')
            .delete()
            .eq('code', teacherCode);
            
        if (error) throw error;

        invalidateDashboardCache();
        
        alert(`ลบข้อมูลคุณครูรหัส ${teacherCode} เรียบร้อยแล้ว`);
        loadTeachersList();
    } catch (error) {
        console.error("Error deleting teacher:", error);
        alert(`เกิดข้อผิดพลาดในการลบคุณครู: ${error.message}`);
    }
}

// Expose teacher functions globally
window.updateTeacherFormClassrooms = updateTeacherFormClassrooms;
window.editTeacher = editTeacher;
window.resetTeacherForm = resetTeacherForm;
window.deleteTeacher = deleteTeacher;
window.loadTeachersList = loadTeachersList;
window.handleAddTeacherSubmit = handleAddTeacherSubmit;

// =========================================================
// Database Analysis & Cleanup Tools
// =========================================================

// Global storage for analysis results (used across functions)
let _dbAnalysisResult = null;

/**
 * analyzeDatabase() — scan Supabase for:
 *   1. Duplicate student records (same studentId, multiple docs)
 *   2. Orphan reading logs (log.studentId not found in students collection)
 */
async function analyzeDatabase() {
    if (!window.supabaseClient) {
        alert("ไม่สามารถวิเคราะห์ได้: ไม่ได้เชื่อมต่อ Supabase");
        return;
    }

    const btnAnalyze  = document.getElementById('btnAnalyzeDb');
    const btnCleanup  = document.getElementById('btnCleanupDb');
    const btnExport   = document.getElementById('btnExportDbReport');
    const progress    = document.getElementById('dbProgress');
    const progressBar = document.getElementById('dbProgressBar');
    const progressTxt = document.getElementById('dbProgressText');
    const statsBox    = document.getElementById('dbAnalysisStats');

    // Reset UI
    btnAnalyze.disabled = true;
    btnCleanup.style.display = 'none';
    btnExport.style.display  = 'none';
    progress.style.display   = 'block';
    statsBox.style.display   = 'none';
    _dbAnalysisResult        = null;

    const setProgress = (pct, txt) => {
        progressBar.style.width = `${pct}%`;
        progressTxt.textContent = txt;
    };

    try {
        // ── Step 1: Load all students from Supabase ──────────────────────────────
        setProgress(10, 'กำลังโหลดข้อมูลนักเรียนทั้งหมด...');
        const targetYear = getActiveYear();
        const { data: studentsData, error: sErr } = await window.supabaseClient
            .from('students')
            .select('*')
            .eq('academic_year', targetYear);
            
        if (sErr) throw sErr;
        
        const totalDocs = studentsData.length;

        // Group docs by studentId
        const byStudentId = {};
        studentsData.forEach(s => {
            const sid = s.student_id;
            if (!sid) return;
            if (!byStudentId[sid]) byStudentId[sid] = [];
            byStudentId[sid].push(s);
        });

        setProgress(40, `โหลดนักเรียน ${totalDocs} คน เรียบร้อย — กำลังหา duplicates...`);

        // Find duplicates: groups where length > 1
        const duplicateGroups = Object.entries(byStudentId)
            .filter(([, docs]) => docs.length > 1)
            .map(([sid, docs]) => {
                // Sort oldest first (created_at asc)
                const sorted = docs.sort((a, b) => {
                    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
                    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
                    return ta - tb;
                });
                return { sid, docs: sorted };
            });

        const duplicateDocCount = duplicateGroups.reduce((sum, g) => sum + g.docs.length - 1, 0);
        const uniqueCount       = Object.keys(byStudentId).length;

        setProgress(60, 'กำลังตรวจสอบบันทึกการอ่านกำพร้า (Orphan Logs)...');

        // ── Step 2: Load all reading logs from Supabase ─────────────────────────
        const { data: reportsData, error: rErr } = await window.supabaseClient
            .from('reading_reports')
            .select('*')
            .eq('academic_year', targetYear);
            
        if (rErr) throw rErr;

        // Build a set of known studentIds
        const knownStudentIds = new Set(Object.keys(byStudentId));

        const orphanLogs = [];
        (reportsData || []).forEach(r => {
            const sid = r.student_id;
            if (sid && !knownStudentIds.has(String(sid))) {
                orphanLogs.push(r);
            }
        });

        setProgress(90, 'กำลังแสดงผลลัพธ์...');

        // ── Step 3: Store results and render ──────────────────────
        _dbAnalysisResult = { duplicateGroups, orphanLogs, totalDocs, uniqueCount, duplicateDocCount };

        // Update stat cards
        document.getElementById('dbTotalStudents').textContent  = `${totalDocs} คน`;
        document.getElementById('dbDuplicateCount').textContent = `${duplicateDocCount} รายการ`;
        document.getElementById('dbOrphanCount').textContent    = `${orphanLogs.length} รายการ`;
        document.getElementById('dbUniqueCount').textContent    = `${uniqueCount} คน`;
        statsBox.style.display = 'grid';

        // Render duplicates table
        const dupBody = document.getElementById('dbDuplicateTableBody');
        const dupSection = document.getElementById('dbDuplicateSection');
        if (duplicateGroups.length > 0) {
            dupBody.innerHTML = duplicateGroups.slice(0, 200).map(g => {
                const d = g.docs[0];
                const name = `${d.prefix || ''}${d.first_name || ''} ${d.last_name || ''}`.trim();
                const level = formatLevel(d.level);
                return `<tr>
                    <td><strong>${g.sid}</strong></td>
                    <td>${name || '-'}</td>
                    <td>${level} / ห้อง ${d.room || '-'}</td>
                    <td style="color:#ef4444; font-weight:600;">${g.docs.length} รายการ</td>
                    <td style="color:#ef4444;">${g.docs.length - 1} รายการ</td>
                </tr>`;
            }).join('');
            if (duplicateGroups.length > 200) {
                dupBody.innerHTML += `<tr><td colspan="5" class="text-center" style="color:#6b7280; font-style:italic;">...และอีก ${duplicateGroups.length - 200} กลุ่ม (แสดงแค่ 200 แรก)</td></tr>`;
            }
            dupSection.style.display = 'block';
        } else {
            dupBody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:#10b981;">✅ ไม่พบรายการซ้ำ</td></tr>';
            dupSection.style.display = 'block';
        }

        // Render orphan logs table
        const orphanBody = document.getElementById('dbOrphanTableBody');
        const orphanSection = document.getElementById('dbOrphanSection');
        if (orphanLogs.length > 0) {
            orphanBody.innerHTML = orphanLogs.slice(0, 200).map(r => {
                const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '-';
                return `<tr>
                    <td style="font-size:0.78rem; color:#9ca3af;">${r.id.substring(0, 10)}...</td>
                    <td style="color:#f59e0b; font-weight:600;">${r.student_id || '-'}</td>
                    <td>${r.book_title || '-'}</td>
                    <td>${dateStr}</td>
                </tr>`;
            }).join('');
            if (orphanLogs.length > 200) {
                orphanBody.innerHTML += `<tr><td colspan="4" class="text-center" style="color:#6b7280; font-style:italic;">...และอีก ${orphanLogs.length - 200} รายการ (แสดงแค่ 200 แรก)</td></tr>`;
            }
            orphanSection.style.display = 'block';
        } else {
            orphanBody.innerHTML = '<tr><td colspan="4" class="text-center" style="color:#10b981;">✅ ไม่พบบันทึกกำพร้า</td></tr>';
            orphanSection.style.display = 'block';
        }

        setProgress(100, `✅ วิเคราะห์เสร็จสิ้น — พบ Duplicates: ${duplicateDocCount} | Orphans: ${orphanLogs.length} รายการ`);

        // Show cleanup & export buttons
        if (duplicateDocCount > 0) btnCleanup.style.display = 'inline-flex';
        btnExport.style.display = 'inline-flex';

    } catch (err) {
        console.error("analyzeDatabase error:", err);
        setProgress(0, `❌ เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
        btnAnalyze.disabled = false;
    }
}

/**
 * cleanupDuplicates() — delete duplicate student docs
 * Keeps the oldest doc per studentId, deletes the rest using Supabase client.
 */
async function cleanupDuplicates() {
    if (!_dbAnalysisResult) {
        alert("กรุณาวิเคราะห์ฐานข้อมูลก่อน");
        return;
    }

    const { duplicateGroups, duplicateDocCount } = _dbAnalysisResult;

    if (duplicateDocCount === 0) {
        alert("ไม่พบรายการซ้ำ ไม่จำเป็นต้องทำความสะอาด");
        return;
    }

    const confirmed = confirm(
        `⚠️ คำเตือน!\n\nระบบจะลบ ${duplicateDocCount} รายการซ้ำออก\n` +
        `(เก็บข้อมูลแรกสุดไว้ 1 รายการต่อ studentId)\n\n` +
        `การดำเนินการนี้ไม่สามารถกู้คืนได้\nต้องการดำเนินการต่อหรือไม่?`
    );
    if (!confirmed) return;

    const btnCleanup  = document.getElementById('btnCleanupDb');
    const progressBar = document.getElementById('dbProgressBar');
    const progressTxt = document.getElementById('dbProgressText');
    const progress    = document.getElementById('dbProgress');
    progress.style.display   = 'block';
    btnCleanup.disabled      = true;

    let deleted = 0;

    try {
        // Collect all IDs-to-delete (skip index 0 = oldest/keep)
        const toDeleteIds = [];
        duplicateGroups.forEach(g => {
            g.docs.slice(1).forEach(s => toDeleteIds.push(s.id));
        });

        // Delete from Supabase
        const { error } = await window.supabaseClient
            .from('students')
            .delete()
            .in('id', toDeleteIds);
            
        if (error) throw error;
        
        deleted = toDeleteIds.length;

        progressTxt.textContent = `✅ ลบเรียบร้อย! ลบไปทั้งหมด ${deleted} รายการ`;
        alert(`ทำความสะอาดฐานข้อมูลสำเร็จ!\nลบข้อมูลซ้ำ ${deleted} รายการเรียบร้อยแล้ว`);

        // Re-analyze to refresh results
        _dbAnalysisResult = null;
        btnCleanup.style.display = 'none';
        await analyzeDatabase();

    } catch (err) {
        console.error("cleanupDuplicates error:", err);
        alert(`เกิดข้อผิดพลาดในการลบ: ${err.message}`);
    } finally {
        btnCleanup.disabled = false;
        invalidateDashboardCache();
        loadDashboardStats(); // Refresh main stats
    }
}

/**
 * exportDbReport() — export the analysis results as an Excel file
 */
function exportDbReport() {
    if (!_dbAnalysisResult) {
        alert("กรุณาวิเคราะห์ฐานข้อมูลก่อน");
        return;
    }

    const { duplicateGroups, orphanLogs, totalDocs, uniqueCount, duplicateDocCount } = _dbAnalysisResult;

    // Sheet 1: Summary
    const summary = [
        ['รายงานการวิเคราะห์ฐานข้อมูล', '', new Date().toLocaleString('th-TH')],
        [],
        ['รายการ', 'จำนวน'],
        ['ข้อมูลนักเรียนทั้งหมด', totalDocs],
        ['StudentId ไม่ซ้ำ (Unique)', uniqueCount],
        ['ข้อมูลซ้ำที่ต้องลบ', duplicateDocCount],
        ['บันทึกการอ่านกำพร้า', orphanLogs.length],
    ];

    // Sheet 2: Duplicates detail
    const dupRows = [['รหัสนักเรียน', 'ชื่อ', 'ระดับ', 'ห้อง', 'จำนวน Docs', 'จะลบ']];
    duplicateGroups.forEach(g => {
        const d = g.docs[0];
        dupRows.push([
            g.sid,
            `${d.prefix || ''}${d.first_name || ''} ${d.last_name || ''}`.trim(),
            formatLevel(d.level),
            d.room || '',
            g.docs.length,
            g.docs.length - 1
        ]);
    });

    // Sheet 3: Orphans detail
    const orphanRows = [['Log ID', 'studentId อ้างอิง', 'ชื่อหนังสือ', 'วันที่']];
    orphanLogs.forEach(r => {
        const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString('th-TH') : '-';
        orphanRows.push([r.id, r.student_id || '-', r.book_title || '-', dateStr]);
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary),   'สรุป');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dupRows),   'Duplicates');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orphanRows),'Orphan Logs');

    const filename = `db_analysis_${new Date().toISOString().slice(0,10)}.xlsx`;
    XLSX.writeFile(wb, filename);
}

// Expose database tool functions globally
window.analyzeDatabase    = analyzeDatabase;
window.cleanupDuplicates  = cleanupDuplicates;
window.exportDbReport     = exportDbReport;

// Expose student data management and import functions globally
window.importExcelData = importExcelData;
window.handlePreviewSheetChange = handlePreviewSheetChange;
window.closeImportPreview = closeImportPreview;
window.confirmExcelImport = confirmExcelImport;
window.applyFiltersAndRenderTable = applyFiltersAndRenderTable;
window.handleLevelFilterChange = handleLevelFilterChange;
window.exportStudentsToExcel = exportStudentsToExcel;
window.exportStudentsToPDF = exportStudentsToPDF;
window.deleteAllStudents = deleteAllStudents;
window.seedMockStudents = seedMockStudents;
window.saveTelegramConfigs = saveTelegramConfigs;
window.testTelegramNotification = testTelegramNotification;
window.testLevelTelegramConfig = testLevelTelegramConfig;
window.toggleSelectAllStudents = toggleSelectAllStudents;
window.handleRowCheckboxChange = handleRowCheckboxChange;
window.deleteSingleStudent = deleteSingleStudent;
window.deleteSelectedStudents = deleteSelectedStudents;
window.changePageSize = changePageSize;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.updateAnalyticsChart = updateAnalyticsChart;

// ── Onboarding Passcode Helpers ───────────────────────────────
function generatePasscode() {
    return 'TUPREAD'; // ใช้รหัสเปิดใช้งานชั่วคราวเป็น 'TUPREAD' เหมือนกันทุกคนเพื่อความสะดวกในการแจกจ่าย
}

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function showPasscodeDownloadUI(count) {
    let banner = document.getElementById('passcodeDownloadBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'passcodeDownloadBanner';
        banner.className = 'alert alert-info mt-3';
        banner.style.padding = '1rem';
        banner.style.borderRadius = '8px';
        banner.style.backgroundColor = '#e3f2fd';
        banner.style.border = '1px solid #90caf9';
        banner.style.color = '#0d47a1';
        banner.style.display = 'flex';
        banner.style.flexDirection = 'column';
        banner.style.gap = '0.5rem';
        
        const activeBanner = document.getElementById('activeDatasetBanner');
        if (activeBanner) {
            activeBanner.parentNode.insertBefore(banner, activeBanner.nextSibling);
        } else {
            const parent = document.getElementById('studentsSec') || document.body;
            parent.appendChild(banner);
        }
    }
    
    banner.innerHTML = `
        <div style="font-weight: bold; font-size: 1rem;">🔑 สร้างรหัสผ่านลงทะเบียนชั่วคราว (Passcode) สำเร็จ!</div>
        <div>ระบบได้สร้างรหัสลงทะเบียนสำหรับนักเรียนใหม่จำนวน <strong>${count} คน</strong></div>
        <button class="btn btn-primary" onclick="downloadImportedPasscodes()" style="background-color: #1565c0; border: none; padding: 0.5rem 1rem; border-radius: 4px; color: white; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; width: fit-content; margin-top: 0.25rem;">
            <span class="material-icons-round" style="font-size: 1.2rem;">download</span> ดาวน์โหลดรหัสผ่านลงทะเบียน (Excel)
        </button>
    `;
}

function downloadImportedPasscodes() {
    if (!window.latestPasscodeExportList || window.latestPasscodeExportList.length === 0) {
        alert("ไม่มีรหัสผ่านลงทะเบียนที่ถูกสร้างขึ้นในเซสชันนี้");
        return;
    }

    const dataRows = window.latestPasscodeExportList.map(item => ({
        "รหัสประจำตัว": item.studentId,
        "ชื่อ-นามสกุล": item.name,
        "ระดับชั้น": item.level,
        "ห้อง": item.room,
        "เลขที่": item.number,
        "รหัสผ่านเข้าใช้งานชั่วคราว (Passcode)": item.passcode
    }));

    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "รหัสผ่านลงทะเบียนชั่วคราว");
    
    // Auto-fit column widths
    const maxLens = {};
    dataRows.forEach(row => {
        Object.entries(row).forEach(([col, val]) => {
            const len = String(val).length + 4;
            maxLens[col] = Math.max(maxLens[col] || 10, len);
        });
    });
    worksheet['!cols'] = Object.keys(maxLens).map(col => ({ wch: maxLens[col] }));

    XLSX.writeFile(workbook, `รหัสลงทะเบียนชั่วคราว_นักเรียนใหม่_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

window.downloadImportedPasscodes = downloadImportedPasscodes;

