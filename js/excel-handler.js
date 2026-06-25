/**
 * Excel Handler Module
 * 
 * Functions for handling importing student data from Excel/CSV
 * and checking student IDs during login.
 */

/**
 * Parse Excel file to workbook object
 */
async function parseExcelWorkbook(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                // SheetJS is required globally via CDN in HTML
                const workbook = XLSX.read(data, { type: 'array', codepage: 65001 });
                resolve(workbook);
            } catch (err) {
                console.error("SheetJS read error:", err);
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
}

/**
 * Extract student records from specified sheet(s) of a workbook
 * @param {Object} workbook - SheetJS workbook
 * @param {string} sheetName - sheet name to parse or 'all'
 */
function extractStudentsFromSheet(workbook, sheetName) {
    const sheetsToProcess = sheetName === 'all' ? workbook.SheetNames : [sheetName];
    const studentMap = new Map(); // Use Map to de-duplicate by studentId
    
    for (const sName of sheetsToProcess) {
        const worksheet = workbook.Sheets[sName];
        if (!worksheet) continue;
        
        // Use raw: false to get formatted cell values (prevents date serial number issues like 46023)
        let rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
        
        // If SheetJS loaded rows as single-column lines (common CSV parsing issue)
        if (rawJson.length > 0 && rawJson.every(row => row.length <= 1)) {
            rawJson = rawJson.map(row => {
                if (row.length === 0) return [];
                return String(row[0] || '').split(',');
            });
        }

        // Detect default level from sheet name (e.g. 'ม.1' -> 'ม.1')
        let defaultLevel = '';
        const matchLevel = sName.match(/ม\.([1-6])/);
        if (matchLevel) {
            defaultLevel = `ม.${matchLevel[1]}`;
        }
        
        let currentLevel = defaultLevel;
        let currentRoom = 0;
        
        // Find header row in this sheet
        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(20, rawJson.length); i++) {
            const row = rawJson[i];
            if (!row || !Array.isArray(row)) continue;
            
            const hasId = row.some(cell => cell && String(cell).includes('เลขประจำตัว'));
            const hasName = row.some(cell => cell && (String(cell).includes('ชื่อ') || String(cell).includes('นามสกุล')));
            
            if (hasId && hasName) {
                headerRowIndex = i;
                break;
            }
        }
        
        if (headerRowIndex === -1) continue; // Skip sheet if no header found
        
        const headers = rawJson[headerRowIndex].map(h => String(h || '').trim());
        
        // Column index variables
        let studentIdCol = -1;
        let fullNameCol = -1;
        let firstNameCol = -1;
        let lastNameCol = -1;
        let prefixCol = -1;
        let levelCol = -1;
        let roomCol = -1;
        let classCol = -1;
        let seatCol = -1;
        
        // Map headers to indexes
        headers.forEach((header, idx) => {
            if (header.includes('เลขประจำตัว')) {
                // If we see multiple "เลขประจำตัวนักเรียน" (like in OBEC sheets), check sample length
                const sampleVal = String(rawJson[headerRowIndex + 1]?.[idx] || '').trim();
                if (sampleVal.length === 5) {
                    studentIdCol = idx;
                } else if (studentIdCol === -1) {
                    studentIdCol = idx;
                }
            } else if (header === 'ชื่อ นามสกุล') {
                fullNameCol = idx;
            } else if (header === 'ชื่อ') {
                firstNameCol = idx;
            } else if (header === 'นามสกุล') {
                lastNameCol = idx;
            } else if (header.includes('คำนำหน้า')) {
                prefixCol = idx;
            } else if (header === 'ชั้น') {
                const hasRoom = headers.includes('ห้อง');
                if (hasRoom) {
                    levelCol = idx;
                } else {
                    classCol = idx;
                }
            } else if (header === 'ห้อง') {
                roomCol = idx;
            } else if (header === 'ที่' || header === 'เลขที่') {
                seatCol = idx;
            }
        });
        
        // If we didn't find studentIdCol, skip sheet
        if (studentIdCol === -1) continue;
        
        // Parse data rows in this sheet
        for (let i = headerRowIndex + 1; i < rawJson.length; i++) {
            const row = rawJson[i];
            if (!row || row.length === 0) continue;
            
            // Convert row to string to check if it's a classroom subtitle (e.g. ชั้น ม.6 ห้องที่ 5)
            const rowStr = row.map(c => String(c || '').trim()).join(' ');
            if (rowStr.includes('ชั้น') && rowStr.includes('ห้องที่')) {
                const matchRoom = rowStr.match(/ห้องที่\s*([0-9]+)/);
                const matchLvl = rowStr.match(/ชั้น\s*ม\.\s*([1-6])/);
                if (matchLvl) {
                    currentLevel = `ม.${matchLvl[1]}`;
                }
                if (matchRoom) {
                    currentRoom = parseInt(matchRoom[1], 10);
                }
                continue; // Skip this subtitle row
            } else if (rowStr.includes('ห้องที่') && !rowStr.includes('รวม')) {
                const matchRoom = rowStr.match(/ห้องที่\s*([0-9]+)/);
                if (matchRoom) {
                    currentRoom = parseInt(matchRoom[1], 10);
                }
                continue; // Skip this subtitle row
            }
            
            // Skip if it is another header row
            if (row.some(cell => cell && String(cell).includes('เลขประจำตัว')) && row.some(cell => cell && String(cell).includes('ชื่อ'))) {
                continue;
            }

            const studentId = String(row[studentIdCol] || '').trim();
            if (!studentId || studentId === 'เลขประจำตัวนักเรียน' || studentId === 'เลขประจำตัว' || isNaN(studentId)) continue;
            
            // We only import 5-digit student IDs
            if (studentId.length !== 5) continue;
            
            // 1. Parse Names
            let prefix = '';
            let firstName = '';
            let lastName = '';
            
            if (firstNameCol !== -1 && lastNameCol !== -1) {
                firstName = String(row[firstNameCol] || '').trim();
                lastName = String(row[lastNameCol] || '').trim();
                if (prefixCol !== -1) {
                    prefix = String(row[prefixCol] || '').trim();
                }
            } else if (fullNameCol !== -1) {
                const fullName = String(row[fullNameCol] || '').trim();
                let namePart = fullName;
                
                if (fullName.startsWith('เด็กชาย')) {
                    prefix = 'เด็กชาย';
                    namePart = fullName.substring(7);
                } else if (fullName.startsWith('เด็กหญิง')) {
                    prefix = 'เด็กหญิง';
                    namePart = fullName.substring(8);
                } else if (fullName.startsWith('ด.ช.')) {
                    prefix = 'เด็กชาย';
                    namePart = fullName.substring(4);
                } else if (fullName.startsWith('ด.ญ.')) {
                    prefix = 'เด็กหญิง';
                    namePart = fullName.substring(4);
                } else if (fullName.startsWith('นาย')) {
                    prefix = 'นาย';
                    namePart = fullName.substring(3);
                } else if (fullName.startsWith('นางสาว')) {
                    prefix = 'นางสาว';
                    namePart = fullName.substring(6);
                } else if (fullName.startsWith('น.ส.')) {
                    prefix = 'นางสาว';
                    namePart = fullName.substring(4);
                }
                
                namePart = namePart.trim();
                const nameParts = namePart.split(/\s+/);
                firstName = nameParts[0] || '';
                lastName = nameParts.slice(1).join(' ') || '';
            }
            
            // Normalize prefixes
            if (prefix === 'ด.ช.') prefix = 'เด็กชาย';
            if (prefix === 'ด.ญ.') prefix = 'เด็กหญิง';
            if (prefix === 'น.ส.') prefix = 'นางสาว';
            
            // 2. Parse Class Level / Room
            let level = '';
            let room = 0;
            
            if (levelCol !== -1 && roomCol !== -1) {
                const levelVal = String(row[levelCol] || '').trim();
                level = levelVal.startsWith('ม.') ? levelVal : `ม.${levelVal}`;
                room = parseInt(row[roomCol], 10) || 0;
            } else if (classCol !== -1) {
                const classStr = String(row[classCol] || '').trim();
                
                // If SheetJS read it as date serial number (e.g. 46023 which is 1/1)
                if (!isNaN(classStr) && parseInt(classStr, 10) > 40000) {
                    const date = new Date((parseInt(classStr, 10) - 25569) * 86400 * 1000);
                    level = `ม.${date.getUTCMonth() + 1}`;
                    room = date.getUTCDate();
                } else {
                    const classParts = classStr.split('/');
                    const levelVal = classParts[0] ? classParts[0].trim() : '';
                    level = levelVal.startsWith('ม.') ? levelVal : `ม.${levelVal}`;
                    room = parseInt(classParts[1], 10) || 0;
                }
            } else {
                // Use stateful level and room from subtitle parsing
                level = currentLevel;
                room = currentRoom;
            }
            
            // 3. Seat Number
            let number = 0;
            if (seatCol !== -1) {
                number = parseInt(row[seatCol], 10) || 0;
            }
            
            // Add or overwrite in map (so we get unique students)
            studentMap.set(studentId, {
                studentId,
                prefix,
                firstName,
                lastName,
                level,
                room,
                number
            });
        }
    }
    
    return Array.from(studentMap.values());
}

/**
 * Backwards-compatible wrapper function for legacy usage
 */
async function handleExcelUpload(file) {
    try {
        const workbook = await parseExcelWorkbook(file);
        return extractStudentsFromSheet(workbook, 'all');
    } catch (err) {
        console.error("handleExcelUpload legacy wrapper error:", err);
        throw err;
    }
}

// Function to import parsed students into Supabase
async function importStudentsToFirestore(students) {
    if (!window.supabaseClient) {
        throw new Error("Supabase is not initialized.");
    }
    
    try {
        const targetYear = getActiveYear();
        const studentsToUpsert = students.map(s => ({
            student_id: s.studentId,
            prefix: s.prefix || '',
            first_name: s.firstName || '',
            last_name: s.lastName || '',
            level: s.level,
            room: s.room || 0,
            number: s.number || 0,
            academic_year: targetYear,
            updated_at: new Date().toISOString()
        }));

        const { error } = await window.supabaseClient
            .from('students')
            .upsert(studentsToUpsert, { onConflict: 'student_id,academic_year' });

        if (error) throw error;
        
        return { success: true, count: students.length, errors: 0 };
    } catch (error) {
        console.error("Import error:", error);
        return { success: false, error: error.message, count: 0 };
    }
}

// Function to check student ID during Login
async function checkStudentId(studentId) {
    if (!window.supabaseClient) {
        console.warn("Supabase not initialized, returning mock data for demo");
        return {
            exists: true,
            data: {
                studentId: studentId,
                prefix: 'เด็กชาย',
                firstName: 'ทดสอบ',
                lastName: 'ระบบ',
                level: 'ม.1',
                room: 1,
                number: 1
            }
        };
    }
    
    try {
        const targetYear = getActiveYear();
        const { data, error } = await window.supabaseClient
            .from('students')
            .select('*')
            .eq('student_id', String(studentId).trim())
            .eq('academic_year', targetYear)
            .maybeSingle();
        
        if (error) throw error;
        
        if (data) {
            return {
                exists: true,
                data: {
                    id: data.id,
                    studentId: data.student_id,
                    prefix: data.prefix,
                    firstName: data.first_name,
                    lastName: data.last_name,
                    level: data.level,
                    room: data.room,
                    number: data.number,
                    academicYear: data.academic_year
                }
            };
        } else {
            return { exists: false, data: null };
        }
    } catch (error) {
        console.error("Error checking student ID:", error);
        throw error;
    }
}
