// supabase/functions/send-telegram-notification/index.ts
import { serve } from "https://deno.land/std@0.131.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing environment secrets: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { level, message, test_token, test_chat_id } = await req.json();

    if (!message) {
      return new Response(JSON.stringify({ error: "Missing message parameter" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    let botToken = "";
    let chatId = "";

    // Authenticate user if testing custom credentials
    if (test_token || test_chat_id) {
      const authHeader = req.headers.get('Authorization') || '';
      const jwtToken = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authErr } = await supabase.auth.getUser(jwtToken);
      
      if (authErr || !user || user.user_metadata?.role !== 'admin') {
        return new Response(JSON.stringify({ error: "Unauthorized: Only administrators can test Telegram credentials." }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }
      botToken = test_token;
      chatId = test_chat_id;
    } else {
      // Dynamic lookup from database
      let cleanLevel = level ? String(level).trim() : 'global';
      
      if (cleanLevel !== 'global') {
        if (/^[1-6]$/.test(cleanLevel)) {
          cleanLevel = 'M' + cleanLevel;
        } else {
          cleanLevel = cleanLevel.replace('ม.', 'M').trim();
        }
        
        // Query level-specific config
        const { data: config } = await supabase
          .from('telegram_configs')
          .select('*')
          .eq('level_key', cleanLevel)
          .maybeSingle();
        
        botToken = config?.bot_token || "";
        chatId = config?.chat_id || "";
      }

      // Fallback to global config if level-specific is not set
      if (!botToken || !chatId) {
        const { data: settings } = await supabase
          .from('school_settings')
          .select('*');
        
        const settingsMap = (settings || []).reduce((acc, curr) => {
          acc[curr.key] = curr.value;
          return acc;
        }, {} as Record<string, string>);

        botToken = botToken || settingsMap['telegram_bot_token'] || Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
        chatId = chatId || settingsMap['telegram_chat_id'] || "";
      }
    }

    if (!botToken || !chatId) {
      return new Response(JSON.stringify({ error: "Telegram bot token or chat ID is not configured." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json();

    return new Response(JSON.stringify({ success: response.ok, data }), {
      status: response.ok ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
