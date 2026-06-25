/**
 * telegram.js — Telegram notification module (Production-Hardened Supabase Client Edition)
 * Routes all notification payloads through Deno Edge Functions to protect secrets.
 */

/**
 * Send a Telegram message using the global / channel route.
 * @param {string} text - HTML-formatted message
 */
async function sendTelegramMessage(text) {
    return _sendViaEdgeFunction('global', text);
}

/**
 * Send a Telegram message routed to a specific grade level channel.
 * @param {string} level - e.g. 'ม.1'
 * @param {string} text  - HTML-formatted message
 */
async function sendTelegramMessageForLevel(level, text) {
    return _sendViaEdgeFunction(level, text);
}

/**
 * Call the Supabase Edge Function to dispatch the message securely.
 */
async function _sendViaEdgeFunction(level, message) {
    if (!window.supabaseClient) {
        console.warn(`Telegram alert skipped: Supabase Client not initialized.`);
        return false;
    }

    try {
        // Fetch Edge Function Endpoint (uses global constants initialized in supabase-config.js)
        const url = `${SUPABASE_URL}/functions/v1/send-telegram-notification`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ level, message })
        });

        const json = await res.json();
        if (!res.ok) {
            console.error(`Telegram Edge Function Error:`, json);
            return false;
        }

        console.log(`Telegram notification successfully queued via Edge Function [${level}].`);
        return true;
    } catch (err) {
        console.error(`Telegram Edge Function Dispatch Error:`, err);
        return false;
    }
}

// Expose functions globally
window.sendTelegramMessage       = sendTelegramMessage;
window.sendTelegramMessageForLevel = sendTelegramMessageForLevel;
