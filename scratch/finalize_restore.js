const fs = require('fs');
const path = require('path');

const restoredPath = path.join(__dirname, '../js/admin_restored.js');
const targetPath = path.join(__dirname, '../js/admin.js');

let content = fs.readFileSync(restoredPath, 'utf8');

// 1. Replace the 7 corrupted lines with correct Thai string literals
const replacements = [
    {
        target: 'if (!window.db) throw new Error("?ม??ด?เชื?อมต?อ า???อมูล");',
        replacement: 'if (!window.db) throw new Error("ไม่ได้เชื่อมต่อฐานข้อมูล");'
    },
    {
        target: 'progressTxt.textContent = `?หมด Replace: ลบ??อมูล?ั เรีย??อง?ี ารศึ ษา ${targetYear} ที?ตรง ับระดับชั???ำเ??า...`;',
        replacement: 'progressTxt.textContent = `โหมด Replace: กำลังลบข้อมูลนักเรียนของปีการศึกษา ${targetYear} ที่ตรงกับระดับชั้นนำเข้า...`;'
    },
    {
        target: "progressTxt.textContent = ' ำลังดำเ?ิ? าร?ำเ??า??อมูล?ั เรีย?...';",
        replacement: "progressTxt.textContent = 'กำลังดำเนินการนำเข้าข้อมูลนักเรียน...';"
    },
    {
        target: 'progressTxt.textContent = ` ำลัง?ำเ??าราย าร... ${idx + 1}/${students.length} ??`;',
        replacement: 'progressTxt.textContent = `กำลังนำเข้ารายการ... ${idx + 1}/${students.length} คน`;'
    },
    {
        target: 'progressTxt.textContent = `เสร็?สม extravaganza! ?ัด าร??อมูล?ั เรีย?สำเร็? ${count} ??`;',
        replacement: 'progressTxt.textContent = `เสร็จสมบูรณ์! จัดการข้อมูลนักเรียนสำเร็จ ${count} คน`;'
    },
    {
        target: '<div style="font-size:0.7rem; color:#888;">วอร์ชั?: ${verStr} (${dateStr})</div>',
        replacement: '<div style="font-size:0.7rem; color:#888;">เวอร์ชัน: ${verStr} (${dateStr})</div>'
    },
    {
        target: 'title="ลบ??อมูล?ั เรีย?"',
        replacement: 'title="ลบข้อมูลนักเรียน"'
    }
];

let replacedCount = 0;
replacements.forEach(r => {
    if (content.includes(r.target)) {
        content = content.replace(r.target, r.replacement);
        replacedCount++;
    } else {
        console.warn('Target string not found for replacement:', r.target);
        // Let's do a fuzzy search if direct match fails
        const lines = content.split('\n');
        const matchIdx = lines.findIndex(l => l.includes(r.target.substring(0, 15)));
        if (matchIdx !== -1) {
            console.log(`Found via fuzzy match on line ${matchIdx + 1}:`, lines[matchIdx]);
            lines[matchIdx] = lines[matchIdx].replace(r.target, r.replacement);
            content = lines.join('\n');
            replacedCount++;
        }
    }
});

console.log(`Successfully replaced ${replacedCount} / ${replacements.length} corrupted lines.`);

fs.writeFileSync(targetPath, content, 'utf8');
console.log('Restored and corrected js/admin.js written successfully.');

// Delete the temporary restored file
fs.unlinkSync(restoredPath);
