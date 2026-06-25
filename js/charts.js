/**
 * Charts Visualization Module
 * 
 * Functions to create analytics charts using Chart.js
 */

/**
 * Render Reading Trend Bar/Line Chart
 * @param {string} canvasId - HTML canvas element ID
 * @param {Array} labels - X-axis labels (e.g. Month names or Weeks)
 * @param {Array} data - Data points
 */
function renderReadingTrendChart(canvasId, labels, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    return new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'จำนวนหน้าที่อ่านสะสม (หน้า)',
                data: data,
                borderColor: '#DDA0DD', // Soft purple pastel
                backgroundColor: 'rgba(221, 160, 221, 0.2)',
                borderWidth: 3,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                }
            }
        }
    });
}

/**
 * Render Book Type Distribution Pie Chart
 * @param {string} canvasId - HTML canvas element ID
 * @param {Object} typeCounts - Object containing category name keys and integer counts
 */
function renderBookTypePieChart(canvasId, typeCounts) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return null;

    const labels = Object.keys(typeCounts);
    const data = Object.values(typeCounts);

    return new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: [
                    '#FFB6C1', // Pink
                    '#87CEEB', // Sky Blue
                    '#DDA0DD', // Purple
                    '#A8E6CF', // Green
                    '#FFD3B6'  // Orange
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}
