/**
 * academic-year.js — Academic Year Management Module (Supabase Cloud Edition)
 *
 * Provides CRUD operations and UI rendering for the
 * "จัดการปีการศึกษา" section in the admin dashboard.
 */

// ── State ─────────────────────────────────────────────────────
let allAcademicYears = [];

// ── Load & Render ─────────────────────────────────────────────
async function loadAcademicYears() {
    const tbody = document.getElementById('academicYearsTable');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5" class="text-center">กำลังโหลด...</td></tr>`;

    if (!window.supabaseClient) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">ระบบจำลอง: ไม่มีฐานข้อมูลเชื่อมต่อ</td></tr>`;
        return;
    }

    try {
        const { data: years, error } = await window.supabaseClient
            .from('academic_years')
            .select('*')
            .eq('is_active', true)
            .order('year_name', { ascending: false });

        if (error) throw error;

        allAcademicYears = years || [];
        renderAcademicYearsTable(allAcademicYears);
    } catch (error) {
        console.error("Error loading academic years:", error);
        tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--color-danger)">เกิดข้อผิดพลาด: ${error.message}</td></tr>`;
    }
}

function renderAcademicYearsTable(years) {
    const tbody = document.getElementById('academicYearsTable');
    if (!tbody) return;

    if (years.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center">ยังไม่มีปีการศึกษาในระบบ</td></tr>`;
        return;
    }

    tbody.innerHTML = years.map(y => {
        const defaultBadge = y.is_default
            ? `<span class="badge badge-primary" style="margin-left:4px;">ค่าเริ่มต้น</span>`
            : '';
        const dateStr = y.created_at ? formatThaiDate(new Date(y.created_at)) : '-';

        return `
        <tr>
            <td><strong>ทุกระดับชั้น (ม.1 - ม.6)</strong></td>
            <td><strong>${escapeHtml(y.year_name)}</strong></td>
            <td>${defaultBadge ? defaultBadge : '<span class="badge badge-secondary">ทั่วไป</span>'}</td>
            <td>${dateStr}</td>
            <td style="white-space:nowrap; text-align:center;">
                ${!y.is_default ? `<button class="btn btn-sm btn-primary" onclick="setDefaultYear('${y.year_name}')" title="ตั้งเป็นค่าเริ่มต้น">⭐ ตั้งค่าเริ่มต้น</button>` : ''}
                <button class="btn btn-sm" onclick="openYearModal('${y.year_name}')" title="แก้ไข">✏️ แก้ไข</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAcademicYear('${y.year_name}')" title="ลบ">🗑️ ลบ</button>
            </td>
        </tr>`;
    }).join('');
}

// ── Modal ─────────────────────────────────────────────────────
function openYearModal(id) {
    const year = id ? allAcademicYears.find(y => y.year_name === id) : null;
    const modal = document.getElementById('yearModal');
    if (!modal) return;

    document.getElementById('yearModalTitle').textContent = year ? 'แก้ไขปีการศึกษา' : 'เพิ่มปีการศึกษาใหม่';
    document.getElementById('yearModalId').value           = year?.year_name || '';
    
    // Set level select - kept for compatibility, but the new database schema uses global years
    const lvlSelect = document.getElementById('yearLevelInput');
    if (lvlSelect) {
        lvlSelect.value = 'ม.1';
    }
    document.getElementById('yearNameInput').value         = year?.year_name || '';

    modal.style.display = 'flex';
}

function closeYearModal() {
    const modal = document.getElementById('yearModal');
    if (modal) modal.style.display = 'none';
}

async function handleYearFormSubmit(e) {
    e.preventDefault();
    const id         = document.getElementById('yearModalId').value; // if editing, old year_name
    const yearName   = document.getElementById('yearNameInput').value.trim();

    if (!yearName) { showToast('กรุณากรอกปีการศึกษา', 'warning'); return; }

    if (!window.supabaseClient) {
        showToast('ฐานข้อมูลยังไม่ได้เชื่อมต่อ', 'error');
        return;
    }

    try {
        if (id && id !== yearName) {
            // Check if new yearName already exists
            const { data: existing } = await window.supabaseClient
                .from('academic_years')
                .select('year_name')
                .eq('year_name', yearName)
                .maybeSingle();

            if (existing) {
                showToast(`ปีการศึกษา ${yearName} มีอยู่แล้วในระบบ`, 'warning');
                return;
            }

            // Create new academic year
            const { error: insertErr } = await window.supabaseClient
                .from('academic_years')
                .insert({
                    year_name: yearName,
                    display_name: `ปีการศึกษา ${yearName}`,
                    is_active: true,
                    is_default: false
                });
            if (insertErr) throw insertErr;

            // Soft-delete or archive the old year
            const { error: deleteErr } = await window.supabaseClient
                .from('academic_years')
                .update({ is_active: false })
                .eq('year_name', id);
            if (deleteErr) throw deleteErr;

            showToast('แก้ไขปีการศึกษาสำเร็จ', 'success');
        } else {
            // Upsert year
            const { error } = await window.supabaseClient
                .from('academic_years')
                .upsert({
                    year_name: yearName,
                    display_name: `ปีการศึกษา ${yearName}`,
                    is_active: true,
                    is_default: false,
                    updated_at: new Date().toISOString()
                });

            if (error) throw error;
            showToast('บันทึกปีการศึกษาสำเร็จ', 'success');
        }
        closeYearModal();
        await loadAcademicYears();
        
        // Fire updates on selectors
        if (typeof populateYearSelector === 'function') {
            const adminSelect = document.getElementById('globalYearSelect');
            if (adminSelect) await populateYearSelector('globalYearSelect', window.currentAcademicYear);
        }
    } catch (err) {
        console.error('handleYearFormSubmit:', err);
        showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
}

// ── CRUD Actions ──────────────────────────────────────────────
async function setDefaultYear(yearName) {
    if (!yearName || !window.supabaseClient) return;
    
    if (!confirm(`ตั้งปีการศึกษา ${yearName} เป็นค่าเริ่มต้นใช่หรือไม่?\nนักเรียนและครูจะเข้าสู่ระบบในปีนี้โดยอัตโนมัติ`)) return;

    try {
        // 1. Unset all defaults
        const { error: unsetErr } = await window.supabaseClient
            .from('academic_years')
            .update({ is_default: false })
            .neq('year_name', yearName);
        if (unsetErr) throw unsetErr;

        // 2. Set new default
        const { error: setErr } = await window.supabaseClient
            .from('academic_years')
            .update({ is_default: true })
            .eq('year_name', yearName);
        if (setErr) throw setErr;
        
        // 3. Store the globally selected academic year in school_settings key = 'current_academic_year'
        const { error: settingErr } = await window.supabaseClient
            .from('school_settings')
            .upsert({
                key: 'current_academic_year',
                value: yearName,
                updated_at: new Date().toISOString()
            });
        if (settingErr) throw settingErr;

        // Update local session
        window.currentAcademicYear   = yearName;
        window.currentAcademicYearId = yearName;
        sessionStorage.setItem('currentAcademicYear',   yearName);
        sessionStorage.setItem('currentAcademicYearId', yearName);

        showToast(`ตั้งค่าปีการศึกษาเริ่มต้น ${yearName} สำเร็จ`, 'success');
        await loadAcademicYears();
    } catch (err) {
        console.error('setDefaultYear:', err);
        showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
}

async function deleteAcademicYear(yearName) {
    if (!yearName || !window.supabaseClient) return;
    if (!confirm(`⚠️ คุณแน่ใจที่จะลบปีการศึกษา "${yearName}"?\nการดำเนินการนี้จะซ่อนข้อมูลปีการศึกษาออกจากระบบ (Soft-delete)`)) return;

    try {
        // Perform soft delete
        const { error } = await window.supabaseClient
            .from('academic_years')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('year_name', yearName);

        if (error) throw error;

        showToast('ลบปีการศึกษาสำเร็จ (Soft-delete)', 'success');
        await loadAcademicYears();
    } catch (err) {
        console.error('deleteAcademicYear:', err);
        showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
    }
}

// ── Year Selector (shared helper) ───────────────────────────
async function populateYearSelector(selectElementId, activeYear) {
    const sel = document.getElementById(selectElementId);
    if (!sel || !window.supabaseClient) return;

    try {
        const { data: years, error } = await window.supabaseClient
            .from('academic_years')
            .select('year_name')
            .eq('is_active', true)
            .order('year_name', { ascending: false });

        if (error) throw error;
        
        sel.innerHTML = '';
        (years || []).forEach(y => {
            const opt = document.createElement('option');
            opt.value = y.year_name;
            opt.textContent = `ปีการศึกษา ${y.year_name}`;
            if (y.year_name === activeYear) opt.selected = true;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('populateYearSelector error:', err);
    }
}

// Expose
window.loadAcademicYears    = loadAcademicYears;
window.openYearModal        = openYearModal;
window.closeYearModal       = closeYearModal;
window.handleYearFormSubmit = handleYearFormSubmit;
window.setDefaultYear       = setDefaultYear;
window.deleteAcademicYear   = deleteAcademicYear;
window.populateYearSelector = populateYearSelector;
