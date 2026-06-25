/**
 * utils.js — Shared helper utilities
 * Fixes: showToast now renders a real UI toast (not alert()),
 *        formatLevel, formatDate, etc. are unchanged.
 */

// ── Toast Notification System ────────────────────────────────
(function setupToastSystem() {
    // Inject toast container once
    const style = document.createElement('style');
    style.textContent = `
        #toastContainer {
            position: fixed; bottom: 1.5rem; right: 1.5rem;
            z-index: 99999; display: flex; flex-direction: column;
            gap: 0.5rem; pointer-events: none;
        }
        .toast-item {
            min-width: 260px; max-width: 380px;
            padding: 0.75rem 1.1rem; border-radius: 10px;
            font-size: 0.9rem; font-weight: 500; color: #fff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.25);
            display: flex; align-items: center; gap: 0.6rem;
            pointer-events: auto; cursor: pointer;
            animation: toastSlideIn 0.3s ease forwards;
            transition: opacity 0.4s ease;
        }
        .toast-item.hiding { opacity: 0; transform: translateX(40px); }
        .toast-item.success { background: linear-gradient(135deg, #10b981, #059669); }
        .toast-item.error   { background: linear-gradient(135deg, #ef4444, #dc2626); }
        .toast-item.warning { background: linear-gradient(135deg, #f59e0b, #d97706); }
        .toast-item.info    { background: linear-gradient(135deg, #6366f1, #4f46e5); }
        @keyframes toastSlideIn {
            from { opacity: 0; transform: translateX(40px); }
            to   { opacity: 1; transform: translateX(0); }
        }
    `;
    document.head.appendChild(style);

    const container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
})();

/**
 * Show a non-blocking toast notification.
 * @param {string} message  - Text to display
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration - ms before auto-dismiss (default 3500)
 */
function showToast(message, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('toastContainer');
    if (!container) { console.warn(message); return; }

    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.innerHTML = `<span>${icons[type] || '📢'}</span><span>${message}</span>`;
    el.onclick = () => dismiss(el);
    container.appendChild(el);

    function dismiss(node) {
        node.classList.add('hiding');
        setTimeout(() => node.remove(), 420);
    }

    setTimeout(() => { if (el.parentNode) dismiss(el); }, duration);
}

// ── Level / Grade Formatting ──────────────────────────────────
function formatLevel(level) {
    if (!level) return '';
    const str = String(level).trim();
    if (/^[1-6]$/.test(str)) return `ม.${str}`;
    if (/^ม\.[1-6]$/.test(str)) return str;
    return str;
}

function formatClass(level, room) {
    if (!level) return '';
    const formattedLevel = formatLevel(level);
    return room ? `${formattedLevel}/${room}` : formattedLevel;
}

// ── Date Formatting ───────────────────────────────────────────
function formatThaiDate(dateInput, includeTime = false) {
    if (!dateInput) return '-';
    let date;
    if (typeof dateInput === 'string' || typeof dateInput === 'number') {
        date = new Date(dateInput);
    } else if (dateInput instanceof Date) {
        date = dateInput;
    } else {
        return '-';
    }
    if (isNaN(date.getTime())) return '-';

    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    if (includeTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
    return date.toLocaleString('th-TH', opts);
}

/**
 * Parse a Supabase/PostgreSQL date string into a JS Date.
 * Handles ISO strings and plain date strings (YYYY-MM-DD).
 */
function parseDate(val) {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
}

// ── Number Formatting ─────────────────────────────────────────
function formatNumber(n) {
    return (Number(n) || 0).toLocaleString('th-TH');
}

// ── String Truncation ─────────────────────────────────────────
function truncate(str, maxLen = 60) {
    if (!str) return '';
    return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

// ── Debounce ──────────────────────────────────────────────────
function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}

// ── Escape HTML ───────────────────────────────────────────────
function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str || '').replace(/[&<>"']/g, c => map[c]);
}

// ── Generate a Thai Buddhist Era year string from a JS year ──
function toThaiYear(gregorianYear) {
    return String((gregorianYear || new Date().getFullYear()) + 543);
}

// ── Expose globally ───────────────────────────────────────────
window.showToast      = showToast;
window.formatLevel    = formatLevel;
window.formatClass    = formatClass;
window.formatThaiDate = formatThaiDate;
window.parseDate      = parseDate;
window.formatNumber   = formatNumber;
window.truncate       = truncate;
window.debounce       = debounce;
window.escapeHtml     = escapeHtml;
window.toThaiYear     = toThaiYear;
