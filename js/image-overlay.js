/**
 * Image Overlay System
 * 
 * Places text data onto the provided reading report template image
 * and exports it as a downloadable image file.
 * 
 * Template: Reading record.png (1060 × 1543 px)
 * Uses proportional positioning to support any template size.
 */

/**
 * Partition text into fields based on character limits to prevent visual overflows
 * @param {string} text - The input paragraph
 * @param {Array<number>} limits - Character limit for each sequential line
 * @returns {Array<string>} - Array of text chunks matching the limits
 */
function chunkString(text, limits) {
    if (!text) return limits.map(() => "");
    
    let remaining = text.trim();
    const result = [];
    
    for (const limit of limits) {
        if (remaining.length <= limit) {
            result.push(remaining);
            remaining = "";
        } else {
            // Find space/punctuation to avoid splitting words
            let splitIdx = limit;
            const subStr = remaining.substring(0, limit);
            const lastSpace = subStr.lastIndexOf(' ');
            
            // If space is found in the last 20% of the limit, split there
            if (lastSpace > limit * 0.8) {
                splitIdx = lastSpace;
            }
            
            result.push(remaining.substring(0, splitIdx).trim());
            remaining = remaining.substring(splitIdx).trim();
        }
    }
    
    // Truncate remainder if it exceeds final line limit
    if (remaining) {
        result[result.length - 1] = result[result.length - 1].substring(0, limits[limits.length - 1] - 4) + "...";
    }
    
    // Fill remaining elements if text was short
    while (result.length < limits.length) {
        result.push("");
    }
    
    return result;
}

async function generateReportImage(readingLogData, studentData, templateSrc = 'Reading record.png') {
    return new Promise((resolve, reject) => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            const img = new Image();
            img.crossOrigin = "Anonymous";
            
            img.onload = () => {
                const W = img.width;   // Reference: 1060
                const H = img.height;  // Reference: 1543
                
                canvas.width = W;
                canvas.height = H;
                
                // Draw template background
                ctx.drawImage(img, 0, 0);
                
                // --- Proportional positioning helpers ---
                const W_ref = 1060;
                const H_ref = 1543;
                const px = (x) => Math.round((x / W_ref) * W);
                const py = (y) => Math.round((y / H_ref) * H);
                const fs = (size) => Math.round(size * (W / W_ref)); // Scale font size proportionally
                
                // Setup typography - use Sarabun for Thai text
                const setFont = (size, style = '') => {
                    ctx.font = `${style} ${fs(size)}px "Sarabun", "TH Sarabun New", sans-serif`;
                };
                ctx.fillStyle = '#1a1a1a';
                ctx.textBaseline = 'top';
                
                // ====================================================
                // FIELD POSITIONS (mapped to template layout)
                // ====================================================
                
                // --- โรงเรียน (text 1) ---
                setFont(26);
                const schoolName = "เตรียมอุดมศึกษาพัฒนาการ ปทุมธานี";
                ctx.fillText(schoolName, px(280), py(145));
                
                // --- สังกัดสำนักงานเขตพื้นที่การศึกษา (text 2) ---
                const jurisdiction = "สพม.ปทุมธานี";
                ctx.fillText(jurisdiction, px(480), py(195));
                
                // --- ชื่อหนังสือ (text 3) ---
                ctx.fillText(readingLogData.bookTitle || "", px(180), py(309));
                
                // --- ผู้แต่ง (text 4) ---
                ctx.fillText(readingLogData.author || "", px(140), py(357));
                
                // --- จำนวนหน้าของหนังสือ (text 5) ---
                ctx.fillText(readingLogData.pageCount || "0", px(330), py(401));
                
                // --- เวลาที่ใช้อ่าน: แปลงนาทีเป็นชั่วโมง+นาที (text 6, 7) ---
                const totalMinutes = parseInt(readingLogData.readingTime) || 0;
                const hours = Math.floor(totalMinutes / 60);
                const mins = totalMinutes % 60;
                ctx.fillText(hours > 0 ? hours.toString() : "0", px(650), py(401));
                ctx.fillText(mins > 0 ? mins.toString() : "0", px(800), py(398));
                
                // --- สรุปใจความสำคัญของเรื่อง (text 8 to 8.7) ---
                setFont(24);
                const summaryLimits = [50, 60, 60, 60, 60, 60, 60, 60];
                const summaryChunks = chunkString(readingLogData.summary || "", summaryLimits);
                for (let i = 0; i < 8; i++) {
                    ctx.fillText(summaryChunks[i], px(70), py(481 + i * 43));
                }
                
                // --- ข้อคิดที่ได้รับ (text 9 to 9.1) ---
                const lessonLimits = [60, 60];
                const lessonChunks = chunkString(readingLogData.lesson || "", lessonLimits);
                for (let i = 0; i < 2; i++) {
                    ctx.fillText(lessonChunks[i], px(70), py(870 + i * 42));
                }
                
                // --- สิ่งที่จะนำไปปรับใช้ในชีวิตประจำวัน (text 10 to 10.1) ---
                const appLimits = [60, 60];
                const appChunks = chunkString(readingLogData.application || "", appLimits);
                for (let i = 0; i < 2; i++) {
                    ctx.fillText(appChunks[i], px(70), py(992 + i * 47));
                }
                
                // --- เหตุผลที่อ่านหนังสือเล่มนี้ (text 11 to 11.1) ---
                const reasonLimits = [60, 60];
                const reasonChunks = chunkString(readingLogData.reason || "", reasonLimits);
                for (let i = 0; i < 2; i++) {
                    ctx.fillText(reasonChunks[i], px(70), py(1123 + i * 44));
                }
                
                // --- ลายเซ็น ---
                const firstNameOnly = studentData.firstName || "";
                const fullName = `${studentData.prefix || ''}${studentData.firstName} ${studentData.lastName}`;
                const classInfo = `นักเรียนชั้น ${formatLevel(studentData.level)} ห้อง ${studentData.room} เลขที่ ${studentData.number}`;
                
                // (ลงชื่อ) text 12 ผู้บันทึก (First name only)
                setFont(26, 'italic');
                ctx.textAlign = 'center';
                ctx.fillText(firstNameOnly, px(500), py(1288));
                
                // ( text 13 ) (Full name inside parentheses)
                setFont(26);
                ctx.fillText(`(${fullName})`, px(500), py(1331));
                
                // ตำแหน่ง (Class info) - ไม่ต้องใส่อะไรตามความต้องการของผู้ใช้
                // setFont(24);
                // ctx.fillText(classInfo, px(500), py(1384));
                
                // Reset alignment
                ctx.textAlign = 'left';
                
                // --- Attached Photo (Draw on the bottom-left placeholder) ---
                if (readingLogData.attachmentUrl) {
                    const attachImg = new Image();
                    attachImg.crossOrigin = "Anonymous";
                    attachImg.onload = () => {
                        const rectWidth = px(200);
                        const rectHeight = px(230);
                        const rectX = px(58);
                        const rectY = py(1195);
                        
                        // Calculate aspect ratio for object-fit: cover inside the placeholder
                        const imgRatio = attachImg.width / attachImg.height;
                        const rectRatio = rectWidth / rectHeight;
                        let sWidth = attachImg.width;
                        let sHeight = attachImg.height;
                        let sx = 0;
                        let sy = 0;
                        
                        if (imgRatio > rectRatio) {
                            sWidth = attachImg.height * rectRatio;
                            sx = (attachImg.width - sWidth) / 2;
                        } else {
                            sHeight = attachImg.width / rectRatio;
                            sy = (attachImg.height - sHeight) / 2;
                        }
                        
                        ctx.drawImage(attachImg, sx, sy, sWidth, sHeight, rectX, rectY, rectWidth, rectHeight);
                        
                        // Draw a border
                        ctx.strokeStyle = '#a3a3a3';
                        ctx.lineWidth = px(2);
                        ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
                        
                        resolve(canvas.toDataURL('image/png'));
                    };
                    attachImg.onerror = () => {
                        console.warn("Failed to load attachment image, exporting without it.");
                        resolve(canvas.toDataURL('image/png'));
                    };
                    attachImg.src = readingLogData.attachmentUrl;
                } else {
                    resolve(canvas.toDataURL('image/png'));
                }
            };
            
            img.onerror = (err) => {
                console.error("Failed to load template image", err);
                reject(new Error("Failed to load template image"));
            };
            
            img.src = templateSrc;
            
        } catch (error) {
            console.error("Error in generateReportImage:", error);
            reject(error);
        }
    });
}

/**
 * Legacy wrapper for backward compatibility
 */
function wrapText(context, text, x, y, maxWidth, lineHeight) {
    // Legacy support implementation
}

// Function to trigger download of the generated image
function downloadGeneratedImage(dataUrl, filename = 'reading-report.png') {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
