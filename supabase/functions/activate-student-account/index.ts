// supabase/functions/activate-student-account/index.ts
import { serve } from "https://deno.land/std@0.131.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Helper to calculate SHA-256 hash of a string
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
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

    const { studentId, passcode, newPassword } = await req.json();

    if (!studentId || !passcode || !newPassword) {
      return new Response(JSON.stringify({ error: "Missing parameters: studentId, passcode, and newPassword are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 1. Calculate passcode hash
    const computedHash = await sha256(String(passcode).trim());

    // 2. Look up passcode in pending activations
    const { data: registration, error: regError } = await supabase
      .from('pending_registrations')
      .select('*')
      .eq('student_id', String(studentId).trim())
      .eq('passcode_hash', computedHash)
      .single();

    if (regError || !registration) {
      return new Response(JSON.stringify({ error: "รหัสนักเรียนหรือรหัสเปิดใช้งาน (Passcode) ไม่ถูกต้อง" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 3. Check if they already have an auth account mapped
    const { data: existingMap } = await supabase
      .from('students_auth_map')
      .select('*')
      .eq('student_id', String(studentId).trim())
      .maybeSingle();

    if (existingMap) {
      return new Response(JSON.stringify({ error: "บัญชีนักเรียนนี้ถูกเปิดใช้งานเรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านส่วนตัว" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    // 4. Create User in auth.users
    const email = `${studentId}@student.readinglog`;
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: newPassword,
      user_metadata: { role: 'student' },
      email_confirm: true
    });

    if (authError || !authUser?.user) {
      throw new Error(`Auth account creation failed: ${authError?.message || 'Unknown error'}`);
    }

    const authId = authUser.user.id;

    // 5. Insert into students_auth_map
    const { error: mapError } = await supabase
      .from('students_auth_map')
      .insert({
        auth_id: authId,
        student_id: String(studentId).trim()
      });

    if (mapError) {
      // Cleanup created auth user to maintain consistency
      await supabase.auth.admin.deleteUser(authId);
      throw new Error(`Auth mapping failed: ${mapError.message}`);
    }

    // 6. Update roster profiles in students table with auth UUID
    await supabase
      .from('students')
      .update({ auth_id: authId })
      .eq('student_id', String(studentId).trim());

    // 7. Delete the pending registration row
    await supabase
      .from('pending_registrations')
      .delete()
      .eq('student_id', String(studentId).trim());

    return new Response(JSON.stringify({ success: true, message: "เปิดใช้งานบัญชีและลงทะเบียนเรียบร้อยแล้ว!" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
