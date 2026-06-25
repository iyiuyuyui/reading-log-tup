/**
 * PDF & Excel Export Module
 * 
 * Functions to print and export class lists and reports as PDF / Excel sheets
 */

/**
 * Export Class Roster Summary to Excel (.xlsx) using SheetJS
 * @param {string} className - Class name e.g. "ม.1/1"
 * @param {Array} studentDataList - Array of student objects with reading metrics
 */
function exportClassToExcel(className, studentDataList) {
    // 1. Prepare worksheet rows
    const dataRows = studentDataList.map(s => ({
        'เลขที่': s.number,
        'รหัสประจำตัว': s.studentId,
        'คำนำหน้า': s.prefix || '',
        'ชื่อ': s.firstName,
        'นามสกุล': s.lastName,
        'บันทึกแล้ว (เล่ม)': s.totalBooks || 0,
        'หน้าสะสม': s.totalPages || 0,
        'เวลาอ่านรวม (นาที)': s.totalReadingTime || 0,
        'คะแนนรวม': s.totalScore || 0
    }));

    // 2. Create SheetJS Workbook
    const worksheet = XLSX.utils.json_to_sheet(dataRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `สรุปผลการอ่าน ${className}`);

    // 3. Trigger download
    XLSX.writeFile(workbook, `สรุปผลบันทึกรักการอ่าน_${className}.xlsx`);
}

/**
 * Generate and Print Student Reading Log Summary PDF using jsPDF + html2canvas
 * @param {string} elementId - HTML element ID containing the layout to print
 * @param {string} filename - Output filename
 */
async function exportToPDF(elementId, filename = 'report.pdf') {
    const element = document.getElementById(elementId);
    if (!element) return;

    // Load PDF libraries globally
    const { jsPDF } = window.jspdf;

    try {
        const canvas = await html2canvas(element, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        
        const pdf = new jsPDF('p', 'mm', 'a4');
        const imgWidth = 210; // A4 page width in mm
        const pageHeight = 297; // A4 page height in mm
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

        pdf.save(filename);
    } catch (error) {
        console.error("PDF generation failed:", error);
        alert("พิมพ์เอกสาร PDF ล้มเหลว");
    }
}
