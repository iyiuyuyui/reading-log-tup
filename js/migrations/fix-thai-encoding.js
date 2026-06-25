/**
 * One-Time Thai Mojibake Migration Utility (Supabase Edition)
 */

const DRY_RUN = true;

// Corrections mapping from sanitizeThaiString
const encodingCorrections = {
    'เธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ\\s*\\(Admin\\)': 'ผู้ดูแลระบบ (Admin)',
    'เธเธนเนเธ”เธนเนเธฅเธฃเธฐเธเธ': 'ผู้ดูแลระบบ',
    'เธเธนเนเธ”เธนเนเธฅ': 'ผู้ดูแล',
    'เธเธฃเธน': 'ครู',
    'เธ”\\.เธ\\.': 'ด.ช.',
    'เธ”\\.เธซ\\.': 'ด.ญ.',
    'เนเธ”เนเธญเธเธฒเธข': 'เด็กชาย',
    'เนเธ”เนเธญเธเธซเธเธดเธ': 'เด็กหญิง',
    'เธ”เธตเธกเธฒเธก': 'ดีมาก',
    'เธ”เธต': 'ดี',
    'เธเธญเนเธเธ': 'พอใช้',
    'เธเธฑเธเธชเธฃ\\s+เธฅเธฒเธกเธทเนเธ': 'ภัสสร ลามื่อ',
    'เธกเธฑเธฅเธฅเธดเธเธฒ\\s+เธชเธดเธเธซเนเธซเธ': 'มัลลิกา สิงห์แฮด',
    'เธเธเธเธงเธฃเธฃเธ\\s+เธฃเธญเธ”เนเธซเธก': 'กนกวรรณ รอดไหม',
    'เนเธกเธฉเธฒเธเธ\\s+เธเธเธซเนเธจเธดเธฅเธฒ': 'เมษญาณ์ พงษ์ศิลา',
    'เธเธฑเธฅเธขเธฒ\\s+เธงเธดเธเธขเธฒเธจเธดเธฃเธดเธเธธเธฅ': 'กัลยา วิทยาศิริกุล',
    'เธฅเธ”เธฒเธงเธฑเธฅเธขเน\\s+เธ”เธงเธเธฃเธดเธเธฃ': 'ลดาวัลย์ ดวงจิตร',
    'เธเธฃเธฃเธ犅เธดเธเธฒเธฃเน\\s+เธญเธดเธเธเธญเธ': 'กรรณิการ์ อินนอก',
    'เธเธดเธขเธเธเธเธ\\s+เธเธเธซเนเธชเธฃเธฐเธเธฑเธ': 'ปิยพนธ์ พงษ์สระพัง',
    'เธงเธธเธดเธเธฑเธข\\s+เธเธญเธเธชเธฒเธข': 'วุฒิชัย ทองสาย',
    'เธศเธฃเธฑเธเธขเนเธเธเธ\\s+เธเธฃเธฐเธชเธเธเเน': 'ศรัณย์พงศ์ ประสงค์',
    'เธเธธเธชเธฃเธฒ\\s+เธกเธ”เธเธ': 'นุสรา มดคำ',
    'เธเธฑเธเธชเธฃ': 'ภัสสร',
    'เธฅเธฒเธกเธทเนเธ': 'ลามื่อ',
    'เธกเธฑเธฅเธฅเธดเธเธฒ': 'มัลลิกา',
    'เธชเธดเธเธซเนเธซเธ': 'สิงห์แฮด',
    'เธเธเธเธงเธฃเธฃเธ': 'กนกวรรณ',
    'เธฃเธญเธ”เนเธซเธก': 'รอดไหม',
    'เนเธกเธฉเธฒเธเธ': 'เมษญาณ์',
    'เธเธเธซเนเธจเธดเธฅเธฒ': 'พงษ์ศิลา',
    'เธเธฑเธฅเธขเธฒ': 'กัลยา',
    'เธงเธดเธเธขเธฒเธจเธดเธฃเธดเธเธธเธฅ': 'วิทยาศิริกุล',
    'เธฅเธ”เธฒเธงเธฑเธฅเธขเน': 'ลดาวัลย์',
    'เธ”เธงเธเธฃเธดเธเธฃ': 'ดวงจิตร',
    'เธเธฃเธฃเธ犅เธดเธเธฒเธฃเน': 'กรรณิการ์',
    'เธญเธดเธเธเธญเธ': 'อินนอก',
    'เธเธดเธขเธเธเธเธ': 'ปิยพนธ์',
    'เธเธเธซเนเธชเธฃเธฐเธเธฑเธ': 'พงษ์สระพัง',
    'เธงเธธเธดเธเธฑเธข': 'วุฒิชัย',
    'เธเธญเธเธชเธฒเธข': 'ทองสาย',
    'เธศเธฃเธฑเธเธขเนเธเธเธ': 'ศรัณย์พงศ์',
    'เธเธฃเธฐเธชเธเธเเน': 'ประสงค์',
    'เธเธธเธชเธฃเธฒ': 'นุสรา',
    'เธกเธ”เธเธ': 'มดคำ',
    'เธเธฒเธข': 'นาย',
    'เธเธฒเธเธชเธฒเธ': 'นางสาว',
    'เธเธฒเธ': 'นาง'
};

function sanitizeThaiString(str) {
    if (!str || typeof str !== 'string') return str;
    let result = str;
    for (const [bad, good] of Object.entries(encodingCorrections)) {
        result = result.replace(new RegExp(bad, 'g'), good);
    }
    return result;
}

function hasCorruptedThai(str) {
    if (typeof str !== 'string') return false;
    const patterns = ['เธ', 'เน', 'เธฅ', 'เธฐ', 'เธ', 'เธนเน'];
    return patterns.some(p => str.includes(p));
}

// Recursively traverse and fix fields of an object
function fixObjectFields(obj, modifiedFields) {
    let changed = false;
    const newObj = { ...obj };

    for (const key in newObj) {
        if (Object.prototype.hasOwnProperty.call(newObj, key)) {
            const val = newObj[key];
            if (typeof val === 'string') {
                if (hasCorruptedThai(val)) {
                    const fixed = sanitizeThaiString(val);
                    if (fixed !== val) {
                        newObj[key] = fixed;
                        modifiedFields.push(key);
                        changed = true;
                    }
                }
            } else if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
                const nestedResult = fixObjectFields(val, modifiedFields);
                if (nestedResult.changed) {
                    newObj[key] = nestedResult.data;
                    changed = true;
                }
            }
        }
    }
    return { changed, data: newObj };
}

window.runThaiEncodingMigration = async function(dryRun = DRY_RUN, progressCallback = null) {
    if (!window.supabaseClient) {
        alert("Supabase Client is not initialized.");
        return;
    }

    const tables = ['teachers', 'students', 'reading_reports'];
    let totalScanned = 0;
    let totalModified = 0;
    const fixedFieldsSet = new Set();
    const beforeAfterLogs = [];
    const startTime = Date.now();

    const updateProgress = (text) => {
        if (progressCallback && typeof progressCallback === 'function') {
            progressCallback(text);
        }
        console.log(`[MIGRATION] ${text}`);
    };

    updateProgress("Starting Thai Encoding Migration (Supabase Cloud Edition)...");
    if (dryRun) {
        updateProgress("⚠️ RUNNING IN DRY RUN MODE - No database changes will be committed!");
    }

    for (const tableName of tables) {
        updateProgress(`Scanning table: ${tableName}...`);
        try {
            const { data: rows, error: fetchErr } = await window.supabaseClient
                .from(tableName)
                .select('*');

            if (fetchErr) throw fetchErr;

            const recordsToUpdate = [];

            (rows || []).forEach(row => {
                totalScanned++;
                const modifiedFields = [];
                const res = fixObjectFields(row, modifiedFields);

                if (res.changed) {
                    recordsToUpdate.push({
                        id: row.id,
                        newData: res.data,
                        fields: modifiedFields,
                        oldData: row
                    });
                    totalModified++;
                    modifiedFields.forEach(f => fixedFieldsSet.add(`${tableName}.${f}`));

                    // Log first few corrections for display
                    if (beforeAfterLogs.length < 5) {
                        modifiedFields.forEach(f => {
                            beforeAfterLogs.push({
                                field: `${tableName}.${f}`,
                                before: row[f] || "(nested object string)",
                                after: res.data[f] || "(nested object string)"
                            });
                        });
                    }
                }
            });

            updateProgress(`Found ${recordsToUpdate.length} records to fix in ${tableName}.`);

            if (!dryRun && recordsToUpdate.length > 0) {
                for (let i = 0; i < recordsToUpdate.length; i++) {
                    const item = recordsToUpdate[i];
                    updateProgress(`Updating ${tableName} record (${i + 1}/${recordsToUpdate.length})...`);
                    
                    const updatePayload = {};
                    item.fields.forEach(f => {
                        updatePayload[f] = item.newData[f];
                    });

                    const { error: updateErr } = await window.supabaseClient
                        .from(tableName)
                        .update(updatePayload)
                        .eq('id', item.id);

                    if (updateErr) {
                        console.error(`Failed to update ${tableName} with ID ${item.id}:`, updateErr);
                        updateProgress(`❌ Error updating record ID ${item.id}: ${updateErr.message}`);
                    }
                }
            }

        } catch (err) {
            console.error(`Error migrating table ${tableName}:`, err);
            updateProgress(`❌ Error migrating table ${tableName}: ${err.message}`);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const modeStr = dryRun ? "Dry Run" : "Production Run";

    let logsStr = "";
    beforeAfterLogs.forEach(l => {
        logsStr += `
Before:
${l.before}

After:
${l.after}
`;
    });

    const report = 
`========== THAI ENCODING MIGRATION (${modeStr.toUpperCase()}) ==========
Tables Scanned: ${tables.join(', ')}

Records Scanned: ${totalScanned.toLocaleString('th-TH')}
Records Modified: ${totalModified.toLocaleString('th-TH')}

Fields Fixed:
${fixedFieldsSet.size > 0 ? Array.from(fixedFieldsSet).map(f => `- ${f}`).join('\n') : "(None)"}

Examples:
${logsStr || "(None)"}
Execution Time: ${duration}s
============================================`;

    return report;
};

window.runMigrationUI = async function(dryRun) {
    const btnDry = document.getElementById('btnMigrationDryRun');
    const btnProd = document.getElementById('btnMigrationProdRun');
    const progressDiv = document.getElementById('migrationProgress');
    const progressTxt = document.getElementById('migrationProgressText');
    const reportCard = document.getElementById('migrationReportCard');
    const reportContent = document.getElementById('migrationReportContent');

    if (!confirm(dryRun 
        ? "คุณต้องการรันตัววิเคราะห์ภาษาเพี้ยนใช่หรือไม่? (จะยังไม่มีการเขียนข้อมูลลงระบบ)" 
        : "⚠️ คำเตือน: คุณต้องการเริ่มบันทึกแก้ไขตัวอักษรภาษาไทยเพี้ยนลงฐานข้อมูลใช่หรือไม่?\n\nควรเปิดรันตัววิเคราะห์ (Dry Run) ดูก่อนเสมอ"
    )) {
        return;
    }

    if (btnDry) btnDry.disabled = true;
    if (btnProd) btnProd.disabled = true;
    if (progressDiv) progressDiv.style.display = 'block';
    if (reportCard) reportCard.style.display = 'none';

    try {
        const report = await window.runThaiEncodingMigration(dryRun, (text) => {
            if (progressTxt) progressTxt.textContent = text;
        });

        if (reportContent) reportContent.textContent = report;
        if (reportCard) reportCard.style.display = 'block';
    } catch (err) {
        alert("เกิดข้อผิดพลาดในการรัน Migration: " + err.message);
    } finally {
        if (btnDry) btnDry.disabled = false;
        if (btnProd) btnProd.disabled = false;
        if (progressDiv) progressDiv.style.display = 'none';
    }
};
